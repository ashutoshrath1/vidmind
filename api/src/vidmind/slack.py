"""Post a meeting's decisions and actions to Slack through an incoming webhook the person pasted."""

import os
import re

import httpx

from .schema import Action, LearnResult

# Only Slack's own webhook host and path: the server never posts to an address a caller chose (SSRF).
WEBHOOK = re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9]+/[A-Za-z0-9]+/[A-Za-z0-9]+")
WEB_ORIGINS = os.environ.get("VIDMIND_WEB_ORIGIN", "http://localhost:3000").split(",")
_LOCAL = re.compile(r"https?://(localhost|127\.0\.0\.1)(:\d{1,5})?")


def web_origin_ok(origin: str) -> bool:
    return origin in WEB_ORIGINS or bool(_LOCAL.fullmatch(origin))


def _esc(text: str) -> str:
    # Slack mrkdwn treats these three as control characters; escaped, model text can't form links or mentions.
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def message(result: LearnResult, job_id: str, origin: str | None) -> dict:
    """The Slack message: the title, decisions, then actions with owner and deadline, each linked to its second."""
    def proof(a: Action) -> str:
        if not a.evidence:
            return ""
        t = int(min(e.start_seconds for e in a.evidence))
        at = f"{t // 60}:{t % 60:02d}"
        if result.youtube_id:
            return f" <https://www.youtube.com/watch?v={result.youtube_id}&t={t}s|said at {at}>"
        return f" <{origin}/jobs/{job_id}?view=proof&t={t}|proof at {at}>" if origin else f" (at {at})"

    lines = [f"*{_esc(result.title)}*"]
    decisions = [a for a in result.actions if a.kind == "decision"]
    actions = [a for a in result.actions if a.kind == "action"]
    if decisions:
        lines += ["", "*Decisions*", *(f"• {_esc(a.text)}{proof(a)}" for a in decisions)]
    if actions:
        lines += ["", "*Actions*", *(f"• {_esc(a.text)} — {_esc(a.owner or 'No owner named')}, "
                                     f"{_esc('due ' + a.deadline if a.deadline else 'no deadline said')}{proof(a)}"
                                     for a in actions)]
    lines += ["", "_Each item was checked against the video by VidMind._"]
    return {"text": "\n".join(lines)}  # webhooks render mrkdwn in `text`


def post(webhook: str, payload: dict) -> None:
    """Raises ValueError with Slack's own error text (e.g. "no_service", "invalid_payload") when it refuses."""
    try:
        r = httpx.post(webhook, json=payload, timeout=10)  # httpx never follows redirects unless asked
    except httpx.HTTPError as e:
        raise ValueError(f"Couldn't reach Slack: {type(e).__name__}") from None
    if r.status_code != 200:
        raise ValueError(f"Slack said: {r.text.strip()[:200] or r.status_code}")
