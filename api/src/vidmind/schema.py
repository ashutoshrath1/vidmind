"""Output contract and the grounding checks that keep every note tied to real evidence."""

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Annotated, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

QUOTE_WINDOW_S = 5.0  # transcript quote must appear within this many seconds of its timestamp
FRAME_WINDOW_S = 2.0  # frame evidence must land this close to a sampled frame
QUOTE_MIN_RATIO = 0.6


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Frame:
    t: float
    url: str  # relative to the job, e.g. "frames/0.jpg"
    ocr_text: str = ""
    ocr_conf: float = 0.0
    low_conf: bool = False
    figure_url: str | None = None  # the diagram SAM found in this frame, cropped and enlarged
    figure_box: tuple[int, int, int, int] | None = None  # where, in the frame's pixels: x1, y1, x2, y2


class TranscriptEvidence(BaseModel):
    kind: Literal["transcript"]
    start_seconds: float
    quote: str


class FrameEvidence(BaseModel):
    kind: Literal["frame"]
    start_seconds: float
    text: str
    frame_url: str | None = None  # set by the server, never by the model


Evidence = Annotated[TranscriptEvidence | FrameEvidence, Field(discriminator="kind")]


class Note(BaseModel):
    text: str
    evidence: list[Evidence]
    uncertain: bool = False
    uncertain_reason: str | None = None


class Chapter(BaseModel):
    title: str
    start_seconds: float
    notes: list[Note]
    summary: str = ""
    key_terms: list[str] = []
    cover_url: str | None = None  # set by the server: the section's most text-rich keyframe


class QuizItem(BaseModel):
    question: str
    answer: str
    evidence_start_seconds: float


class Card(BaseModel):
    """A study flashcard written from one checked note or takeaway; kept only if that note and second are real."""

    front: str = Field(min_length=3, max_length=300)
    back: str = Field(min_length=1, max_length=500)
    kind: Literal["recall", "cloze"] = "recall"
    start_seconds: float
    source_note: str


class SectionOutput(BaseModel):
    """What the model returns for one time-slice of the video."""

    title: str
    summary: str = ""
    key_terms: list[str] = []
    notes: list[Note]
    quiz: list[QuizItem] = []

    @field_validator("notes", "quiz", mode="wrap")
    @classmethod
    def _drop_malformed_items(cls, value, handler):
        # One malformed note shouldn't cost a whole retry round; keep the items that parse.
        if not isinstance(value, list):
            return handler(value)
        kept = []
        for item in value:
            try:
                kept += handler([item])
            except ValidationError:
                pass
        return kept


class Overview(BaseModel):
    """What the model returns for the whole video (title + short summary)."""

    title: str
    tldr: str
    # Picks the extra output: meet → decisions and actions, test → test scenarios; learn → notes only.
    mode: Literal["learn", "meet", "test"] = "learn"


class Action(Note):
    """A meeting decision or action item; checked against the video exactly like a note."""

    kind: Literal["decision", "action"] = "action"
    owner: str | None = None
    deadline: str | None = None


class Scenario(BaseModel):
    """An end-to-end test for a flow shown in a product demo: checked steps plus a Playwright test."""

    title: str
    steps: list[Note]
    playwright: str = ""


class DiagramNode(Note):
    """A box in the diagram; `text` is its label, checked against the video like a note."""

    id: str


class DiagramEdge(BaseModel):
    source: str
    target: str
    label: str = ""


class Diagram(BaseModel):
    """Architecture, flow or API sequence the video explains. Rendered by the page, so labels are exactly these."""

    kind: Literal["architecture", "flowchart", "sequence"]
    title: str
    nodes: list[DiagramNode]
    edges: list[DiagramEdge]  # in order; for a sequence, the order of the calls


class VisualOutput(BaseModel):
    takeaways: list[Note] = []
    questions: list[str] = []  # suggestions for Ask the video; answers are checked when asked
    diagram: Diagram | None = None


class Rejected(BaseModel):
    """A note the model wrote that failed the evidence check; kept so the UI can show what was caught."""

    text: str
    reasons: list[str]


