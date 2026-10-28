"""Video in, grounded Learn result out.

The video is cut into sections at quiet moments: a short first one so notes appear fast, then ~100 s each.
Sections are transcribed one after another (or taken from subtitles), and each section's notes are written by an
LLM as soon as its transcript is ready, in parallel across a model pool, while keyframes and OCR run alongside.
Every finished section is published immediately so the UI can show it.

The media is a `Source`: a local file, or stream URLs that ffmpeg reads with ranged requests (no download).
"""

import json
import logging
import os
import subprocess
import threading
import time
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import frames as fr
from . import synthesize as syn
from .schema import (FRAME_WINDOW_S, Chapter, Frame, LearnOutput, LearnResult, Overview, QuizItem, Rejected,
                     SectionOutput, Segment, VisualOutput, _words, ground, ground_notes, snap_quote)
from .transcribe import SAMPLE_RATE, parse_vtt, quietest, transcribe

log = logging.getLogger(__name__)
MAX_DURATION_S = 12 * 3600  # Muse ASR caps one request at 10 minutes; audio goes in 6 s pieces, so that cap never applies
MAX_BYTES = 2 * 1024**3  # 2 GB: a 10-minute 4K screen recording fits
FIRST_S = 40.0  # short first section: its notes are on screen within seconds while the rest are written
SECTION_S = 50.0  # one LLM call per section, all in parallel: shorter sections finish sooner
SNAP_S = 5.0  # move each cut up to this far to the quietest moment, so sentences are not split
HEDGE_S = 25.0  # NVIDIA takes 12-60 s a section; start a backup model only when one is clearly stuck
FAST_HEDGE_S = {"groq": 6.0,  # Groq answers in 1-3 s; still silent at 6 s is usually hung (Qwen once sat 24 s)
                "muse": 10.0}  # Spark, 50 s sections: 6-10 s; the backup covers stalls (27 s, 39 s seen), not normal calls
PIPELINE_VERSION = "32"
Emit = Callable[..., None]  # emit(kind, **data): one event for the live "behind the scenes" view; see jobs.tracer


def _quiet(kind: str, **data) -> None:
    pass  # part of the result cache key; bump when output changes so old results are not reused


@dataclass
class Source:
    """Where the media comes from. ffmpeg reads local paths and stream URLs alike."""

    video: str
    duration: float
    audio: str | None = None  # None: no audio track
    scan: str | None = None  # lower-resolution video for scene detection; defaults to `video`
    headers: str = ""  # HTTP headers ffmpeg sends with stream URLs
    captions: list[Segment] | None = None  # creator subtitles: used instead of speech recognition
    youtube_id: str | None = None


@dataclass
class Part:
    """One finished section, plus its evidence-check audit."""

    chapter: Chapter | None
    quiz: list[QuizItem]
    model: str
    rejected: list[Rejected] = field(default_factory=list)
    checked: int = 0  # notes the model proposed in its final answer
    rechecked: int = 0  # citation problems found in the first answer and sent back for repair


def probe(video: Path) -> tuple[float, set[str]]:
    """Returns (duration seconds, stream kinds such as {"video", "audio", "subtitle"}).
    Raises ValueError for anything that is not a playable video."""
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", str(video)],
        capture_output=True, text=True,
    )
    try:
        info = json.loads(proc.stdout)
        kinds = {s["codec_type"] for s in info.get("streams", [])}
        duration = float(info["format"]["duration"])
    except (json.JSONDecodeError, KeyError, ValueError):
        raise ValueError("Could not read this file as a video") from None
    if "video" not in kinds:
        raise ValueError("File has no video stream")
    return duration, kinds


def local_source(job_dir: Path) -> Source:
    video = next(job_dir.glob("video.*"))
    duration, kinds = probe(video)
    captions = _embedded_captions(video) if "subtitle" in kinds else None
    return Source(str(video), duration, audio=str(video) if "audio" in kinds else None, captions=captions)


def _embedded_captions(video: Path) -> list[Segment] | None:
    """A text subtitle track inside the file (MKV/MP4), read natively by ffmpeg; None for image-based tracks."""
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video), "-map", "0:s:0",
                           "-f", "webvtt", "-"], capture_output=True, text=True)
    return (parse_vtt(proc.stdout) or None) if proc.returncode == 0 else None


def load_audio(src: Path | str, headers: str = "") -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", *fr.ff_input(src, headers),
         "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768


