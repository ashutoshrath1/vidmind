"""LLM calls: one per video section (run in parallel across a model pool), a whole-video overview, and Q&A."""

import base64
import json
import logging
import os
import re
import threading
from collections.abc import Callable
from pathlib import Path

import openai
from pydantic import BaseModel

from . import models as mdl
from .schema import Frame, Segment

log = logging.getLogger(__name__)

SECTION_SYSTEM = """You write study notes for ONE section of a lecture or product-demo video.
You get the section's transcript (timestamps in seconds) and keyframes (timestamp, OCR text, sometimes the image).

Rules:
- Every note cites evidence: {"kind":"transcript","start_seconds":<segment start>,"quote":<3-15 words copied verbatim from that segment>}
  and/or {"kind":"frame","start_seconds":<exact frame timestamp from the list>,"text":<what the frame shows>}.
- Prefer facts that appear ONLY on screen (numbers, labels, diagrams, code, UI text): they are the point of this tool.
  When a frame shows a diagram or list, describe what it shows in the note.
- If speech or screen text is unclear, keep the note but set "uncertain": true with an "uncertain_reason".
- 2-4 notes for this section.
- Notes are about the subject, written like a tutorial. Never about the video itself: no "the frame shows",
  "the opening frame has no text", "the speaker says", "the slide is titled". State the fact; the citation shows where.
- Do not invent facts.

Return ONLY one JSON object with exactly this shape, notes first (values are placeholders):
{"notes": [{"text": "One factual note.", "uncertain": false, "uncertain_reason": null,
   "evidence": [{"kind": "transcript", "start_seconds": 12.3, "quote": "exact words from that segment"},
                {"kind": "frame", "start_seconds": 30.0, "text": "what the frame shows"}]}],
 "title": "Section title", "summary": "1-2 sentence summary of the section", "key_terms": ["term", "term"]}"""

OVERVIEW_SYSTEM = """You read a video's transcript and on-screen text and return ONLY this JSON:
{"title": "Short descriptive title of the video", "tldr": "2-3 sentence summary of what the viewer learns",
 "mode": "learn" | "meet" | "test"}
mode: "meet" for a meeting or call where people discuss, decide and assign work; "test" for a product or app demo
that walks through UI flows (clicking, typing, navigating); "learn" for anything else (lectures, talks, tutorials).
Spell names (products, people) as the on-screen text does; speech recognition often misspells them."""

_EVIDENCE = """Every item cites evidence: {"kind":"transcript","start_seconds":<segment start>,"quote":<3-15 words copied
verbatim from that segment>} and/or {"kind":"frame","start_seconds":<exact frame timestamp from the list>,"text":<what
the frame shows>}. Do not invent anything; an item you cannot cite is left out."""

VISUAL_SYSTEM = f"""You read ONE whole video and return its key takeaways and, if the video explains one, a diagram.
You get the transcript (timestamps in seconds) and keyframes (timestamp, OCR text, sometimes the image).
{_EVIDENCE}
- takeaways: the 3-5 points a viewer should remember, each one sentence.
- questions: 3 short questions (under 60 characters) a curious viewer would ask next and this video answers:
  specific and intriguing ("Why does Kafka keep messages after they're read?"), never "What does it say about X?".
- diagram: only if the video explains a system, process or API exchange; otherwise null.
  kind "architecture" (components and how they connect), "flowchart" (steps and decisions), or "sequence" (who calls
  whom, in order). 3-10 nodes; each node's "text" is a short label (1-4 words) with evidence. Edges use node ids,
  in order, with a short label ("calls", "yes", "returns token") or "".

Return ONLY: {{"takeaways": [{{"text": "One sentence.", "evidence": [...]}}], "questions": ["A question?"],
 "diagram": {{"kind": "flowchart", "title": "Short title", "nodes": [{{"id": "a", "text": "Label", "evidence": [...]}}],
   "edges": [{{"source": "a", "target": "b", "label": ""}}]}}}}"""

MODE_SYSTEM = {"visual": VISUAL_SYSTEM}


def _fmt_segments(segments: list[Segment]) -> str:
    return "\n".join(f"[{s.start:.1f}-{s.end:.1f}] {s.text}" for s in segments) or "(no speech)"


