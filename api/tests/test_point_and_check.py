import json
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from vidmind import jobs, qa
from vidmind import synthesize as syn
from vidmind.main import app
from vidmind.schema import Answer

client = TestClient(app)
JOB = "b" * 32


@pytest.fixture
def job(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "DATA_DIR", tmp_path)
    d = tmp_path / JOB
    (d / "frames").mkdir(parents=True)
    Image.new("RGB", (640, 360), "white").save(d / "frames" / "0.jpg")
    (d / "job.json").write_text(json.dumps({"id": JOB, "status": "done"}))
    (d / "frames.json").write_text(json.dumps([{"t": 30.0, "url": "frames/0.jpg", "ocr_text": "API Gateway"}]))
    (d / "transcript.json").write_text(json.dumps([{"start": 28.0, "end": 33.0, "text": "The API gateway routes every request."}]))
    (d / "result.json").write_text(json.dumps({"duration_seconds": 60}))
    return d


def test_point_and_ask_segments_the_spot_and_checks_the_answer(job, monkeypatch):
    pointed = []
    monkeypatch.setattr(syn, "segment_at", lambda image, x, y, w, h: pointed.append((x, y, w, h)) or (100, 50, 300, 150))
    seen = []

    def fake_ask(messages, model, cls):
        seen.append(messages)
        return Answer(answer="That box is the API gateway, which routes every request.", evidence=[
            {"kind": "transcript", "start_seconds": 28.0, "quote": "the API gateway routes every request"}]), "{}"

    monkeypatch.setattr(syn, "ask", fake_ask)
    monkeypatch.setattr(syn, "models", lambda: ["m"])
    r = client.post(f"/jobs/{JOB}/point", json={"frame_url": "frames/0.jpg", "x": 0.25, "y": 0.25, "question": "What is this?"}).json()
    assert pointed == [(160, 90, 640, 360)], "fractions become the frame's pixels"
    assert r["found"] and r["box"] == [100, 50, 300, 150] and r["evidence"][0]["start_seconds"] == 28.0
    images = [p for p in seen[0][1]["content"] if p["type"] == "image_url"]
    assert len(images) == 2, "the whole frame and the enlarged crop"


def test_point_and_ask_only_accepts_the_jobs_own_frames(job):
    r = client.post(f"/jobs/{JOB}/point", json={"frame_url": "../../etc/passwd", "x": 0.5, "y": 0.5})
    assert r.status_code == 404