def plan_sections(
    audio: np.ndarray | None, duration: float, captions: list[Segment] | None = None
) -> list[tuple[float, float]]:
    if duration <= FIRST_S + SECTION_S / 2:
        n = max(1, round(duration / SECTION_S))
        cuts = [i * duration / n for i in range(1, n)]
    else:
        n = max(1, round((duration - FIRST_S) / SECTION_S))
        cuts = [FIRST_S + i * (duration - FIRST_S) / n for i in range(n)]
    if audio is not None:
        cuts = [quietest(audio, t, SNAP_S) for t in cuts]
    elif captions:  # cut where a caption starts, so no caption straddles two sections
        near = [min((s.start for s in captions), key=lambda s, t=t: abs(s - t)) for t in cuts]
        cuts = [c if abs(c - t) <= SNAP_S and 0 < c < duration else t for c, t in zip(near, cuts)]
    bounds = [0.0, *cuts, duration]
    return [(round(a, 2), round(b, 2)) for a, b in zip(bounds, bounds[1:])]


def _clip(src: Source, lo: float, hi: float, emit: Emit, task: str, pool: list[str], sound: bool = False) -> bytes | None:
    """The span as a small MP4 for Muse Spark (None when no Muse model is in the pool or ffmpeg fails). With sound,
    Spark hears it too, so it can write notes before the transcript exists."""
    if not any(syn.provider(m) == "muse" for m in pool):
        return None
    started = time.monotonic()
    span = ["-ss", f"{lo}", "-to", f"{hi}"]
    video = [*span, *fr.ff_input(src.scan or src.video, src.headers)]
    if sound and src.audio and src.audio != (src.scan or src.video):
        av = [*video, *span, *fr.ff_input(src.audio, src.headers), "-map", "0:v", "-map", "1:a"]
    elif sound and src.audio:
        av = [*video, "-map", "0:v", "-map", "0:a?"]
    else:
        av = [*video, "-an"]
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", *av, "-vf", "scale=-2:360,fps=1", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
         *(["-c:a", "aac", "-b:a", "32k", "-ac", "1"] if sound and src.audio else []),
         "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], capture_output=True)
    if proc.returncode or not proc.stdout:
        log.warning("clip %.0f-%.0fs failed: %s", lo, hi, proc.stderr[-200:])
        return None
    emit("clip", task=task, at=[lo, hi], kb=len(proc.stdout) // 1024, seconds=_since(started), sound=sound)
    return proc.stdout


def _visual(segments, frames, job_dir, duration, pool, state, emit: Emit = _quiet) -> None:
    """Takeaways and a diagram for the whole video. Takeaways and diagram boxes pass the evidence check; edges whose
    boxes were dropped go with them, and a diagram left with fewer than 2 connected boxes is not shown."""
    def check(out: VisualOutput):
        takeaways, problems, rejected = ground_notes(out.takeaways, segments, frames, duration)
        diagram = out.diagram
        if diagram:
            nodes, p, r = ground_notes(diagram.nodes, segments, frames, duration)
            problems, rejected = problems + [f"diagram: {x}" for x in p], rejected + r
            ids = {n.id for n in nodes}
            edges = [e for e in diagram.edges if e.source in ids and e.target in ids]
            diagram = diagram.model_copy(update={"nodes": nodes, "edges": edges}) if len(nodes) >= 2 and edges else None
        return (takeaways, diagram, out.questions[:3]), problems, rejected

    def attempt(model: str):
        messages = syn.mode_messages("visual", segments, frames, duration, job_dir, syn.is_vision(model))
        out, raw = syn.ask(messages, model, VisualOutput)
        checked = check(out)
        if checked[1]:
            out, _ = syn.ask(syn.repair_messages(messages, raw, checked[1]), model, VisualOutput)
            checked = check(out)
        return checked

    try:
        (takeaways, diagram, questions), _, rejected = hedged(_model_order(pool, 0), attempt, "takeaways", emit, "visual")
    except Exception:
        log.exception("takeaways and diagram failed; the notes stand alone")
        return
    state["takeaways"], state["diagram"], state["questions"] = takeaways, diagram, questions
    state["extra_rejected"].extend(rejected)
    emit("visual", takeaways=len(takeaways), diagram=diagram.kind if diagram else None)


def _extras(assemble, job_dir: Path, state: dict, emit: Emit, lock: threading.Lock) -> None:
    side = [threading.Thread(target=f, args=(assemble, state, emit)) for f in (_further, _fact_check)]
    for t in side:
        t.start()
    _card(assemble, job_dir, state, emit)
    for t in side:
        t.join()
    with lock:
        (job_dir / "result.json").write_text(assemble().model_dump_json(indent=2))
    emit("extras", card=state["card"], further=len(state["further"]))


def _fact_check(assemble, state: dict, emit: Emit = _quiet) -> None:
    """The takeaways checked against the web (confirmed / outdated / disputed); never fails the job."""
    r = assemble()
    if not r.takeaways:
        return
    started = time.monotonic()
    emit("stage", name="factcheck", state="start", detail="Checking the takeaways against the web", model=syn.READER)
    try:
        state["claims"] = syn.web_check(r.title, [t.text for t in r.takeaways])
        emit("stage", name="factcheck", state="end", seconds=_since(started), model=syn.READER,
             verdicts=[c["verdict"] for c in state["claims"]])
    except Exception as e:
        log.warning("fact check failed: %s", e)
        emit("stage", name="factcheck", state="end", seconds=_since(started), model=syn.READER, error=type(e).__name__)


def _further(assemble, state: dict, emit: Emit = _quiet) -> None:
    """Web sources to go deeper, from Spark's web search; never fails the job."""
    started = time.monotonic()
    emit("stage", name="web", state="start", detail="Searching the web for sources to go deeper", model="muse:muse-spark-1.3")
    try:
        r = assemble()
        state["further"] = syn.further(r.title, r.tldr, [t.text for t in r.takeaways])
        emit("stage", name="web", state="end", seconds=_since(started), model="muse:muse-spark-1.3", found=len(state["further"]))
    except Exception as e:
        log.warning("web sources failed: %s", e)
        emit("stage", name="web", state="end", seconds=_since(started), model="muse:muse-spark-1.3", error=f"{type(e).__name__}")


def _card(assemble, job_dir: Path, state: dict, emit: Emit = _quiet) -> None:
    """Muse Image draws a one-page card from the checked result only, so it cannot show an unchecked claim."""
    started = time.monotonic()
    try:
        r = assemble()
        lines = [a.text for a in r.actions[:5]] or [sc.title for sc in r.scenarios[:5]] or \
            [t.text for t in r.takeaways[:5]] or [c.notes[0].text for c in r.chapters[:5] if c.notes]
        if not lines:
            return  # a title-only card would let the image model fill the space with anything
        emit("stage", name="card", state="start", detail="Drawing a summary card", model=syn.CARD_MODEL)
        path = job_dir / "frames" / "card.webp"
        for _ in range(2):  # an image model can misspell or add text, so the card is read back like a keyframe
            path.write_bytes(syn.draw_card(CARD_PROMPT.format(title=r.title, lines="\n".join(f"- {x}" for x in lines))))
            seen, _conf = fr.ocr(path)
            # Exact words in order: a fuzzy match let "Add a task" pass on a card showing only the title.
            missing = [x for x in [r.title, *lines] if " ".join(_words(x)) not in " ".join(_words(seen))]
            if not missing:
                break
        if missing:
            path.unlink()
            raise ValueError(f"card text did not match the checked result: {missing[0]!r}")
        state["card"] = "frames/card.webp"
        emit("stage", name="card", state="end", seconds=_since(started), model=syn.CARD_MODEL)
    except Exception as e:
        log.exception("summary card failed")
        emit("stage", name="card", state="end", seconds=_since(started), model=syn.CARD_MODEL, error=f"{type(e).__name__}: {str(e)[:120]}")


FIGURE_FPS = 0.25  # SAM looks every 4 s: slides and diagrams stay up longer; ~$0.03 and ~15 s for 10 minutes


def _track_figures(src: Source, emit: Emit = _quiet) -> tuple[dict, float, str | None]:
    """SAM 3.1 tracks diagrams through the whole video in one call. Starts with the job, alongside transcription,
    since it needs only the video. Returns (boxes per frame index, when it started, error)."""
    started = time.monotonic()
    emit("stage", name="crop", state="start", detail=f"Tracking {syn.FIGURE}s through the video", model=syn.SAM_MODEL)
    try:
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", *fr.ff_input(src.scan or src.video, src.headers), "-an",
             "-vf", f"scale=-2:360,fps={FIGURE_FPS}", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
             "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], capture_output=True, check=True)
        return syn.track(proc.stdout), started, None
    except Exception as e:
        log.warning("figure tracking failed: %s", e)
        return {}, started, f"{type(e).__name__}: {str(e)[:120]}"


def _find_figures(tracked: Future | None, frames: list[Frame], job_dir: Path, emit: Emit = _quiet) -> None:
    """Each keyframe with a tracked diagram gets it cropped and enlarged (frames/N_fig.jpg) for Spark and the page.
    Never fails the job: frames stay as they are."""
    if tracked is None:
        return
    boxes, started, error = tracked.result()
    found = 0
    try:
        for i, f in enumerate(frames):
            near = boxes.get(round(f.t * FIGURE_FPS)) or []
            if not near:
                continue
            x1, y1, x2, y2, w, h = max(near, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
            if not 0.04 < (x2 - x1) * (y2 - y1) / (w * h) < 0.9:
                continue  # a speck, or the whole frame: nothing to enlarge
            path = job_dir / f.url
            fw, fh = (int(v) for v in subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
                capture_output=True, text=True, check=True).stdout.strip().split(","))
            k = fw / w
            pad = 8
            box = (max(0, int(x1 * k) - pad), max(0, int(y1 * k) - pad), min(fw, int(x2 * k) + pad), min(fh, int(y2 * k) + pad))
            out = path.with_name(f"{i}_fig.jpg")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-vf",
                            f"crop={box[2] - box[0]}:{box[3] - box[1]}:{box[0]}:{box[1]},scale='max(960,iw)':-2",
                            "-q:v", "3", str(out)], check=True)
            f.figure_url, f.figure_box = f"frames/{out.name}", box
            found += 1
            emit("frame", i=i, at=f.t, url=f.url, text=f.ocr_text, conf=round(f.ocr_conf), low_conf=f.low_conf,
                 seconds=0, figure=f.figure_url, box=box)  # the page shows the diagram on this keyframe
    except Exception as e:
        log.warning("figure cropping failed: %s", e)
        error = f"{type(e).__name__}: {str(e)[:120]}"
    emit("stage", name="crop", state="end", seconds=_since(started), cropped=found, of=len(frames), model=syn.SAM_MODEL,
         **({"error": error} if error else {}))