def _fmt_frames(frames: list[Frame]) -> str:
    return "\n".join(
        f"[frame {f.t:g}s] OCR{' (low confidence)' if f.low_conf else ''}: {f.ocr_text.replace(chr(10), ' | ') or '(no text)'}"
        for f in frames
    ) or "(no keyframes)"


def section_messages(
    segments: list[Segment], frames: list[Frame], lo: float, hi: float, job_dir: Path, vision: bool,
) -> list[dict]:
    text = f"Section {lo:.0f}s-{hi:.0f}s\n\nTRANSCRIPT\n{_fmt_segments(segments)}\n\nKEYFRAMES\n{_fmt_frames(frames)}"
    content: list[dict] = [{"type": "text", "text": text}]
    if vision and frames:
        # NVIDIA-hosted Muse Glimmer returns a bare 500 above 8 images; OCR text above still covers every frame.
        n = min(int(os.environ.get("LLM_MAX_IMAGES", "8")), len(frames))
        picks = sorted({round(i * (len(frames) - 1) / max(1, n - 1)) for i in range(n)})  # evenly spaced
        for f in (frames[i] for i in picks):
            b64 = base64.b64encode((job_dir / f.url).read_bytes()).decode()
            content += [
                {"type": "text", "text": f"Frame at {f.t:g}s:"},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ]
            if f.figure_url:  # the diagram SAM found, enlarged, so small labels are readable
                fig = base64.b64encode((job_dir / f.figure_url).read_bytes()).decode()
                content += [{"type": "text", "text": f"The diagram in the frame at {f.t:g}s, enlarged:"},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{fig}"}}]
    return [{"role": "system", "content": SECTION_SYSTEM}, {"role": "user", "content": content}]


SCREEN_SYSTEM = """You add what ONE video shows on screen and its notes miss. You get the notes already written
(from the transcript) and the video's keyframes (timestamp, screen text, some images).
- Only facts visible on screen (numbers, labels, diagrams, code, UI text) that no note below already states.
- Every note cites a keyframe: {"kind":"frame","start_seconds":<exact frame timestamp from the list>,"text":<what it shows>}.
- 0-8 notes; none is fine. Do not invent facts.
- State the fact itself, tutorial style ("Config Server stores its settings in GitHub"), never "the diagram shows..."
  or notes about what a frame lacks.
Return ONLY: {"title": "On screen", "notes": [{"text": "...", "uncertain": false, "uncertain_reason": null,
  "evidence": [{"kind": "frame", "start_seconds": 30.0, "text": "..."}]}]}"""


def screen_messages(notes: list[str], frames: list[Frame], duration: float, job_dir: Path) -> list[dict]:
    """The keyframes of the whole video, with the notes already written, for the on-screen pass."""
    messages = section_messages([], frames, 0, duration, job_dir, True)
    written = "\n".join(f"- {n}" for n in notes)
    messages[1]["content"][0]["text"] = f"NOTES ALREADY WRITTEN\n{written}\n\n" + messages[1]["content"][0]["text"]
    return [{"role": "system", "content": SCREEN_SYSTEM}, messages[1]]


ARTICLE_SYSTEM = """You turn ONE chapter's checked notes into a short tutorial section people want to keep reading,
in the style of a good GeeksforGeeks or engineering-blog article. The numbered notes are your ONLY source.
- hook: one sentence that opens with the most concrete thing in the notes (a number, an example, an output, a name).
- paragraphs: 2-5 short paragraphs. Conclusion first, then the detail. Lead with the example, explain after.
  Short sentences. Proof, not adjectives.
- Every paragraph lists "cites": the numbers of the notes it rests on (at least one). State nothing that is not in
  the notes it cites: no outside facts, no guesses, no numbers you did not see.
- Write about the subject, never about the video ("the speaker says", "this video shows" are banned).
- Banned: "In today's...", "game-changer", "cutting-edge", "revolutionary", "here's why this matters",
  "let's dive in", warm-up sentences, rhetorical or closing questions, em dashes.
- visual: the one picture for this chapter.
  - "keyframe" when one of the KEYFRAMES listed shows this chapter's idea well (a slide, diagram, code or chart with
    real screen text): set "keyframe_t" to its exact time from the list. A real picture beats a drawn one.
    Never pick a talking head, title card or blank screen. With no KEYFRAMES listed, keyframe is not allowed.
  - "illustration" when the chapter has a process, comparison, structure, timeline or numbers that a drawing would
    explain better than words. Set "type" (infographic, flowchart, comparison, framework, timeline or scene) and
    "prompt": a structured image prompt written like this, using this chapter's actual terms and numbers:
      Layout: <composition and flow direction, e.g. three zones left to right>
      ZONES: Zone 1: <what it shows, as concrete objects and icons> / Zone 2: ... / Zone 3: ...
      RELATIONSHIPS: <how the zones connect: arrows, grouping, sizes that encode amounts>
      COLORS: <semantic colors, e.g. green = efficient, red = failure, one accent for the key idea>
    Things are shown as objects, icons and shapes, never as words: no text, labels or numbers in the picture.
  - "none" when neither helps (a short or abstract chapter).
- picture: one sentence describing the chosen visual for a reader who cannot see it (its alt text).
Return ONLY: {"hook": "...", "paragraphs": [{"text": "...", "cites": [0, 2]}], "picture": "...",
 "visual": {"kind": "keyframe|illustration|none", "type": "...", "prompt": "...", "keyframe_t": 12.0}}"""


def article_messages(title: str, summary: str, key_terms: list[str], notes: list[str],
                     keyframes: list[Frame] | None = None) -> list[dict]:
    """keyframes: the chapter's keyframes, or None when they are not captured yet (then only illustration or none)."""
    numbered = "\n".join(f"[{i}] {n}" for i, n in enumerate(notes))
    frames = "\n".join(f"[{f.t:g}s] {f.ocr_text.replace(chr(10), ' | ') or '(screen text not read)'}" for f in keyframes or [])
    text = (f"CHAPTER: {title}\nSUMMARY: {summary}\nKEY TERMS: {', '.join(key_terms)}\n\nNOTES\n{numbered}"
            f"\n\nKEYFRAMES\n{frames or '(none)'}")
    return [{"role": "system", "content": ARTICLE_SYSTEM}, {"role": "user", "content": text}]


SLIDES_SYSTEM = """You explain the keyframes of ONE video. For each keyframe you get its timestamp, its screen text,
and what was said around it.
- Skip keyframes with no meaningful content: logos, title cards, blank or nearly blank screens, talking heads,
  and repeats of a screen already explained.
- For each one kept: "t" (its exact timestamp from the list), "title" (2-6 words), "explanation" (1-2 sentences: what
  it shows and why it matters). Use only its screen text and what was said; invent nothing. No em dashes.
Return ONLY: {"slides": [{"t": 30.0, "title": "...", "explanation": "..."}]}"""


def slides_messages(frames: list[Frame], segments: list[Segment], around: float = 15.0) -> list[dict]:
    blocks = []
    for f in frames:
        said = " ".join(s.text for s in segments if f.t - around <= s.start <= f.t + around)
        blocks.append(f"[frame {f.t:g}s]\nSCREEN: {f.ocr_text.replace(chr(10), ' | ') or '(no text)'}\nSAID: {said or '(nothing)'}")
    return [{"role": "system", "content": SLIDES_SYSTEM}, {"role": "user", "content": "\n\n".join(blocks) or "(no keyframes)"}]


def mode_messages(mode: str, segments: list[Segment], frames: list[Frame], duration: float, job_dir: Path,
                  vision: bool) -> list[dict]:
    """The whole video at once (Spark's 1M context holds a 10 min transcript easily) for the whole-video outputs."""
    messages = section_messages(segments, frames, 0, duration, job_dir, vision)
    return [{"role": "system", "content": MODE_SYSTEM[mode]}, messages[1]]


def overview_messages(segments: list[Segment], frames: list[Frame]) -> list[dict]:
    text = f"TRANSCRIPT\n{_fmt_segments(segments)}\n\nON-SCREEN TEXT\n{_fmt_frames(frames)}"
    return [{"role": "system", "content": OVERVIEW_SYSTEM}, {"role": "user", "content": text}]


def _without_images(messages: list[dict]) -> list[dict]:
    return [
        {**m, "content": [p for p in m["content"] if p["type"] == "text"]} if isinstance(m["content"], list) else m
        for m in messages
    ]


def complete(messages: list[dict], model: str, on_text: Callable[[str], None] | None = None) -> str:
    try:
        return _complete(messages, model, on_text)
    except openai.InternalServerError:
        # Hosted vision endpoints fail opaquely on image payloads; text + OCR still produces grounded notes.
        if _without_images(messages) == messages:
            raise
        log.warning("%s: server error with images; retrying text-only", model)
        return _complete(_without_images(messages), model, on_text)


def _complete(messages: list[dict], model: str, on_text: Callable[[str], None] | None = None) -> str:
    prov = mdl.of(model)
    client = mdl.client(prov.name)
    # A section's JSON is ~1-2K tokens; the cap stops a degenerate stream (NVIDIA's gpt-oss-20b once sent whitespace
    # for 218 s) from holding a section hostage.
    max_tokens = int(os.environ.get("LLM_MAX_TOKENS", "4096"))
    # Reasoning models think before answering; at default effort Muse Glimmer took 5+ min per video, "low" ~1.5.
    effort = mdl.reasoning_effort(prov)
    # Servers differ in which options they accept; step down until one works. Parsing + ground() enforce the contract.
    variants = [{"response_format": {"type": "json_object"}}, {}]
    if effort:
        variants.insert(0, {"response_format": {"type": "json_object"}, "reasoning_effort": effort})
    for i, extra in enumerate(variants):
        try:
            with mdl.slot(prov):
                stream = client.chat.completions.create(
                    model=mdl.bare(model), messages=messages, temperature=0.2, max_tokens=max_tokens, stream=True, **extra
                )
                parts, finish = [], None
                for chunk in stream:
                    if chunk.choices:
                        parts.append(chunk.choices[0].delta.content or "")
                        finish = chunk.choices[0].finish_reason or finish
                        if on_text and chunk.choices[0].delta.content:
                            on_text("".join(parts))  # the reply so far, for notes shown as they are written
            if finish == "length":
                log.warning("%s hit max_tokens=%d; reply is likely cut off", model, max_tokens)
            return "".join(parts)
        except openai.BadRequestError:
            if i == len(variants) - 1:
                raise
    raise AssertionError("unreachable")


def finished_items(text: str, key: str = "notes") -> list[str]:
    """The complete JSON objects so far in the `key` array of a reply still being streamed, in order. Strings are
    tracked, so braces inside quoted text don't count."""
    at = text.find(f'"{key}"')
    start = text.find("[", at) if at >= 0 else -1
    if start < 0:
        return []
    items, depth, begin, in_str, esc = [], 0, -1, False, False
    for k in range(start + 1, len(text)):
        c = text[k]
        if in_str:
            esc, in_str = (False, True) if esc else (c == "\\", c != '"')
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
            if depth == 1:
                begin = k
        elif c == "}":
            depth -= 1
            if depth == 0 and begin >= 0:
                items.append(text[begin : k + 1])
        elif c == "]" and depth == 0:
            break
    return items


def _parse[T: BaseModel](text: str, cls: type[T]) -> T:
    # Tolerate code fences or chatter around the JSON object.
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError(f"Model reply contained no JSON object: {text[:200]!r}")
    return cls.model_validate(json.loads(text[start : end + 1]))


def ask[T: BaseModel](messages: list[dict], model: str, cls: type[T],
                       on_text: Callable[[str], None] | None = None) -> tuple[T, str]:
    """Returns (parsed reply, raw text). Retries once if the reply is not valid JSON for `cls`.
    on_text gets the reply so far as it streams in (first attempt only)."""
    raw = complete(messages, model, on_text)
    try:
        return _parse(raw, cls), raw
    except ValueError as e:  # pydantic ValidationError and JSONDecodeError are both ValueErrors
        log.warning("%s reply did not match %s (%s). Reply starts: %s", model, cls.__name__, e, raw[:500])
        raw = complete(messages + [
            {"role": "assistant", "content": raw},
            {"role": "user", "content": f"That was not valid JSON for the schema: {e}. Return the full corrected JSON only."},
        ], model)
        return _parse(raw, cls), raw


def repair_messages(messages: list[dict], raw: str, problems: list[str]) -> list[dict]:
    issues = "\n".join(f"- {p}" for p in problems[:30])
    return messages + [
        {"role": "assistant", "content": raw},
        {"role": "user", "content": f"These citations failed verification:\n{issues}\n"
         "Fix or remove them. Use only real frame timestamps and verbatim quotes. Return the full corrected JSON only."},
    ]


FIGURE = "diagram"  # SAM concept; on slide videos "screen" and "slide" matched nothing, "diagram" finds the figures
_BOX = re.compile(r"<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)")


def _track_muse(model: str, video: bytes, concept: str) -> dict[int, list[tuple[int, int, int, int, int, int]]]:
    """Muse's SAM 3.1 over the Responses API: a video in, one line of boxes per frame out."""
    b64 = base64.b64encode(video).decode()
    prov = mdl.of(model)
    with mdl.slot(prov):
        resp = mdl.client(prov.name).responses.create(model=mdl.bare(model), input=[{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": concept},
            {"type": "input_video", "video_url": f"data:video/mp4;base64,{b64}"}]}])
    out: dict[int, list] = {}
    for line in (resp.output_text or "").splitlines():
        if m := re.match(r"<(\d+)f>", line):
            out[int(m.group(1))] = [tuple(map(int, x)) for x in _BOX.findall(line)]
    return out