class Answer(BaseModel):
    """What the model returns for an "Ask the video" question."""

    answer: str
    found: bool = True
    evidence: list[Evidence] = []
    # Set by the server, for the page: which model answered, how long it took, and citations sent back for repair.
    model: str | None = None
    seconds: float | None = None
    rechecked: int = 0
    # Not in the video: a web answer, labelled as such, with the pages it came from ({url, title}).
    web: bool = False
    sources: list[dict] = []
    box: list[int] | None = None  # point and ask: what the viewer pointed at, in the frame's pixels


class LearnOutput(BaseModel):
    title: str
    chapters: list[Chapter]
    quiz: list[QuizItem]


class LearnResult(LearnOutput):
    """What the API serves: model output plus provenance."""

    source: Literal["live", "precomputed"] = "live"
    tldr: str = ""
    duration_seconds: float
    transcriber: str
    model: str
    dropped_notes: int = 0
    youtube_id: str | None = None  # set when the video streams from YouTube; the UI embeds YouTube's player
    # Evidence-check audit, shown in the UI: notes checked, bad citations sent back for repair, notes removed.
    notes_checked: int = 0
    citations_rechecked: int = 0
    rejected: list[Rejected] = []
    mode: Literal["learn", "meet", "test"] = "learn"
    actions: list[Action] = []  # meet mode
    scenarios: list[Scenario] = []  # test mode
    card_url: str | None = None  # summary card from the image model, its text checked against the result
    takeaways: list[Note] = []  # the 3-5 points worth keeping, checked; also the social posts' content
    diagram: Diagram | None = None
    questions: list[str] = []  # the model's suggestions for Ask the video
    further: list[dict] = []  # web sources to go deeper ({url, title, why}): from a web search, not the video
    pending: bool = False  # notes are done; title, takeaways and diagram are still being written
    claims: list[dict] = []  # the takeaways checked against the web: {claim, verdict, why, sources}


def _words(s: str) -> list[str]:
    return re.sub(r"[^\w%$.]+", " ", s.lower()).split()


SNAP_MIN_RATIO = 0.45  # a heard quote this close to the transcript's words is replaced by them


def snap_quote(quote: str, at: float, segments: list[Segment]) -> tuple[str, float] | None:
    """The transcript's exact words closest to a quote Spark heard (within QUOTE_WINDOW_S of `at`), with the start
    of their segment; None if nothing is close. The note then quotes what the transcript says, not a paraphrase."""
    q = _words(quote)
    best: tuple[float, str, float] | None = None
    for seg in segments:
        if not seg.start - QUOTE_WINDOW_S <= at <= seg.end + QUOTE_WINDOW_S:
            continue
        words = seg.text.split()
        n = min(len(q), len(words))
        for i in range(max(1, len(words) - n + 1)):
            window = words[i : i + n]
            ratio = SequenceMatcher(None, q, _words(" ".join(window))).ratio()
            if not best or ratio > best[0]:
                best = (ratio, " ".join(window), seg.start)
    return (best[1].strip(" ,.;:"), best[2]) if best and best[0] >= SNAP_MIN_RATIO else None


def _quote_found(quote: str, haystack: str) -> bool:
    q, h = _words(quote), _words(haystack)
    if not q or not h:
        return False
    n = len(q)
    windows = (h[i : i + n] for i in range(max(1, len(h) - n + 1)))
    return max(SequenceMatcher(None, q, w).ratio() for w in windows) >= QUOTE_MIN_RATIO