def _keyframes(src: Source, job_dir: Path, emit: Emit = _quiet) -> list[Frame]:
    """Never raises: every section waits on these, so a frame failure (an expired stream URL, an odd codec) would
    otherwise fail the whole job although the transcript is fine. Notes then come from the transcript alone."""
    try:
        return _read_keyframes(src, job_dir, emit)
    except Exception as e:
        log.exception("keyframes failed; writing notes from the transcript alone")
        emit("keyframes_failed", error=f"{type(e).__name__}: {str(e)[:160]}")
        return []


def _read_keyframes(src: Source, job_dir: Path, emit: Emit) -> list[Frame]:
    started = time.monotonic()
    emit("stage", name="scenes", state="start",
         detail="Scanning every frame for slide and scene changes" + (" (360p stream)" if src.scan else ""))
    cuts = fr.scene_cuts(src.scan or src.video, src.headers)
    times = fr.pick_times(cuts, src.duration)
    emit("stage", name="scenes", state="end", seconds=_since(started), cuts=len(cuts), picked=times)
    started = time.monotonic()
    emit("stage", name="frames", state="start", detail=f"Capturing {len(times)} keyframes")
    frames = fr.grab_frames(src.video, times, job_dir / "frames", src.headers)
    emit("stage", name="frames", state="end", seconds=_since(started))
    return frames