TRACKERS = {"muse": _track_muse}  # provider kind -> segmentation adapter; add one here for another provider


def can_track() -> bool:
    model = mdl.role("segment")
    return mdl.available(model) and mdl.of(model).kind in TRACKERS


def track(video: bytes, concept: str = FIGURE) -> dict[int, list[tuple[int, int, int, int, int, int]]]:
    """The segmentation model on a video: per frame index, every box for the concept as (x1, y1, x2, y2, width, height)."""
    model = mdl.role("segment")
    return TRACKERS[mdl.of(model).kind](model, video, concept)


_reading = threading.BoundedSemaphore(mdl.setting("READER_AT_ONCE", 6))


def read_screen(image: bytes) -> str:
    """The reader model copies the text on a keyframe (slides, code, UI labels, diagram labels), top to bottom."""
    b64 = base64.b64encode(image).decode()
    model = mdl.role("reader")
    prov = mdl.of(model)
    effort = mdl.reasoning_effort(prov)
    with _reading:  # its own small lane: screen reading isn't on the notes' critical path, so it never crowds them
        r = mdl.client(prov.name).chat.completions.create(
            model=mdl.bare(model), max_tokens=1500, **({"reasoning_effort": effort} if effort else {}),
            messages=[{"role": "user", "content": [
                {"type": "text", "text": "Copy every piece of text visible in this image, top to bottom, one line per "
                                         "line of text. Return only that text, or nothing if there is none."},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}])
    return (r.choices[0].message.content or "").strip()


def draw_card(prompt: str, strength: str = "low") -> bytes:
    """One picture from the image model. `strength` is a quality hint that only the Muse adapter uses: it sets
    reasoning_strength and switches Muse's web and image search off (with them on it added features the video never
    showed and renamed the product). A strength the API rejects falls back to "low"."""
    model = mdl.role("image")
    prov = mdl.of(model)
    if prov.kind != "muse":
        resp = mdl.client(prov.name).images.generate(model=mdl.bare(model), prompt=prompt, n=1, response_format="b64_json")
        return base64.b64decode(resp.data[0].b64_json)
    for s in dict.fromkeys([strength, "low"]):
        try:
            resp = mdl.client(prov.name).images.generate(model=mdl.bare(model), prompt=prompt, n=1, extra_body={
                "reasoning_strength": s,
                "tool_enablement": {"enable_image_search": False, "enable_web_search": False, "enable_shell": False}})
            return base64.b64decode(resp.data[0].b64_json)
        except openai.BadRequestError:
            if s == "low":
                raise
            log.warning("Muse Image rejected reasoning_strength=%s; using low", s)
    raise AssertionError("unreachable")
