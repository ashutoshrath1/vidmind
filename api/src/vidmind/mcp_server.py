"""Read-only MCP server (Streamable HTTP at /mcp), so Claude or ChatGPT can read checked notes and ask a video."""

from pathlib import Path

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from . import jobs, qa
from .schema import LearnResult

server = MCPServer("VidMind", instructions=(
    "Notes from a video, every point checked against the second it came from. job_id is the id in a VidMind link "
    "(/jobs/<job_id>), or \"sample\". Cite the seconds when you repeat a point."))
# Stateless with plain JSON replies: each call stands alone, so there is no session to keep between requests.
app = server.streamable_http_app(stateless_http=True, json_response=True)
READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


def _job(job_id: str) -> tuple[Path, LearnResult]:
    try:
        d = jobs.job_dir(job_id)  # validates the id: no path traversal
    except KeyError:
        raise ToolError("No job with that id (they are deleted after 24 hours unless kept)") from None
    if not (d / "result.json").exists():
        raise ToolError("That video hasn't finished processing yet")
    return d, LearnResult.model_validate_json((d / "result.json").read_text())


def _evidence(note) -> list[dict]:
    return [e.model_dump(exclude={"frame_url"}) for e in note.evidence]


@server.tool(annotations=READ_ONLY)
def get_notes(job_id: str) -> dict:
    """The video's title, summary, takeaways and notes by chapter. Each point carries its evidence: a transcript
    quote or on-screen text, with start_seconds."""
    _, r = _job(job_id)
    point = lambda n: {"text": n.text, "uncertain": n.uncertain, "evidence": _evidence(n)}  # noqa: E731
    return {"title": r.title, "tldr": r.tldr, "duration_seconds": r.duration_seconds, "youtube_id": r.youtube_id,
            "takeaways": [point(n) for n in r.takeaways],
            "chapters": [{"title": c.title, "start_seconds": c.start_seconds, "notes": [point(n) for n in c.notes]}
                         for c in r.chapters]}


@server.tool(annotations=READ_ONLY)
def get_actions(job_id: str) -> dict:
    """A meeting's decisions and action items, with owner and deadline when they were said (null otherwise), and
    the evidence for each. Empty for videos that aren't meetings."""
    _, r = _job(job_id)
    return {"title": r.title, "items": [{"kind": a.kind, "text": a.text, "owner": a.owner, "deadline": a.deadline,
                                         "evidence": _evidence(a)} for a in r.actions]}


@server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True))
def ask_video(job_id: str, question: str) -> dict:
    """Ask the video a question. The answer cites transcript or keyframe evidence with seconds, checked like a
    note. When the video doesn't answer it, web is true and the answer comes from a web search, with sources."""
    question = question.strip()
    if not 2 <= len(question) <= 500:
        raise ToolError("Ask a question of 2 to 500 characters")
    d, _ = _job(job_id)
    try:
        return qa.answer(d, question).model_dump(exclude={"box"}, exclude_none=True)
    except FileNotFoundError:
        raise ToolError("That video hasn't finished processing yet") from None
    except RuntimeError as e:  # the models failed; the message says so plainly
        raise ToolError(str(e)) from None