def _read_screens(frames: list[Frame], job_dir: Path, emit: Emit = _quiet, tracked: Future | None = None) -> None:
    """Screen text and diagrams for each keyframe, in place. Runs beside the notes, which don't wait for it: Spark
    already watches each section's clip. It feeds the Keyframes tab, Ask the video and the saved frames."""
    started = time.monotonic()
    emit("stage", name="ocr", state="start", detail="Reading on-screen text", frames=[
        {"i": i, "at": f.t, "url": f.url} for i, f in enumerate(frames)])
    report = lambda f, secs: emit(  # noqa: E731
        "frame", i=frames.index(f), at=f.t, url=f.url, text=f.ocr_text, conf=round(f.ocr_conf), low_conf=f.low_conf,
        seconds=round(secs, 2), figure=f.figure_url, box=f.figure_box)
    engine = fr.ocr_engine()
    if os.environ.get("MODEL_API_KEY"):
        # Spark reads the screens, 6 at a time, beside the notes; local OCR stays the backup for any frame it fails on.
        def read(f: Frame) -> bool:
            began = time.monotonic()
            try:
                f.ocr_text, f.ocr_conf, f.low_conf = syn.read_screen((job_dir / f.url).read_bytes()), 100.0, False
                ok = True
            except Exception as e:
                log.warning("Spark could not read %s (%s); using local OCR", f.url, e)
                f.ocr_text, f.ocr_conf = fr.ocr(job_dir / f.url)
                f.low_conf = bool(f.ocr_text) and f.ocr_conf < fr.OCR_LOW_MEAN_CONF
                ok = False
            report(f, time.monotonic() - began)
            return ok
        with ThreadPoolExecutor(max_workers=6) as ex:
            by_spark = sum(ex.map(read, frames))
        engine = syn.READER if by_spark == len(frames) else f"{syn.READER} + {engine}"
    else:
        fr.read_text(frames, job_dir, report)
    emit("stage", name="ocr", state="end", seconds=_since(started), model=engine)
    # After reading the screens, which don't need it: the diagram tracking runs meanwhile from the job's start.
    _find_figures(tracked, frames, job_dir, emit)


def _since(started: float) -> float:
    return round(time.monotonic() - started, 2)


def _cover(frames: list[Frame]) -> str | None:
    readable = [f for f in frames if not f.low_conf] or frames
    return max(readable, key=lambda f: len(f.ocr_text)).url if readable else None


