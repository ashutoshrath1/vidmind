import json
import os
import shutil
import threading
from pathlib import Path

from fastapi.testclient import TestClient

from vidmind import jobs, qa
from vidmind.main import app

client = TestClient(app)
SAMPLE = Path(__file__).parents[2] / "samples"
NOTE = "Activation is the moment a user creates their first project."


def job(tmp_path, **extra):
    result = {"title": "Onboarding", "duration_seconds": 60, "transcriber": "t", "model": "m", "quiz": [],
              "chapters": [{"title": "Intro", "start_seconds": 0, "notes": [{"text": NOTE, "evidence": [
                  {"kind": "transcript", "start_seconds": 4.0, "quote": "first project"},
                  {"kind": "frame", "start_seconds": 30.0, "text": "Activation"}]}]}],
              "takeaways": [{"text": "Retention target is 40%.", "evidence": [
                  {"kind": "frame", "start_seconds": 30.0, "text": "40%"}]}], **extra}
    (tmp_path / "result.json").write_text(json.dumps(result))
    return tmp_path


def stub(monkeypatch, cards):
    calls = []

    def fake_ask(messages, model, cls):
        calls.append(messages)
        return cls.model_validate({"cards": cards}), "{}"

    monkeypatch.setattr(qa.syn, "ask", fake_ask)
    return calls


def card(**kw):
    return {"kind": "recall", "front": "What is activation?", "back": "Creating a first project.",
            "start_seconds": 4.0, "source_note": NOTE, **kw}


def test_cards_must_cite_a_real_note_and_one_of_its_seconds(tmp_path, monkeypatch):
    stub(monkeypatch, [
        card(),
        card(start_seconds=31.5, source_note=NOTE.lower().rstrip(".")),  # near-exact text, second within 2 s: snapped
        card(source_note="Activation needs a paid plan."),  # no such note
        card(start_seconds=50),  # a real note, but not one of its seconds
        card(kind="cloze", front="Activation is creating a first project."),  # cloze with no blank
        card(kind="cloze", front="The retention target is _____.", back="40%", start_seconds=30,
             source_note="Retention target is 40%."),  # from a takeaway
        {"front": "?"},  # malformed
    ])
    out = qa.deck(job(tmp_path))
    assert [(c["start_seconds"], c["source_note"]) for c in out["cards"]] == [
        (4.0, NOTE), (30.0, NOTE), (30.0, "Retention target is 40%.")]
    assert out["dropped"] == 4
    assert json.loads((tmp_path / "deck.json").read_text()) == out


def test_the_saved_deck_is_reused_and_concurrent_requests_call_the_model_once(tmp_path, monkeypatch):
    calls = stub(monkeypatch, [card()])
    d = job(tmp_path)
    threads = [threading.Thread(target=qa.deck, args=(d,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(qa.deck(d)["cards"]) == 1
    assert len(calls) == 1


def test_no_deck_until_the_notes_are_finished(tmp_path, monkeypatch):
    calls = stub(monkeypatch, [card()])
    (tmp_path / "empty").mkdir()
    (tmp_path / "pending").mkdir()
    for d in (tmp_path / "empty", job(tmp_path / "pending", pending=True)):
        try:
            qa.deck(d)
        except FileNotFoundError:
            continue
        raise AssertionError("expected FileNotFoundError")
    assert not calls


def test_sample_deck_over_http(tmp_path, monkeypatch):
    sample = tmp_path / "samples"
    sample.mkdir()
    shutil.copy(SAMPLE / "result.json", sample / "result.json")
    monkeypatch.setattr(jobs, "SAMPLE_DIR", sample)
    note = json.loads((sample / "result.json").read_text())["chapters"][0]["notes"][0]
    stub(monkeypatch, [card(source_note=note["text"], start_seconds=note["evidence"][0]["start_seconds"])])
    r = client.post("/jobs/sample/deck")
    assert r.status_code == 200 and len(r.json()["cards"]) == 1
    assert (sample / "deck.json").exists()
    assert client.post("/jobs/../deck").status_code == 404
    assert client.post("/jobs/" + "0" * 32 + "/deck").status_code == 404


def test_a_failed_deck_is_not_retried_on_every_open(tmp_path, monkeypatch):
    calls = []

    def bad_ask(messages, model, cls):
        calls.append(messages)
        raise ValueError("not JSON")

    monkeypatch.setattr(qa.syn, "ask", bad_ask)
    d = job(tmp_path)
    for _ in range(3):
        try:
            qa.deck(d)
        except (ValueError, RuntimeError):
            pass
    assert len(calls) == 1  # later opens inside the cooldown don't call the model
    old = (tmp_path / "deck.err").stat().st_mtime - qa.DECK_COOLDOWN_S - 1
    os.utime(tmp_path / "deck.err", (old, old))
    stub(monkeypatch, [card()])
    assert len(qa.deck(d)["cards"]) == 1
