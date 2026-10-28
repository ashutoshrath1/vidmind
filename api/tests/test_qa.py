import json

from vidmind import qa
from vidmind.schema import Answer


def job(tmp_path):
    (tmp_path / "transcript.json").write_text(json.dumps([
        {"start": 3.9, "end": 8.2, "text": "We define activation as the moment a user creates their first project."}]))
    (tmp_path / "frames.json").write_text(json.dumps([
        {"t": 30.0, "url": "frames/1.jpg", "ocr_text": "Week-1 retention target: 40%", "ocr_conf": 96, "low_conf": False}]))
    (tmp_path / "result.json").write_text(json.dumps({"duration_seconds": 60}))
    return tmp_path


def stub(monkeypatch, *replies):
    calls = []

    def fake_ask(messages, model, cls):
        calls.append(messages)
        return Answer.model_validate(replies[min(len(calls), len(replies)) - 1]), "{}"

    monkeypatch.setattr(qa.syn, "ask", fake_ask)
    return calls


def test_grounded_answer_keeps_its_evidence_and_gets_the_frame_url(tmp_path, monkeypatch):
    stub(monkeypatch, {"answer": "The target is 40%.", "evidence": [{"kind": "frame", "start_seconds": 30, "text": "40%"}]})
    out = qa.answer(job(tmp_path), "What is the retention target?")
    assert out.found and out.evidence[0].frame_url == "frames/1.jpg"


def test_unverifiable_answer_is_hidden_after_one_repair(tmp_path, monkeypatch):
    made_up = {"answer": "Activation needs a paid plan.",
               "evidence": [{"kind": "transcript", "start_seconds": 4, "quote": "activation requires a paid plan"}]}
    calls = stub(monkeypatch, made_up)
    out = qa.answer(job(tmp_path), "What is activation?")
    assert not out.found and out.answer == qa.NOT_FOUND and out.evidence == []
    assert len(calls) == 2  # the failed citation went back to the model once


def test_unfinished_job_raises(tmp_path):
    try:
        qa.answer(tmp_path, "anything?")
    except FileNotFoundError:
        return
    raise AssertionError("expected FileNotFoundError")


def test_a_question_the_video_doesnt_answer_gets_a_labelled_web_answer(tmp_path, monkeypatch):
    stub(monkeypatch, {"answer": "Not covered.", "found": False})
    monkeypatch.setattr(qa.syn, "general_answer", lambda q, title: ("Kafka was created at LinkedIn.",
                                                                     [{"url": "https://kafka.apache.org", "title": "Kafka"}]))
    out = qa.answer(job(tmp_path), "Who made Kafka?")
    assert not out.found and out.web and out.evidence == []  # never presented as coming from the video
    assert out.answer == "Kafka was created at LinkedIn." and out.sources[0]["url"] == "https://kafka.apache.org"