def hedged[T](order: list[str], attempt: Callable[[str], T], what: str, emit: Emit = _quiet, task: str = "") -> T:
    """Runs attempt(order[0]) and adds the next model whenever the hedge delay (FAST_HEDGE_S for the first model's
    provider, else HEDGE_S) passes without an answer, or an attempt fails.
    The first success wins. Free hosted models are slow, hang or fail often enough (NVIDIA's gpt-oss-20b once sat
    240 s on a request) that any single-model call left whole jobs waiting. Raises only if every model fails.
    Emits a "model" event when each attempt starts (first / hedge / fallback) and ends, and "win" for the winner."""
    ex = ThreadPoolExecutor(max_workers=len(order))
    hedge_s = FAST_HEDGE_S.get(syn.provider(order[0]), HEDGE_S)

    def start(model: str, reason: str) -> Future:
        began = time.monotonic()
        emit("model", task=task, model=model, state="start", reason=reason)
        f = ex.submit(attempt, model)
        f.add_done_callback(lambda f: emit(
            "model", task=task, model=model, state="fail" if f.exception() else "end", seconds=_since(began),
            **({"error": f"{type(f.exception()).__name__}: {str(f.exception())[:160]}"} if f.exception() else {})))
        return f

    try:
        queue = list(order)
        running = {start(queue.pop(0), "first"): order[0]}
        errors = []
        while running:
            finished, _ = wait(running, timeout=hedge_s if queue else None, return_when=FIRST_COMPLETED)
            if not finished:  # slow, not failed: hedge with the next model and keep both
                nxt = queue.pop(0)
                running[start(nxt, "hedge")] = nxt
                continue
            for f in finished:
                model = running.pop(f)
                try:
                    result = f.result()
                    emit("model", task=task, model=model, state="win")
                    return result
                except Exception as e:
                    log.warning("%s failed on %s: %s", what, model, e)
                    errors.append(f"{model}: {type(e).__name__}")
                    if queue:
                        nxt = queue.pop(0)
                        running[start(nxt, "fallback")] = nxt
        raise RuntimeError(f"Every model failed for {what} ({'; '.join(errors)})")
    finally:
        ex.shutdown(wait=False, cancel_futures=True)  # losers finish in the background; nobody waits on them


def write_section(
    lo: float, hi: float, segments: list[Segment], frames: list[Frame], job_dir: Path, duration: float,
    model_order: list[str], emit: Emit = _quiet, i: int = 0, clip: bytes | None = None, listen=None,
) -> Part:
    """One section → its chapter, quiz and evidence-check audit; hedged across model_order."""
    return hedged(model_order, lambda m: _attempt(m, lo, hi, segments, frames, job_dir, duration, emit, i, clip, listen),
                  f"section {lo:.0f}-{hi:.0f}s", emit, f"s{i}")


def _attempt(model, lo, hi, segments, frames, job_dir, duration, emit: Emit = _quiet, i: int = 0, clip=None,
             listen=None) -> Part:
    started = time.monotonic()
    try:
        result = _attempt_inner(model, lo, hi, segments, frames, job_dir, duration, emit, i, clip, listen)
        log.info("section %.0f-%.0fs: %s answered in %.1fs", lo, hi, model, time.monotonic() - started)
        return result
    except Exception:
        log.info("section %.0f-%.0fs: %s failed after %.1fs", lo, hi, model, time.monotonic() - started)
        raise


def _attempt_inner(model, lo, hi, segments, frames, job_dir, duration, emit: Emit = _quiet, i: int = 0,
                   clip=None, listen=None) -> Part:
    """listen: the listen-first path. Spark writes from the clip with sound before the transcript exists; then
    listen() waits for the transcript and the cited frames, and the same evidence check runs on them."""
    # Only Muse Spark takes video; the other providers get the keyframes alone.
    watch = clip if syn.provider(model) == "muse" else None
    hearing = listen is not None and watch is not None
    if watch:
        emit("watch", task=f"s{i}", model=model, seconds=round(hi - lo, 2))
    messages = syn.section_messages([] if hearing else segments, [] if hearing else frames, lo, hi, job_dir,
                                    syn.is_vision(model) and not hearing, watch, listening=hearing)
    out, raw = syn.ask(messages, model, SectionOutput)
    if listen is not None:
        segments, frames = listen(out)
        out = _snap(out, segments)
    clean, problems, rejected = _ground_section(out, lo, segments, frames, duration)
    emit("check", task=f"s{i}", model=model, round=1, notes=len(out.notes), problems=problems[:12],
         kept=sum(len(c.notes) for c in clean.chapters))
    rechecked = len(problems)
    # Listen-first: a repair round costs ~4-5 s, so it runs only when under half the section's notes survived the
    # check; otherwise the unproven ones are dropped (and listed as thrown out, with why).
    kept = sum(len(c.notes) for c in clean.chapters)
    if problems and (not hearing or kept * 2 < len(out.notes)):
        out, _ = syn.ask(syn.repair_messages(messages, raw, problems, segments if hearing else None), model, SectionOutput)
        if listen is not None:
            segments, frames = listen(out)
        clean, problems, rejected = _ground_section(out, lo, segments, frames, duration)
        emit("check", task=f"s{i}", model=model, round=2, notes=len(out.notes), problems=problems[:12],
             kept=sum(len(c.notes) for c in clean.chapters), rejected=[r.model_dump() for r in rejected])
    if not clean.chapters:
        raise ValueError("no note survived grounding")
    chapter = clean.chapters[0]
    chapter.cover_url = _cover(frames)
    return Part(chapter, clean.quiz, model, rejected, checked=len(out.notes), rechecked=rechecked)


