import json

import pytest
from fastapi.testclient import TestClient

from vidmind import jobs, mcp_server
from vidmind.schema import Answer

JOB = "a" * 32
HEADERS = {"Accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18"}


@pytest.fixture(scope="module")
def client():
    # The MCP app on its own: its lifespan runs the SDK's session manager (once per process), and the main app's
    # lifespan (job workers) stays off. Host localhost passes the SDK's DNS-rebinding check.
    with TestClient(mcp_server.app, base_url="http://localhost:8000") as c:
        yield c


@pytest.fixture(autouse=True)
def meeting(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "DATA_DIR", tmp_path)
    (tmp_path / JOB).mkdir()
    (tmp_path / JOB / "result.json").write_text(json.dumps({
        "title": "Launch sync", "duration_seconds": 60, "transcriber": "t", "model": "m", "quiz": [], "chapters": [],
        "mode": "meet", "actions": [{"kind": "action", "text": "Send the legal review", "owner": "Priya",
                                     "deadline": "Friday", "evidence": [
                                         {"kind": "transcript", "start_seconds": 12.0, "quote": "legal by Friday"}]}]}))


def rpc(client, method, params=None, id=1):
    r = client.post("/mcp", headers=HEADERS, json={"jsonrpc": "2.0", "id": id, "method": method, "params": params or {}})
    assert r.status_code == 200, r.text
    return r.json()["result"]


def call(client, name, **arguments):
    out = rpc(client, "tools/call", {"name": name, "arguments": arguments})
    return out, json.loads(out["content"][0]["text"]) if not out.get("isError") else out["content"][0]["text"]


def test_initialize_and_list_read_only_tools(client):
    init = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                      "clientInfo": {"name": "test", "version": "1"}})
    assert init["serverInfo"]["name"] == "VidMind"
    tools = {t["name"]: t for t in rpc(client, "tools/list")["tools"]}
    assert set(tools) == {"get_notes", "get_actions", "ask_video"}
    assert all(t["annotations"]["readOnlyHint"] for t in tools.values())


def test_get_notes_on_the_sample_keeps_evidence_seconds(client):
    _, notes = call(client, "get_notes", job_id="sample")
    sample = json.loads((jobs.SAMPLE_DIR / "result.json").read_text())
    assert notes["title"] == sample["title"]
    first = notes["chapters"][0]["notes"][0]
    assert first["evidence"] and "start_seconds" in first["evidence"][0]


def test_get_actions_has_owner_deadline_and_proof(client):
    _, out = call(client, "get_actions", job_id=JOB)
    assert out["items"] == [{"kind": "action", "text": "Send the legal review", "owner": "Priya", "deadline": "Friday",
                             "evidence": [{"kind": "transcript", "start_seconds": 12.0, "quote": "legal by Friday"}]}]


def test_ask_video_reuses_the_checked_answer(client, monkeypatch):
    asked = []

    def fake_answer(job_dir, question):
        asked.append((job_dir.name, question))
        return Answer(answer="Priya sends it Friday.", found=True,
                      evidence=[{"kind": "transcript", "start_seconds": 12.0, "quote": "legal by Friday"}])

    monkeypatch.setattr(mcp_server.qa, "answer", fake_answer)
    _, out = call(client, "ask_video", job_id=JOB, question="  Who sends the legal review? ")
    assert asked == [(JOB, "Who sends the legal review?")]
    assert out["evidence"][0]["start_seconds"] == 12.0 and "box" not in out


@pytest.mark.parametrize("job_id", ["../samples", "0" * 32, "nope"])
def test_unknown_or_malformed_ids_are_tool_errors(client, job_id):
    out, message = call(client, "get_actions", job_id=job_id)
    assert out["isError"] and "No job with that id" in message
