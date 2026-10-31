import httpx
import openai
import pytest
from PIL import Image

from vidmind import models as mdl
from vidmind import synthesize as syn
from vidmind.schema import Frame, Segment


@pytest.fixture
def twelve_frames(tmp_path):
    (tmp_path / "frames").mkdir()
    frames = []
    for i in range(12):
        Image.new("RGB", (8, 8)).save(tmp_path / "frames" / f"{i}.jpg")
        frames.append(Frame(t=i * 20 + 10, url=f"frames/{i}.jpg", ocr_text=f"slide {i}"))
    return tmp_path, frames


def images(messages):
    return [p for p in messages[1]["content"] if p["type"] == "image_url"]


def test_images_capped_but_every_frame_keeps_its_ocr(twelve_frames, monkeypatch):
    job_dir, frames = twelve_frames
    messages = syn.section_messages([Segment(0, 5, "hi")], frames, 0, 240, job_dir, vision=True)
    assert len(images(messages)) == 8  # evenly spaced, first and last frame included
    assert all(f"slide {i}" in messages[1]["content"][0]["text"] for i in range(12))
    assert images(syn.section_messages([], frames, 0, 240, job_dir, vision=False)) == []
    monkeypatch.setenv("LLM_MAX_IMAGES", "12")
    assert len(images(syn.section_messages([], frames, 0, 240, job_dir, vision=True))) == 12


def test_model_pool_and_vision_flags(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "k")
    monkeypatch.setenv("LLM_MODELS", " a/fast , b/vl ,")
    monkeypatch.setenv("LLM_VISION_MODELS", "b/vl")
    assert mdl.notes() == ["a/fast", "b/vl"]
    assert mdl.is_vision("b/vl") and not mdl.is_vision("a/fast")


def test_models_without_a_provider_key_are_skipped(monkeypatch):
    monkeypatch.setenv("LLM_MODELS", "groq:openai/gpt-oss-120b,nvidia:x/y,apple:system")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("NVIDIA_API_KEY", "k")
    assert mdl.notes() == ["nvidia:x/y", "apple:system"]  # Apple's local server needs no key
    assert mdl.provider("groq:openai/gpt-oss-120b") == "groq" and mdl.bare("groq:openai/gpt-oss-120b") == "openai/gpt-oss-120b"
    assert mdl.provider("openai/gpt-oss-20b") == ""  # bare ids keep their slash and use LLM_BASE_URL


def test_server_error_with_images_retries_text_only(twelve_frames, monkeypatch):
    job_dir, frames = twelve_frames
    messages = syn.section_messages([], frames, 0, 240, job_dir, vision=True)
    sent = []

    def fake(msgs, model, on_text=None):
        sent.append(msgs)
        if images(msgs):
            raise openai.InternalServerError("boom", response=httpx.Response(500, request=httpx.Request("POST", "x")), body=None)
        return "{}"

    monkeypatch.setattr(syn, "_complete", fake)
    assert syn.complete(messages, "m") == "{}"
    assert len(sent) == 2 and images(sent[0]) and not images(sent[1])


def test_finished_items_returns_only_whole_notes_of_a_reply_still_streaming():
    from vidmind.synthesize import finished_items

    head = '{"title": "a { b", "notes": [{"text": "x } \\" {", "evidence": [{"kind": "frame"}]}, {"text": "half'
    assert finished_items(head) == ['{"text": "x } \\" {", "evidence": [{"kind": "frame"}]}']
    assert len(finished_items(head + '"}], "key_terms": [{"no": 1}]}')) == 2  # stops at the end of "notes"
    assert finished_items('{"title": "t"') == []