def _snap(out: SectionOutput, segments: list[Segment]) -> SectionOutput:
    """Listen-first: each heard quote becomes the transcript's exact nearby words when they're close, so a quote
    one word off doesn't cost a ~5 s repair round. Quotes with nothing close are left for the check to reject."""
    notes = []
    for n in out.notes:
        evidence = []
        for ev in n.evidence:
            if ev.kind == "transcript" and (hit := snap_quote(ev.quote, ev.start_seconds, segments)):
                ev = ev.model_copy(update={"quote": hit[0], "start_seconds": hit[1]})
            evidence.append(ev)
        notes.append(n.model_copy(update={"evidence": evidence}))
    return out.model_copy(update={"notes": notes})


def _model_order(pool: list[str], i: int) -> list[str]:
    """Pool order is priority order. Sections rotate across the leading models from the same provider, spreading
    per-model rate limits (Groq's free tier: 8K tokens a minute per model); the rest follow in order as hedges."""
    if syn.provider(pool[0]) == "muse":
        return pool  # 3,000 requests a minute: no need to spread, so the newest Spark always goes first
    lead = next((k for k, m in enumerate(pool) if syn.provider(m) != syn.provider(pool[0])), len(pool))
    j = i % lead
    return pool[j:lead] + pool[:j] + pool[lead:]


def _ground_section(out: SectionOutput, lo: float, segments: list[Segment], frames: list[Frame], duration: float):
    chapter = Chapter(title=out.title, start_seconds=lo, notes=out.notes, summary=out.summary,
                      key_terms=out.key_terms[:6])
    return ground(LearnOutput(title=out.title, chapters=[chapter], quiz=out.quiz), segments, frames, duration)


CARD_PROMPT = """A clean one-page summary card for a video, in a flat editorial style: off-white background (#f6f6f1),
near-black text, one vermillion accent (#ff5701), generous margins, large legible type, no photos, no logos.
Show the title "{title}" at the top, then exactly these lines as a short list, word for word, and no other text:
{lines}"""


