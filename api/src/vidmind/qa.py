"""Ask the video: a question answered from the finished job's transcript and keyframes, checked like a note."""

import base64
import io
import json
import re
import threading
import time
from pathlib import Path

from PIL import Image
from pydantic import BaseModel

from . import synthesize as syn
from .pipeline import hedged
from .schema import Answer, Chapter, Frame, LearnOutput, LearnResult, Note, Segment, check_deck, ground

NOT_FOUND = "I couldn't find that in this video."


def answer(job_dir: Path, question: str) -> Answer:
    """Raises FileNotFoundError until the job has finished. An answer whose evidence fails the check is replaced
    by NOT_FOUND: the viewer never sees a claim that can't be traced to the video."""
    segments = [Segment(**s) for s in json.loads((job_dir / "transcript.json").read_text())]
    frames = [Frame(**f) for f in json.loads((job_dir / "frames.json").read_text())]
    duration = json.loads((job_dir / "result.json").read_text())["duration_seconds"]
    messages = syn.ask_messages(question, segments, frames)
    started = time.monotonic()

    def attempt(model: str) -> Answer:
        out, raw = syn.ask(messages, model, Answer)
        if not out.found:
            checked, rechecked = Answer(answer=out.answer or NOT_FOUND, found=False), 0
        else:
            checked, problems = _check(out, segments, frames, duration)
            rechecked = len(problems)
            if problems:
                out, _ = syn.ask(syn.repair_messages(messages, raw, problems), model, Answer)
                checked, problems = _check(out, segments, frames, duration)
        return checked.model_copy(update={"model": model, "rechecked": rechecked,
                                          "seconds": round(time.monotonic() - started, 2)})

    return hedged(syn.models(), attempt, "question")  # not in the video: says so, never a web answer



def _check(out: Answer, segments: list[Segment], frames: list[Frame], duration: float) -> tuple[Answer, list[str]]:
    wrapped = LearnOutput(title="", quiz=[], chapters=[
        Chapter(title="", start_seconds=0, notes=[Note(text=out.answer, evidence=out.evidence)])])
    clean, problems, _ = ground(wrapped, segments, frames, duration)
    if not clean.chapters:
        return Answer(answer=NOT_FOUND, found=False), problems
    return Answer(answer=out.answer, evidence=clean.chapters[0].notes[0].evidence), problems


def point(job_dir: Path, frame_url: str, x: float, y: float, question: str) -> Answer:
    """Point and ask: SAM finds the object at (x, y) on one of the job's keyframes (fractions of its width and height),
    Spark explains it from the frame, an enlarged crop and the transcript nearby, and the answer is checked like Ask."""
    segments = [Segment(**s) for s in json.loads((job_dir / "transcript.json").read_text())]
    frames = [Frame(**f) for f in json.loads((job_dir / "frames.json").read_text())]
    frame = next((f for f in frames if f.url == frame_url), None)
    if frame is None:  # only the job's own keyframes: never a path the caller made up
        raise LookupError("unknown frame")
    duration = json.loads((job_dir / "result.json").read_text())["duration_seconds"]
    path = job_dir / frame.url
    image = Image.open(path)
    w, h = image.size
    px, py = int(x * w), int(y * h)
    box = syn.segment_at(path.read_bytes(), px, py, w, h) or \
        (max(0, px - w // 8), max(0, py - h // 8), min(w, px + w // 8), min(h, py + h // 8))  # nothing segmented: the area around the point
    pad = 12
    crop = image.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad)))
    crop = crop.resize((max(1, crop.width * 2), max(1, crop.height * 2))) if crop.width < 400 else crop
    buf = io.BytesIO()
    crop.convert("RGB").save(buf, "JPEG", quality=88)
    near = [s for s in segments if abs(s.start - frame.t) <= 20]
    as_url = lambda b: "data:image/jpeg;base64," + base64.b64encode(b).decode()  # noqa: E731
    messages = [{"role": "system", "content": syn.POINT_SYSTEM}, {"role": "user", "content": [
        {"type": "text", "text": f"QUESTION\n{question}\n\nFRAME at {frame.t:g}s\n\nTRANSCRIPT NEARBY\n" +
         ("\n".join(f"[{s.start:.1f}-{s.end:.1f}] {s.text}" for s in near) or "(no speech)")},
        {"type": "text", "text": "The whole frame:"}, {"type": "image_url", "image_url": {"url": as_url(path.read_bytes())}},
        {"type": "text", "text": "What they pointed at, enlarged:"}, {"type": "image_url", "image_url": {"url": as_url(buf.getvalue())}}]}]
    started = time.monotonic()

    def attempt(model: str) -> Answer:
        out, _ = syn.ask(messages, model, Answer)
        checked, _ = _check(out, segments, frames, duration) if out.found else (Answer(answer=out.answer or NOT_FOUND, found=False), [])
        return checked.model_copy(update={"model": model, "seconds": round(time.monotonic() - started, 2), "box": list(box)})

    return hedged(syn.models(), attempt, "pointed question")


