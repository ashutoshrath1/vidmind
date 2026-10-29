"""LLM calls: one per video section (run in parallel across a model pool), a whole-video overview, and Q&A."""

import base64
import json
import logging
import os
import re
import threading
from functools import lru_cache
from pathlib import Path

import openai
from openai import OpenAI
from pydantic import BaseModel

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
- Do not invent facts.

Return ONLY one JSON object with exactly this shape (values are placeholders):
{"title": "Section title", "summary": "1-2 sentence summary of the section", "key_terms": ["term", "term"],
 "notes": [{"text": "One factual note.", "uncertain": false, "uncertain_reason": null,
   "evidence": [{"kind": "transcript", "start_seconds": 12.3, "quote": "exact words from that segment"},
                {"kind": "frame", "start_seconds": 30.0, "text": "what the frame shows"}]}]}"""

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


PROVIDERS = {
    # ~10x faster than NVIDIA's free tier; free plan: 30 requests and 8K tokens a minute per model.
    "groq": ("https://api.groq.com/openai/v1", "GROQ_API_KEY"),
    "nvidia": ("https://integrate.api.nvidia.com/v1", "NVIDIA_API_KEY"),
    # Muse Spark 1.3 (vision) leads the pool; checked against the live API Oct 26.
    "muse": ("https://api.meta.ai/v1", "MODEL_API_KEY"),
    # Apple's on-device model: `fm serve --port 1976` (macOS 26+). Free and private, but on a real lecture section
    # 0 of its 4 notes survived grounding (invented timestamps, paraphrased quotes), so it is not in the default pool.
    "apple": ("http://localhost:1976/v1", None),
}
# Requests in flight per provider, so parallel sections and jobs queue here instead of tripping rate limits.
MAX_IN_FLIGHT = {"groq": 6, "nvidia": 8, "muse": 24, "apple": 1, "": 8}  # Muse: 3,000 requests a minute
_slots = {p: threading.BoundedSemaphore(n) for p, n in MAX_IN_FLIGHT.items()}


def provider(model: str) -> str:
    prefix, sep, _ = model.partition(":")
    return prefix if sep and prefix in PROVIDERS else ""


def _name(model: str) -> str:
    return model.split(":", 1)[1] if provider(model) else model


def _key(prov: str) -> str | None:
    if not prov:
        return os.environ.get("LLM_API_KEY") or os.environ.get("MODEL_API_KEY")
    var = PROVIDERS[prov][1]
    return os.environ.get(var) if var else "local"


@lru_cache  # one client per provider, so its HTTP connections are reused across sections and jobs
def _client(prov: str) -> OpenAI:
    base_url = PROVIDERS[prov][0] if prov else os.environ.get("LLM_BASE_URL", "https://api.meta.ai/v1")
    key = _key(prov)
    if not key:
        raise RuntimeError(f"No API key for {prov or base_url}. Set it in .env and restart the API.")
    # Replies are streamed, so this bounds the wait for the first token and between chunks, not the whole reply.
    # Hedging covers slow models; this only frees a hung connection's slot.
    return OpenAI(base_url=base_url, api_key=key, timeout=60, max_retries=1)


def _env_list(name: str, default: str) -> list[str]:
    return [m.strip() for m in os.environ.get(name, default).split(",") if m.strip()]


def models() -> list[str]:
    """The pool sections are spread across, in priority order; models whose provider has no key are skipped."""
    pool = [m for m in _env_list("LLM_MODELS", "muse-spark-1.2") if _key(provider(m))]
    # With a Muse key, Muse only: its own older version is the backup, never another provider's model.
    if any(provider(m) == "muse" for m in pool):
        pool = [m for m in pool if provider(m) == "muse"]
    if not pool:
        raise RuntimeError("No notes model has an API key. Set GROQ_API_KEY or NVIDIA_API_KEY in .env.")
    return pool


def is_vision(model: str) -> bool:
    return model in _env_list("LLM_VISION_MODELS", "muse-spark-1.2")


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


def complete(messages: list[dict], model: str) -> str:
    try:
        return _complete(messages, model)
    except openai.InternalServerError:
        # Hosted vision endpoints fail opaquely on image payloads; text + OCR still produces grounded notes.
        if _without_images(messages) == messages:
            raise
        log.warning("%s: server error with images; retrying text-only", model)
        return _complete(_without_images(messages), model)


def _complete(messages: list[dict], model: str) -> str:
    prov = provider(model)
    client = _client(prov)
    # A section's JSON is ~1-2K tokens; the cap stops a degenerate stream (NVIDIA's gpt-oss-20b once sent whitespace
    # for 218 s) from holding a section hostage.
    max_tokens = int(os.environ.get("LLM_MAX_TOKENS", "4096"))
    # Reasoning models think before answering; at default effort Muse Glimmer took 5+ min per video, "low" ~1.5.
    # Muse Spark at "minimal": same grounded notes as "low" on the sample, 30% faster, 20% cheaper (Oct 26 bench).
    effort = "minimal" if prov == "muse" else os.environ.get("LLM_REASONING_EFFORT", "low")
    # Servers differ in which options they accept; step down until one works. Parsing + ground() enforce the contract.
    variants = [{"response_format": {"type": "json_object"}}, {}]
    if effort:
        variants.insert(0, {"response_format": {"type": "json_object"}, "reasoning_effort": effort})
    for i, extra in enumerate(variants):
        try:
            with _slots[prov]:
                stream = client.chat.completions.create(
                    model=_name(model), messages=messages, temperature=0.2, max_tokens=max_tokens, stream=True, **extra
                )
                parts, finish = [], None
                for chunk in stream:
                    if chunk.choices:
                        parts.append(chunk.choices[0].delta.content or "")
                        finish = chunk.choices[0].finish_reason or finish
            if finish == "length":
                log.warning("%s hit max_tokens=%d; reply is likely cut off", model, max_tokens)
            return "".join(parts)
        except openai.BadRequestError:
            if i == len(variants) - 1:
                raise
    raise AssertionError("unreachable")


def _parse[T: BaseModel](text: str, cls: type[T]) -> T:
    # Tolerate code fences or chatter around the JSON object.
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError(f"Model reply contained no JSON object: {text[:200]!r}")
    return cls.model_validate(json.loads(text[start : end + 1]))


def ask[T: BaseModel](messages: list[dict], model: str, cls: type[T]) -> tuple[T, str]:
    """Returns (parsed reply, raw text). Retries once if the reply is not valid JSON for `cls`."""
    raw = complete(messages, model)
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


SAM_MODEL = "sam-3.1"
CARD_MODEL = "muse-image-1.0"


FIGURE = "diagram"  # SAM concept; on slide videos "screen" and "slide" matched nothing, "diagram" finds the figures


def track(video: bytes, concept: str = FIGURE) -> dict[int, list[tuple[int, int, int, int, int, int]]]:
    """SAM 3.1 on a video: per frame index, every box for the concept as (x1, y1, x2, y2, width, height)."""
    b64 = base64.b64encode(video).decode()
    with _slots["muse"]:
        resp = _client("muse").responses.create(model=SAM_MODEL, input=[{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": concept},
            {"type": "input_video", "video_url": f"data:video/mp4;base64,{b64}"}]}])
    out: dict[int, list] = {}
    for line in (resp.output_text or "").splitlines():
        if m := re.match(r"<(\d+)f>", line):
            out[int(m.group(1))] = [tuple(map(int, x)) for x in _BOX.findall(line)]
    return out


_BOX = re.compile(r"<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)")


READER = "muse:muse-spark-1.3"
_reading = threading.BoundedSemaphore(6)


def read_screen(image: bytes) -> str:
    """Spark reads the text on a keyframe (slides, code, UI labels, diagram labels), top to bottom."""
    b64 = base64.b64encode(image).decode()
    with _reading:  # its own small lane: screen reading isn't on the notes' critical path, so it never crowds them
        r = _client("muse").chat.completions.create(model=_name(READER), reasoning_effort="minimal", max_tokens=1500,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": "Copy every piece of text visible in this image, top to bottom, one line per "
                                         "line of text. Return only that text, or nothing if there is none."},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}])
    return (r.choices[0].message.content or "").strip()


def draw_card(prompt: str) -> bytes:
    """Muse Image: one rendered summary card ($0.01). Its web and image search are off: with them on it added
    features the video never showed ("drag-and-drop", "collaborate") and renamed the product."""
    resp = _client("muse").images.generate(model=CARD_MODEL, prompt=prompt, n=1, extra_body={
        "reasoning_strength": "low",
        "tool_enablement": {"enable_image_search": False, "enable_web_search": False, "enable_shell": False}})
    return base64.b64decode(resp.data[0].b64_json)