def ground(
    out: LearnOutput, segments: list[Segment], frames: list[Frame], duration: float
) -> tuple[LearnOutput, list[str], list[Rejected]]:
    """Drop unsupported evidence and notes. Returns (cleaned output, problems, dropped notes with reasons)."""
    problems: list[str] = []
    dropped: list[Rejected] = []
    in_range = lambda t: 0 <= t <= duration + 0.5  # noqa: E731

    def check(ev, where: str):
        if not in_range(ev.start_seconds):
            problems.append(f"{where}: timestamp {ev.start_seconds}s is outside the video (0–{duration:.0f}s)")
            return None
        if ev.kind == "transcript":
            nearby = " ".join(
                s.text
                for s in segments
                if s.start - QUOTE_WINDOW_S <= ev.start_seconds <= s.end + QUOTE_WINDOW_S
            )
            if not _quote_found(ev.quote, nearby):
                problems.append(f"{where}: quote {ev.quote!r} is not in the transcript near {ev.start_seconds}s")
                return None
            return ev, None
        frame = min(frames, key=lambda f: abs(f.t - ev.start_seconds), default=None)
        if frame is None or abs(frame.t - ev.start_seconds) > FRAME_WINDOW_S:
            times = ", ".join(f"{f.t:g}" for f in frames) or "none"
            problems.append(f"{where}: no sampled frame at {ev.start_seconds}s (frames at: {times})")
            return None
        return ev.model_copy(update={"start_seconds": frame.t, "frame_url": frame.url}), frame

    chapters = []
    for ci, ch in enumerate(out.chapters):
        notes = []
        for ni, note in enumerate(ch.notes):
            where = f"chapter {ci + 1} note {ni + 1}"
            kept, low_conf, before = [], False, len(problems)
            for ev in note.evidence:
                if (res := check(ev, where)) is None:
                    continue
                ev, frame = res
                if ev.kind == "frame" and any(k.kind == "frame" and k.start_seconds == ev.start_seconds for k in kept):
                    continue  # the model sometimes cites one frame twice; once is enough
                kept.append(ev)
                low_conf |= bool(frame and frame.low_conf)
            if not kept:
                if not note.evidence:
                    problems.append(f"{where}: note {note.text!r} has no evidence")
                dropped.append(Rejected(text=note.text, reasons=[p.split(": ", 1)[1] for p in problems[before:]]))
                continue
            note = note.model_copy(update={"evidence": kept})
            only_frames = all(e.kind == "frame" for e in kept)
            if only_frames and low_conf and not note.uncertain:
                note.uncertain, note.uncertain_reason = True, "On-screen text was hard to read"
            notes.append(note)
        if not notes:
            continue
        start = ch.start_seconds if in_range(ch.start_seconds) else notes[0].evidence[0].start_seconds
        chapters.append(ch.model_copy(update={"notes": notes, "start_seconds": start}))

    quiz = []
    for qi, q in enumerate(out.quiz):
        if in_range(q.evidence_start_seconds):
            quiz.append(q)
        else:
            problems.append(f"quiz {qi + 1}: timestamp {q.evidence_start_seconds}s is outside the video")

    chapters.sort(key=lambda c: c.start_seconds)
    return LearnOutput(title=out.title, chapters=chapters, quiz=quiz), problems, dropped


def ground_notes[N: Note](
    notes: list[N], segments: list[Segment], frames: list[Frame], duration: float
) -> tuple[list[N], list[str], list[Rejected]]:
    """The evidence check for any list of note-like items (actions, test steps): same rules as chapter notes."""
    wrapped = LearnOutput(title="", chapters=[Chapter(title="", start_seconds=0, notes=notes)], quiz=[])
    out, problems, dropped = ground(wrapped, segments, frames, duration)
    return (out.chapters[0].notes if out.chapters else []), problems, dropped


DECK_MATCH_RATIO = 0.9  # a card's source_note must be (almost) word for word one of the checked notes
DECK_MAX_CARDS = 15


def check_deck(cards: list[dict], notes: list[Note]) -> tuple[list[Card], int]:
    """Keep a card only if its source_note is one of `notes` and its second is one of that note's evidence seconds
    (within FRAME_WINDOW_S). Kept cards carry the note's exact text and second. Returns (kept, number dropped)."""
    kept: list[Card] = []
    for raw in cards:
        try:
            card = Card.model_validate(raw)
        except ValidationError:
            continue
        ratio, note = max(((SequenceMatcher(None, _words(card.source_note), _words(n.text)).ratio(), n) for n in notes),
                          key=lambda x: x[0], default=(0.0, None))
        if note is None or ratio < DECK_MATCH_RATIO or not note.evidence:
            continue
        at = min((e.start_seconds for e in note.evidence), key=lambda t: abs(t - card.start_seconds))
        if abs(at - card.start_seconds) > FRAME_WINDOW_S or (card.kind == "cloze" and "___" not in card.front):
            continue
        if len(kept) < DECK_MAX_CARDS:
            kept.append(card.model_copy(update={"source_note": note.text, "start_seconds": at}))
    return kept, len(cards) - len(kept)