class _DeckReply(BaseModel):
    cards: list[dict] = []  # loose: one malformed card is dropped by check_deck, never a second (paid) call


_deck_locks: dict[str, threading.Lock] = {}
DECK_COOLDOWN_S = 300
_deck_locks_guard = threading.Lock()


def deck(job_dir: Path) -> dict:
    """The study deck: flashcards Spark writes from the checked notes and takeaways, each kept only if it cites a real
    note and one of that note's seconds. Made once on first request, then served from deck.json.
    Raises FileNotFoundError until the notes are finished."""
    with _deck_locks_guard:
        lock = _deck_locks.setdefault(str(job_dir), threading.Lock())
    with lock:  # a second request waits for the first and reads its deck, so the model is called once per job
        path = job_dir / "deck.json"
        if path.exists():
            return json.loads(path.read_text())
        result = LearnResult.model_validate_json((job_dir / "result.json").read_text())
        if result.pending:
            raise FileNotFoundError("takeaways still being written")
        notes = [n for c in result.chapters for n in c.notes] + result.takeaways
        out = {"cards": [], "dropped": 0}
        if notes:
            err = job_dir / "deck.err"
            if err.exists() and time.time() - err.stat().st_mtime < DECK_COOLDOWN_S:  # a failed try isn't re-paid on every tab open
                raise RuntimeError("The model couldn't write the cards a moment ago. Try again in a few minutes.")
            try:
                reply, _ = syn.ask(syn.deck_messages(notes), syn.READER, _DeckReply)
            except Exception:
                err.touch()
                raise
            cards, dropped = check_deck(reply.cards, notes)
            out = {"cards": [c.model_dump() for c in cards], "dropped": dropped}
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(out))
        tmp.replace(path)
        return out


NOT_ACROSS = "None of these videos covers that."
PER_VIDEO = 5  # snippets per video: ten videos stay one short prompt
_STOP = set("""a an and are about after all also any been but can could did does doing for from had has have how into
its just more most not of off on one only or our out over said say says she should so some than that the their them
then there these they this those through too use used very was way were what when where which while who why will
with would you your video videos explain tell show shows""".split())


def _terms(text: str) -> set[str]:
    # Lowercase words minus filler, plurals folded ("services" finds "service").
    return {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", text.lower())
            if len(w) > 2 and w not in _STOP}


def top_snippets(items: list[tuple[float, str]], question: str, k: int = PER_VIDEO) -> list[tuple[float, str]]:
    """The k (second, text) items sharing the most words with the question, best first; none share any: []."""
    want = _terms(question)
    scored = [(len(want & _terms(text)), -t, t, text) for t, text in items]
    return [(t, text) for score, _, t, text in sorted(scored, reverse=True)[:k] if score]


def _items(job_dir: Path) -> tuple[str, list[tuple[float, str]], list[tuple[float, str]]]:
    """A finished job's title, its searchable (second, text) items, and its takeaways for questions no word matches.
    Raises FileNotFoundError until the job has finished."""
    result = LearnResult.model_validate_json((job_dir / "result.json").read_text())
    segments = json.loads((job_dir / "transcript.json").read_text())
    frames = json.loads((job_dir / "frames.json").read_text())
    noted = lambda notes: [(n.evidence[0].start_seconds, n.text) for n in notes if n.evidence]  # noqa: E731
    items = [(s["start"], s["text"]) for s in segments] + [(f["t"], f["ocr_text"]) for f in frames if f.get("ocr_text")]
    return result.title, items + noted([n for c in result.chapters for n in c.notes] + result.takeaways), noted(result.takeaways)


class _AcrossReply(BaseModel):
    answer: str = ""
    found: bool = True
    citations: list[int] = []


def across(dirs: dict[str, Path], question: str) -> dict:
    """One answer from up to ten finished videos: words in the question pick each video's closest lines, notes and
    screen text, Spark answers from those numbered snippets alone, and a citation survives only if its number is
    one of them, so every chip points at a real second of a real video."""
    snippets = []
    for job_id, d in dirs.items():
        try:
            title, items, takeaways = _items(d)
        except FileNotFoundError:
            continue  # still processing: nothing checked to quote yet
        for t, text in top_snippets(items, question) or takeaways[:2]:
            snippets.append({"job_id": job_id, "title": title, "start_seconds": t, "quote": text.strip()[:300]})
    if not snippets:
        return {"answer": NOT_ACROSS, "citations": []}
    reply, _ = syn.ask(syn.across_messages(question, snippets), syn.READER, _AcrossReply)
    cited = [snippets[n - 1] for n in dict.fromkeys(reply.citations) if 1 <= n <= len(snippets)]
    if not reply.found or not cited or not reply.answer.strip():
        return {"answer": NOT_ACROSS, "citations": []}
    return {"answer": reply.answer.strip(), "citations": cited}
