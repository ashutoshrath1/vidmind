import json

import pytest
from fastapi.testclient import TestClient

from vidmind import jobs, qa
from vidmind.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "DATA_DIR", tmp_path / "jobs")


def make_job(job_id: str, title: str, said: str, shown: str = "") -> str:
    d = jobs.DATA_DIR / job_id
    d.mkdir(parents=True)
    (d / "job.json").write_text(json.dumps({"id": job_id, "status": "done", "created_at": 0}))
    (d / "transcript.json").write_text(json.dumps([{"start": 1.0, "end": 4.0, "text": "Welcome back everyone."},
                                                   {"start": 12.0, "end": 16.0, "text": said}]))
    (d / "frames.json").write_text(json.dumps([{"t": 30.0, "url": "frames/0.jpg", "ocr_text": shown}]))
    (d / "result.json").write_text(json.dumps({
        "title": title, "duration_seconds": 60, "transcriber": "t", "model": "m", "quiz": [], "chapters": [],
        "takeaways": [{"text": f"{title} in one line.", "evidence": [{"kind": "transcript", "start_seconds": 12.0, "quote": said}]}]}))
    return job_id


A, B = "a" * 32, "b" * 32


def stub(monkeypatch, reply):
    calls = []

    def fake_ask(messages, model, cls):
        calls.append(messages)
        return cls.model_validate(reply), "{}"

    monkeypatch.setattr(qa.syn, "ask", fake_ask)
    return calls


def test_top_snippets_rank_by_shared_words_and_ignore_filler():
    items = [(1.0, "Welcome to the video"), (12.0, "Kafka keeps messages after consumers read them"),
             (30.0, "Retention: 7 days"), (40.0, "Kafka partitions")]
    got = qa.top_snippets(items, "Why does Kafka keep messages?", k=2)
    assert got == [(12.0, "Kafka keeps messages after consumers read them"), (40.0, "Kafka partitions")]
    assert qa.top_snippets(items, "What is this video about?") == []  # only filler words


def test_citations_must_be_given_snippets_and_carry_their_video_and_second(monkeypatch):
    make_job(A, "Kafka basics", "Kafka keeps every message for seven days.")
    make_job(B, "Pulsar intro", "Pulsar keeps messages in BookKeeper.", shown="Message retention")
    calls = stub(monkeypatch, {"answer": "Kafka keeps them seven days; Pulsar stores them in BookKeeper.",
                               "citations": [1, 2, 2, 99, 0, -1]})
    r = client.post("/ask-across", json={"job_ids": [A, B], "question": "How long are messages kept?"})
    assert r.status_code == 200
    body = r.json()
    assert len(calls) == 1  # one model call for every video
    assert [(c["job_id"], c["title"], c["start_seconds"]) for c in body["citations"]] == [
        (A, "Kafka basics", 12.0), (B, "Pulsar intro", 12.0)]  # 99, 0, -1 and the repeat dropped
    assert body["citations"][0]["quote"] == "Kafka keeps every message for seven days."


def test_no_valid_citation_or_not_found_says_so_plainly(monkeypatch):
    make_job(A, "Kafka basics", "Kafka keeps every message for seven days.")
    for reply in ({"answer": "Made up.", "citations": [7]}, {"answer": "Not covered.", "found": False, "citations": [1]}):
        stub(monkeypatch, reply)
        body = client.post("/ask-across", json={"job_ids": [A], "question": "How are messages kept?"}).json()
        assert body == {"answer": qa.NOT_ACROSS, "citations": []}


def test_a_question_no_word_matches_falls_back_to_takeaways(monkeypatch):
    make_job(A, "Kafka basics", "Kafka keeps every message for seven days.")
    calls = stub(monkeypatch, {"answer": "It covers Kafka.", "citations": [1]})
    body = client.post("/ask-across", json={"job_ids": [A], "question": "What do these have in common?"}).json()
    assert body["citations"][0]["quote"] == "Kafka basics in one line."
    assert "Kafka basics in one line." in calls[0][1]["content"]


def test_unfinished_jobs_are_skipped_without_a_model_call(monkeypatch):
    (jobs.DATA_DIR / A).mkdir(parents=True)
    calls = stub(monkeypatch, {"answer": "x", "citations": [1]})
    body = client.post("/ask-across", json={"job_ids": [A], "question": "Anything here?"}).json()
    assert body == {"answer": qa.NOT_ACROSS, "citations": []} and calls == []


@pytest.mark.parametrize("body,status", [
    ({"job_ids": [], "question": "Why?"}, 422),
    ({"job_ids": [A] * 11, "question": "Why?"}, 422),
    ({"job_ids": ["sample"], "question": "x" * 501}, 422),
    ({"job_ids": ["../../etc"], "question": "Why?"}, 404),
    ({"job_ids": ["c" * 32], "question": "Why?"}, 404),  # well-formed but no such job
    ({"job_ids": ["x" * 33], "question": "Why?"}, 422),
])
def test_job_ids_and_question_are_validated_before_any_model_call(monkeypatch, body, status):
    calls = stub(monkeypatch, {"answer": "x", "citations": [1]})
    assert client.post("/ask-across", json=body).status_code == status
    assert calls == []


def test_works_for_the_sample(monkeypatch):
    stub(monkeypatch, {"answer": "Through the API Gateway.", "citations": [1]})
    body = client.post("/ask-across", json={"job_ids": ["sample"], "question": "What does the API Gateway route?"}).json()
    assert body["citations"][0]["job_id"] == "sample" and body["answer"] == "Through the API Gateway."