def run(job_dir: Path, update: Callable[..., None], src: Source | None = None, emit: Emit = _quiet) -> LearnResult:
    src = src or local_source(job_dir)
    duration = src.duration
    if duration > MAX_DURATION_S:  # uploads are checked earlier; links only know their real length here
        raise ValueError(f"Video is {duration / 3600:.1f} h; the limit is {MAX_DURATION_S // 3600} hours")
    pool = syn.models()
    emit("source", duration=round(duration, 2), streaming=src.scan is not None, youtube_id=src.youtube_id,
         transcript="subtitles" if src.captions is not None else ("speech" if src.audio else "none"),
         caption_lines=len(src.captions or []), models=pool)

    # Listen-first: with Muse, speech and no subtitles, each section goes to Spark at once as a clip with sound,
    # while the whole audio is transcribed alongside; the transcript then checks the quotes. Notes no longer wait
    # for speech recognition (Kafka, 5 min: about 16 s before this).
    fast = bool(os.environ.get("MODEL_API_KEY")) and bool(src.audio) and src.captions is None \
        and any(syn.provider(m) == "muse" for m in pool)
    # Subtitles make speech recognition unnecessary, so the audio is not even fetched.
    audio = None
    if src.audio and src.captions is None and not fast:
        started = time.monotonic()
        emit("stage", name="audio", state="start", detail="Pulling the audio track into memory (16 kHz mono)")
        audio = load_audio(src.audio, src.headers)
        emit("stage", name="audio", state="end", seconds=_since(started), samples=len(audio))
    sections = plan_sections(audio, duration, src.captions)  # listen-first: fixed cuts, no waiting for audio
    emit("plan", sections=sections)
    update("transcribing", sections_done=0, sections_total=len(sections))

    lock = threading.Lock()
    done: dict[int, Part] = {}
    state = {"transcriber": "creator subtitles" if src.captions is not None else "none (no audio track)",
             "overview": None, "actions": [], "scenarios": [], "extra_rejected": [], "card": None, "takeaways": [],
             "diagram": None, "questions": [], "further": [], "pending": False, "claims": []}

    def assemble() -> LearnResult:
        parts = [done[i] for i in sorted(done)]
        chapters = [p.chapter for p in parts if p.chapter]
        overview: Overview | None = state["overview"]
        rejected = [r for p in parts for r in p.rejected] + state["extra_rejected"]
        return LearnResult(
            title=overview.title if overview else (chapters[0].title if chapters else "Untitled video"),
            tldr=overview.tldr if overview else "",
            chapters=chapters,
            quiz=[q for p in parts for q in p.quiz],
            duration_seconds=round(duration, 2),
            transcriber=state["transcriber"],
            model=", ".join(sorted({p.model for p in parts if p.chapter})),
            dropped_notes=len(rejected),
            youtube_id=src.youtube_id,
            notes_checked=sum(p.checked for p in parts),
            citations_rechecked=sum(p.rechecked for p in parts),
            rejected=rejected,
            mode=overview.mode if overview else "learn",
            actions=state["actions"],
            scenarios=state["scenarios"],
            card_url=state["card"],
            takeaways=state["takeaways"],
            diagram=state["diagram"],
            questions=state["questions"],
            further=state["further"],
            pending=state["pending"],
            claims=state["claims"],
        )

    grabbed: list[Frame] = []  # frames grabbed at the seconds Spark cited, listen-first only

    def hear_all() -> list[Segment]:
        """Never raises: sections wait on it, so a failed fetch would sink them all. Without a transcript their
        quotes can't be checked and are dropped; notes with on-screen proof still stand."""
        started = time.monotonic()
        emit("stage", name="audio", state="start", detail="Pulling the audio track into memory (16 kHz mono)")
        for attempt in range(2):  # YouTube's audio stream occasionally refuses a request (ffmpeg exit 8)
            try:
                whole = load_audio(src.audio, src.headers)
                break
            except subprocess.CalledProcessError:
                log.warning("audio fetch failed (attempt %d)", attempt + 1)
        else:
            emit("stage", name="audio", state="end", seconds=_since(started), error="the audio stream refused us twice")
            return []
        emit("stage", name="audio", state="end", seconds=_since(started), samples=len(whole))
        segs, state["transcriber"] = transcribe(whole)
        for i, (lo, hi) in enumerate(sections):
            emit("transcript", task=f"s{i}", engine=state["transcriber"], seconds=_since(started),
                 lines=[x.__dict__ for x in segs if lo <= x.start < hi])
        return segs

    def evidence_for(out: SectionOutput) -> tuple[list[Segment], list[Frame]]:
        """For the check: the whole transcript, and a real frame at every second Spark cited that no keyframe
        covers (grabbed from the video now), so on-screen proof is checked against an actual image."""
        segs = heard_f.result()
        have = [*(frames_f.result() if frames_f.done() else []), *grabbed]
        cited = {round(ev.start_seconds, 1) for n in out.notes for ev in n.evidence if ev.kind == "frame"}
        need = [t for t in cited if 0 <= t <= duration and not any(abs(f.t - t) <= FRAME_WINDOW_S for f in have)]

        def grab(t: float) -> Frame:
            (job_dir / "frames").mkdir(exist_ok=True)  # a fast section can come back before the keyframes exist
            name = f"at{int(t * 10)}.jpg"
            fr.extract_frame(src.video, t, job_dir / "frames" / name, src.headers)
            return Frame(t=t, url=f"frames/{name}")

        with ThreadPoolExecutor(max_workers=max(1, len(need))) as pool_:
            new = list(pool_.map(grab, need))
        with lock:
            grabbed.extend(new)
        return segs, have + new

    def section(i: int, lo: float, hi: float, segs: list[Segment]) -> None:
        # Publishes inside the task, not in a done-callback: callbacks run after waiters wake, so the card once read
        # an empty result and drew an invented list.
        try:
            if fast:
                # Spark 1.2 first here: on the same sections it was steadier (4.7-6.0 s vs 6.1-11 s) and Meta's docs
                # say its audio understanding is fuller than 1.3's.
                order = sorted(_model_order(pool, i), key=lambda m: m != "muse:muse-spark-1.2")
                part = write_section(lo, hi, [], [], job_dir, duration, order, emit, i,
                                     _clip(src, lo, hi, emit, f"s{i}", pool, sound=True), listen=evidence_for)
            else:
                part = write_section(lo, hi, segs, [x for x in frames_f.result() if lo <= x.t < hi], job_dir, duration,
                                     _model_order(pool, i), emit, i, _clip(src, lo, hi, emit, f"s{i}", pool))
        except Exception:
            log.exception("section %d failed on every model", i)
            part = Part(None, [], "failed")
        emit("section", task=f"s{i}", ok=part.chapter is not None, model=part.model,
             title=part.chapter.title if part.chapter else None,
             notes=len(part.chapter.notes) if part.chapter else 0, rejected=len(part.rejected))
        with lock:  # partial result first, then the counter the UI polls, so it never sees a count without data
            done[i] = part
            (job_dir / "result.json").write_text(assemble().model_dump_json(indent=2))
            update(None, sections_done=len(done))

    def listen(i: int, lo: float, hi: float) -> tuple[list[Segment], str, float]:
        started = time.monotonic()
        emit("stage", name="transcribe", state="start", task=f"s{i}", detail=f"Listening to {lo:.0f}-{hi:.0f}s")
        local, engine = transcribe(audio[int(lo * SAMPLE_RATE) : int(hi * SAMPLE_RATE)])
        return [Segment(round(s.start + lo, 2), round(s.end + lo, 2), s.text) for s in local], engine, _since(started)

    def whole_video(all_segments: list[Segment], frames: list[Frame], ex: ThreadPoolExecutor) -> None:
        """Title and summary, then takeaways and diagram."""
        try:
            messages = syn.overview_messages(all_segments, frames)
            state["overview"] = hedged(_model_order(pool, len(sections)), lambda m: syn.ask(messages, m, Overview)[0],
                                       "overview", emit, "overview")
            emit("overview", title=state["overview"].title, tldr=state["overview"].tldr)
        except Exception:
            log.exception("overview failed; falling back to the first chapter title")
        ex.submit(_visual, all_segments, frames, job_dir, duration, pool, state, emit).exception()  # logs its own failure

    all_segments: list[Segment] = []
    # Muse ASR runs ~8 s per audio minute, so sections go out together (5 x 60 s: 10 s, vs 40 s for one 300 s
    # request). Local ASR is one model on one machine: one worker keeps sections in order, first notes first.
    with (ThreadPoolExecutor(max_workers=len(sections) + 4) as ex,
          ThreadPoolExecutor(max_workers=len(sections) if os.environ.get("MODEL_API_KEY") else 1) as ears):
        frames_f = ex.submit(_keyframes, src, job_dir, emit)  # overlaps with transcription
        # Diagram tracking and screen reading feed the Keyframes tab and Ask, not the notes: their own pool, which
        # the job never waits on.
        side = ThreadPoolExecutor(max_workers=2)
        tracked = side.submit(_track_figures, src, emit) if os.environ.get("MODEL_API_KEY") else None  # video only
        screens_f = side.submit(lambda: _read_screens(frames_f.result(), job_dir, emit, tracked))
        side.shutdown(wait=False)
        if fast:
            heard_f = ex.submit(hear_all)
            futures = [ex.submit(section, i, lo, hi, []) for i, (lo, hi) in enumerate(sections)]
            update("writing_notes")
            for f in futures:
                f.exception()
            all_segments = heard_f.result() if not heard_f.exception() else []
        else:
            heard = [ears.submit(listen, i, lo, hi) for i, (lo, hi) in enumerate(sections)] \
                if src.captions is None and audio is not None else []
            futures = []
            for i, (lo, hi) in enumerate(sections):
                segs: list[Segment] = []
                took = 0.0
                if src.captions is not None:
                    segs = [s for s in src.captions if lo <= s.start < hi]
                elif heard:
                    segs, state["transcriber"], took = heard[i].result()
                emit("transcript", task=f"s{i}", engine=state["transcriber"], seconds=took,
                     lines=[s.__dict__ for s in segs])
                all_segments += segs
                # The section's task waits for the keyframes, not this loop: the next section keeps transcribing.
                futures.append(ex.submit(section, i, lo, hi, segs))
            update("writing_notes")
            whole_video(all_segments, frames_f.result(), ex)  # beside the sections, which read the transcript too
            for f in futures:
                f.exception()  # failures are already recorded in section()

    # A new list: screen reading and diagram tracking may still be walking the keyframe list by index, so it must
    # never change under them (appending and sorting it once reported one image at two indices).
    with lock:
        frames = sorted([*frames_f.result(), *(g for g in grabbed if all(abs(g.t - f.t) > 0.05 for f in frames_f.result()))],
                        key=lambda f: f.t)
    state["pending"] = fast  # listen-first: title, takeaways and diagram follow right after the notes
    result = assemble()
    if not result.chapters:
        raise RuntimeError("No section produced grounded notes; see the API log for model errors")
    (job_dir / "result.json").write_text(result.model_dump_json(indent=2))
    # Transcript and frames stay next to the result: "Ask the video" answers from them, and evaluation and
    # debugging can see what the model saw.
    (job_dir / "transcript.json").write_text(json.dumps([s.__dict__ for s in all_segments], indent=2))

    def save_frames(_=None) -> None:
        (job_dir / "frames.json").write_text(json.dumps([f.__dict__ for f in frames], indent=2))

    save_frames()  # now (times and images), and again with the screen text once that finishes
    screens_f.add_done_callback(save_frames)  # screen reading isn't part of the notes; the job doesn't wait for it

    def after() -> None:
        """The work that follows the notes: whole-video outputs (listen-first), then the card and web sources."""
        if fast:
            with ThreadPoolExecutor(max_workers=3) as ex2:
                whole_video(all_segments, frames, ex2)
            state["pending"] = False
            with lock:
                (job_dir / "result.json").write_text(assemble().model_dump_json(indent=2))
        if os.environ.get("MODEL_API_KEY"):
            _extras(assemble, job_dir, state, emit, lock)

    threading.Thread(target=after, daemon=True).start()
    return result
