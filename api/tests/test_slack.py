import json

import httpx
import pytest
from fastapi.testclient import TestClient

from vidmind import jobs, slack
from vidmind.main import app

client = TestClient(app)  # no `with`: lifespan (workers, MCP sessions) stays off
JOB = "b" * 32
HOOK = "https://hooks.slack.com/services/T000/B000/abc123"


@pytest.fixture(autouse=True)
def meeting(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "DATA_DIR", tmp_path)
    (tmp_path / JOB).mkdir()
    (tmp_path / JOB / "result.json").write_text(json.dumps({
        "title": "Launch <sync>", "duration_seconds": 300, "transcriber": "t", "model": "m", "quiz": [], "chapters": [],
        "mode": "meet", "actions": [
            {"kind": "decision", "text": "Pro plan costs $12", "evidence": [
                {"kind": "frame", "start_seconds": 30.0, "text": "Pro $12"}]},
            {"kind": "action", "text": "Send the legal review", "owner": "Priya", "deadline": "Friday", "evidence": [
                {"kind": "transcript", "start_seconds": 75.4, "quote": "legal by Friday"}]},
            {"kind": "action", "text": "Invite 50 beta users", "evidence": [
                {"kind": "transcript", "start_seconds": 90.0, "quote": "fifty beta users"}]}]}))


@pytest.fixture
def sent(monkeypatch):
    calls = []

    def fake_post(url, json, timeout):
        calls.append((url, json, timeout))
        return httpx.Response(200, text="ok")

    monkeypatch.setattr(slack.httpx, "post", fake_post)
    return calls


@pytest.mark.parametrize("webhook", [
    "https://evil.example/services/T/B/x",
    "https://hooks.slack.com.evil.example/services/T/B/x",
    "http://hooks.slack.com/services/T/B/x",
    "https://hooks.slack.com/services/T/B/x/../../../api",
    "https://hooks.slack.com/triggers/T/B/x",
    "http://169.254.169.254/latest/meta-data",
])
def test_rejects_anything_but_a_slack_webhook(webhook, sent):
    r = client.post(f"/jobs/{JOB}/actions/slack", json={"webhook": webhook})
    assert r.status_code == 400 and not sent


@pytest.mark.parametrize("origin", ["https://evil.example", "javascript:alert(1)", "http://localhost.evil.example"])
def test_rejects_unknown_web_origins(origin, sent):
    r = client.post(f"/jobs/{JOB}/actions/slack", json={"webhook": HOOK, "origin": origin})
    assert r.status_code == 400 and not sent


def test_posts_owner_deadline_and_proof_link(sent):
    r = client.post(f"/jobs/{JOB}/actions/slack", json={"webhook": HOOK, "origin": "http://localhost:3000"})
    assert r.status_code == 200 and r.json() == {"posted": 3}
    url, payload, timeout = sent[0]
    assert url == HOOK and timeout == 10
    text = payload["text"]
    assert text.startswith("*Launch &lt;sync&gt;*")  # escaped: model text can't form Slack links or mentions
    assert f"• Pro plan costs $12 <http://localhost:3000/jobs/{JOB}?view=proof&t=30|proof at 0:30>" in text
    assert "• Send the legal review — Priya, due Friday <" in text and "?view=proof&t=75|proof at 1:15>" in text
    assert "• Invite 50 beta users — No owner named, no deadline said <" in text


def test_youtube_videos_link_to_the_second(sent, tmp_path):
    path = tmp_path / JOB / "result.json"
    path.write_text(json.dumps({**json.loads(path.read_text()), "youtube_id": "abc_DEF-123"}))
    assert client.post(f"/jobs/{JOB}/actions/slack", json={"webhook": HOOK}).status_code == 200
    assert "<https://www.youtube.com/watch?v=abc_DEF-123&t=75s|said at 1:15>" in sent[0][1]["text"]


def test_slack_errors_are_passed_through(monkeypatch):
    monkeypatch.setattr(slack.httpx, "post", lambda *a, **k: httpx.Response(404, text="no_service"))
    r = client.post(f"/jobs/{JOB}/actions/slack", json={"webhook": HOOK})
    assert r.status_code == 502 and r.json()["detail"] == "Slack said: no_service"

    def down(*a, **k):
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(slack.httpx, "post", down)
    assert client.post(f"/jobs/{JOB}/actions/slack", json={"webhook": HOOK}).json()["detail"] == \
        "Couldn't reach Slack: ConnectTimeout"


def test_videos_without_actions_have_nothing_to_post(sent):
    r = client.post("/jobs/sample/actions/slack", json={"webhook": HOOK})
    assert r.status_code == 409 and not sent
    assert client.post("/jobs/../actions/slack", json={"webhook": HOOK}).status_code == 404
