import json
import re
import shutil
import subprocess

import numpy as np

from vidmind import pipeline
from vidmind.schema import Overview, SectionOutput, Segment, VisualOutput


def fake_ask_factory(calls):
    """Stub for synthesize.ask: cites the section's first transcript line and keyframe, like a good model would."""

    def fake_ask(messages, model, cls):
        if cls is Overview:
            return Overview(title="Product analytics 101", tldr="Activation, retention and the north star."), "raw"
        if cls is VisualOutput:
            return VisualOutput(), "{}"  # whole-video takeaways: covered by their own test
        prompt = messages[1]["content"][0]["text"]
        lo = float(re.search(r"Section (\d+)s", prompt).group(1))
        calls.append((lo, model, len(messages)))
        if model == "model-b" and len(messages) == 2:
            raise RuntimeError("model-b is down")  # first attempt on b fails → falls back to the next model
        first_line = re.search(r"\[([\d.]+)-[\d.]+\] (.+)", prompt)
        frame = re.search(r"\[frame ([\d.]+)s\]", prompt)  # a section on one unchanged slide has no keyframe
        frame_t = float(frame.group(1)) if frame else None
        quote = " ".join(first_line.group(2).split()[:6])
        if lo == 0 and len(messages) == 2:
            quote = "activation requires a paid plan"  # fabricated → triggers exactly one repair round
        out = {
            "title": f"Section at {lo:.0f}s", "summary": "What this part covers.", "key_terms": ["metric"],
            "notes": [{"text": "A grounded note.", "evidence": [
                {"kind": "transcript", "start_seconds": float(first_line.group(1)), "quote": quote},
                *([{"kind": "frame", "start_seconds": frame_t, "text": "slide"}] if frame else [])]}],
            "quiz": [{"question": "Q?", "answer": "A.", "evidence_start_seconds": frame_t or lo}],
        }
        return SectionOutput.model_validate(out), json.dumps(out)

    return fake_ask


def test_sections_run_in_parallel_with_fallback_repair_and_progress(fixture_clip, tmp_path, monkeypatch):
    video, _ = fixture_clip
    shutil.copy(video, tmp_path / "video.mp4")
    monkeypatch.setattr(pipeline, "SECTION_S", 20.0)  # the 60 s fixture → 3 sections, one slide each
    monkeypatch.setattr(pipeline, "FIRST_S", 20.0)
    monkeypatch.setenv("LLM_MODELS", "model-a,model-b,model-c")
    calls = []
    monkeypatch.setattr(pipeline.syn, "ask", fake_ask_factory(calls))
    updates, events = [], []
    result = pipeline.run(tmp_path, lambda step=None, **kw: updates.append((step, kw)), None,
                          lambda kind, **data: events.append((kind, data)))

    starts = [c.start_seconds for c in result.chapters]
    assert len(starts) == 3 and starts[0] == 0 and starts == sorted(starts)
    assert result.title == "Product analytics 101" and result.tldr
    assert result.dropped_notes == 0 and result.rejected == []
    assert result.notes_checked == 3 and result.citations_rechecked == 1  # the fabricated quote, fixed on repair
    assert "model-b" not in result.model  # b always fails; its sections were won by a racing or fallback model
    assert sum(1 for lo, m, _ in calls if lo == 0 and m == "model-a") == 2, "fabricated quote → one repair call"
    assert [e.frame_url for c in result.chapters for e in c.notes[0].evidence if e.kind == "frame"] == \
        ["frames/0.jpg", "frames/1.jpg", "frames/2.jpg"]
    assert all(c.cover_url and c.summary and c.key_terms for c in result.chapters)
    assert ("transcribing", {"sections_done": 0, "sections_total": 3}) in updates
    assert [kw["sections_done"] for step, kw in updates if step is None] == [1, 2, 3]
    assert (tmp_path / "result.json").exists() and (tmp_path / "transcript.json").exists()
    assert len(json.loads((tmp_path / "frames.json").read_text())) == 3  # kept for "Ask the video"
    assert not list(tmp_path.glob("*.wav"))

    # The live "behind the scenes" trace: every step the page shows.
    kinds = [k for k, _ in events]
    for kind in ("source", "plan", "transcript", "frame", "model", "check", "section", "overview"):
        assert kind in kinds, kind
    assert [d["text"] for k, d in events if k == "frame"][1].count("40%") == 1  # extracted screen text is shown
    assert [d["at"] for k, d in events if k == "frame"] == [1, 21, 41]  # video time, not event time
    s0 = [(d["model"], d["state"]) for k, d in events if k == "model" and d["task"] == "s0"]
    assert ("model-a", "start") in s0 and ("model-a", "win") in s0
    first_check = next(d for k, d in events if k == "check" and d["task"] == "s0")
    assert first_check["round"] == 1 and "not in the transcript" in first_check["problems"][0]


def test_short_first_section_and_cuts_snap_to_silence():
    sr = pipeline.SAMPLE_RATE
    audio = np.random.default_rng(0).normal(0, 0.3, 200 * sr).astype(np.float32)
    audio[int(37 * sr) : int(38 * sr)] = 0  # the only quiet second near the 40 s first cut
    sections = pipeline.plan_sections(audio, 200)
    assert len(sections) == 4 and 37 <= sections[0][1] <= 38 and sections[-1][1] == 200  # 40 s, then ~50 s each


def test_captions_replace_speech_recognition(fixture_clip, tmp_path, monkeypatch):
    video, _ = fixture_clip
    monkeypatch.setattr(pipeline, "SECTION_S", 20.0)
    monkeypatch.setattr(pipeline, "FIRST_S", 20.0)
    monkeypatch.setenv("LLM_MODELS", "model-a")
    monkeypatch.setattr(pipeline.syn, "ask", fake_ask_factory([]))
    monkeypatch.setattr(pipeline, "load_audio", lambda *a: (_ for _ in ()).throw(AssertionError("audio fetched")))
    captions = [Segment(t + 1, t + 4, f"caption number {t} says something useful here") for t in (0, 21, 41)]
    src = pipeline.Source(str(video), 60.0, audio=str(video), captions=captions, youtube_id="abc")
    result = pipeline.run(tmp_path, lambda *a, **k: None, src)
    assert result.transcriber == "creator subtitles" and result.youtube_id == "abc"
    assert [c.start_seconds for c in result.chapters] == [0, 22, 42]  # cuts at 20 and 40 s moved onto caption starts


def test_probe_rejects_non_video(tmp_path):
    bad = tmp_path / "notes.mp4"
    bad.write_text("not a video")
    try:
        pipeline.probe(bad)
    except ValueError:
        return
    raise AssertionError("probe accepted a non-video file")


def test_model_order_rotates_the_lead_provider_and_keeps_hedges_last():
    pool = ["groq:a", "groq:b", "groq:c", "nvidia:x", "nvidia:y"]
    assert pipeline._model_order(pool, 0) == pool
    assert pipeline._model_order(pool, 1) == ["groq:b", "groq:c", "groq:a", "nvidia:x", "nvidia:y"]
    assert pipeline._model_order(pool, 3) == pool
    assert pipeline._model_order(["a", "b"], 1) == ["b", "a"]  # one provider: plain rotation


def test_slow_model_is_hedged_by_the_next(monkeypatch, tmp_path):
    import time

    from vidmind.schema import Note, SectionOutput, Segment

    monkeypatch.setattr(pipeline, "HEDGE_S", 0.2)
    seg = [Segment(1.0, 4.0, "the quick brown fox jumps")]

    def fake_ask(messages, model, cls):
        if model == "slow":
            time.sleep(2)
        out = SectionOutput(title=model, notes=[Note(text="n", evidence=[
            {"kind": "transcript", "start_seconds": 1.0, "quote": "quick brown fox"}])])
        return out, "{}"

    monkeypatch.setattr(pipeline.syn, "ask", fake_ask)
    started = time.time()
    part = pipeline.write_section(0, 10, seg, [], tmp_path, 10, ["slow", "fast"])
    assert part.model == "fast" and part.chapter.title == "fast" and time.time() - started < 1.5


def test_embedded_subtitle_track_is_used(fixture_clip, tmp_path):
    video, _ = fixture_clip
    (tmp_path / "subs.srt").write_text("1\n00:00:01,000 --> 00:00:04,000\nHello from the subtitle track\n")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(video), "-i", str(tmp_path / "subs.srt"),
                    "-map", "0", "-map", "1", "-c", "copy", "-c:s", "srt", str(tmp_path / "video.mkv")], check=True)
    src = pipeline.local_source(tmp_path)
    assert src.captions == [Segment(1.0, 4.0, "Hello from the subtitle track")] and src.audio


def test_unreadable_frames_do_not_fail_the_job(tmp_path, monkeypatch):
    def broken(*a, **k):
        raise subprocess.CalledProcessError(1, "ffmpeg")

    monkeypatch.setattr(pipeline.fr, "scene_cuts", broken)
    events = []
    frames = pipeline._keyframes(pipeline.Source("https://expired.example/video", 60.0), tmp_path,
                                 lambda kind, **data: events.append(kind))
    assert frames == [] and "keyframes_failed" in events  # sections then use the transcript alone


def test_retention_runs_while_serving_without_failing_running_jobs(tmp_path, monkeypatch):
    import time

    from vidmind import jobs

    monkeypatch.setattr(jobs, "DATA_DIR", tmp_path / "jobs")
    old_id, old = jobs.create()
    jobs.write_status(old, status=jobs.DONE, created_at=time.time() - jobs.RETENTION_S - 1)
    live_id, live = jobs.create()
    jobs.write_status(live, status="writing_notes")
    jobs.sweep(restart=False)  # what the hourly cleanup runs
    assert not old.exists() and jobs.read_status(live_id)["status"] == "writing_notes"


def test_card_is_dropped_when_its_text_does_not_match(tmp_path, monkeypatch):
    from vidmind import pipeline as pl
    from vidmind.schema import Chapter, LearnResult, Note

    (tmp_path / "frames").mkdir()
    r = LearnResult(title="Adding and Completing Tasks in Taskly", chapters=[Chapter(title="c", start_seconds=0, notes=[
        Note(text="Add a task", evidence=[])])], quiz=[], duration_seconds=25, transcriber="t", model="m")
    monkeypatch.setattr(pl.syn, "draw_card", lambda prompt: b"img")
    monkeypatch.setattr(pl.fr, "ocr", lambda path: ("Adding and Completing\nTasks in Taskly", 99.0))  # title only
    state = {"card": None}
    pl._card(lambda: r, tmp_path, state)
    assert state["card"] is None and not (tmp_path / "frames" / "card.webp").exists()
    monkeypatch.setattr(pl.fr, "ocr", lambda path: ("Adding and Completing Tasks in Taskly\n• Add a task", 99.0))
    pl._card(lambda: r, tmp_path, state)
    assert state["card"] == "frames/card.webp"


def test_diagram_drops_unsupported_boxes_and_their_edges(monkeypatch):
    from vidmind import pipeline as pl
    from vidmind.schema import Segment, VisualOutput

    segs = [Segment(0, 5, "The client calls the gateway, which forwards to the auth service.")]
    said = lambda q: [{"kind": "transcript", "start_seconds": 1, "quote": q}]  # noqa: E731
    out = VisualOutput.model_validate({
        "takeaways": [{"text": "Requests go through the gateway.", "evidence": said("the client calls the gateway")},
                      {"text": "It uses Kafka.", "evidence": said("we use kafka for events")}],
        "diagram": {"kind": "sequence", "title": "Login", "nodes": [
            {"id": "c", "text": "Client", "evidence": said("the client calls the gateway")},
            {"id": "g", "text": "Gateway", "evidence": said("which forwards to the auth service")},
            {"id": "k", "text": "Kafka", "evidence": said("we use kafka for events")}],
            "edges": [{"source": "c", "target": "g", "label": "calls"}, {"source": "g", "target": "k"}]}})
    monkeypatch.setattr(pl.syn, "ask", lambda messages, model, cls: (out, "{}"))
    monkeypatch.setattr(pl.syn, "mode_messages", lambda *a: [])
    state = {"takeaways": [], "diagram": None, "extra_rejected": []}
    pl._visual(segs, [], None, 5, ["m"], state)
    assert [t.text for t in state["takeaways"]] == ["Requests go through the gateway."]
    d = state["diagram"]
    assert [n.id for n in d.nodes] == ["c", "g"] and [(e.source, e.target) for e in d.edges] == [("c", "g")]
    assert len(state["extra_rejected"]) == 2  # the Kafka takeaway and the Kafka box


def test_a_muse_key_means_muse_models_only(monkeypatch):
    from vidmind import synthesize as syn

    monkeypatch.setenv("LLM_MODELS", "muse:muse-spark-1.3,groq:gpt-oss,muse:muse-spark-1.2,nvidia:x")
    monkeypatch.setenv("MODEL_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("NVIDIA_API_KEY", "k")
    assert syn.models() == ["muse:muse-spark-1.3", "muse:muse-spark-1.2"]
    from vidmind import pipeline
    assert pipeline._model_order(syn.models(), 1) == ["muse:muse-spark-1.3", "muse:muse-spark-1.2"]  # no rotation
    monkeypatch.delenv("MODEL_API_KEY")
    assert syn.models() == ["groq:gpt-oss", "nvidia:x"]


def test_web_sources_keep_only_links_the_search_returned(monkeypatch):
    from types import SimpleNamespace as NS

    from vidmind import synthesize as syn

    hit = NS(type="web_search_call", results=[NS(url="https://kafka.apache.org/documentation/")])
    reply = '{"links": [{"url": "https://kafka.apache.org/documentation", "title": "Docs", "why": "a"}, ' \
            '{"url": "https://made-up.example/kafka", "title": "Invented", "why": "b"}]}'
    fake = NS(responses=NS(create=lambda **kw: NS(output=[hit], output_text=reply)))
    monkeypatch.setattr(syn, "_client", lambda prov: fake)
    assert [x["title"] for x in syn.further("Kafka 101", "", [])] == ["Docs"]  # the invented link is dropped


def test_web_sources_fall_back_to_real_results_when_the_model_answers_from_memory(monkeypatch):
    from types import SimpleNamespace as NS

    from vidmind import synthesize as syn

    hit = NS(type="web_search_call", results=[{"url": "https://docs.confluent.io/x", "title": "Consumer", "snippet": "How groups work"}])
    reply = '{"links": [{"url": "https://www.baeldung.com/kafka", "title": "From memory", "why": "b"}]}'
    monkeypatch.setattr(syn, "_client", lambda prov: NS(responses=NS(create=lambda **kw: NS(output=[hit], output_text=reply))))
    assert syn.further("Kafka", "", []) == [{"url": "https://docs.confluent.io/x", "title": "Consumer", "why": "How groups work"}]


def test_listen_first_writes_before_the_transcript_then_checks_against_it(fixture_clip, tmp_path, monkeypatch):
    import time as _time

    from vidmind.schema import Overview, VisualOutput

    video, _ = fixture_clip
    shutil.copy(video, tmp_path / "video.mp4")
    monkeypatch.setattr(pipeline, "SECTION_S", 20.0)
    monkeypatch.setattr(pipeline, "FIRST_S", 20.0)
    monkeypatch.setenv("MODEL_API_KEY", "k")
    monkeypatch.setenv("LLM_MODELS", "muse:muse-spark-1.3,muse:muse-spark-1.2")
    heard = [Segment(1.0, 8.0, "Welcome to product analytics one oh one."),
             Segment(21.0, 27.0, "Retention tells us how many users come back.")]
    monkeypatch.setattr(pipeline, "transcribe", lambda audio: (heard, "asr-x"))
    clips = []
    monkeypatch.setattr(pipeline, "_clip", lambda src, lo, hi, emit, task, pool, sound=False: clips.append(sound) or b"clip")
    monkeypatch.setattr(pipeline, "_track_figures", lambda src, emit: ({}, 0.0, None))
    monkeypatch.setattr(pipeline.syn, "read_screen", lambda image: "")
    monkeypatch.setattr(pipeline, "_extras", lambda *a: None)  # the card and web search are tested on their own
    prompts, firsts = [], []

    def fake_ask(messages, model, cls):
        if cls is Overview:
            return Overview(title="Product analytics 101", tldr="Activation and retention."), "{}"
        if cls is VisualOutput:
            return VisualOutput(), "{}"
        text = messages[1]["content"][0]["text"]
        lo = float(re.search(r"Section (\d+)s", text).group(1))
        prompts.append(text)
        firsts.append(model)
        ev = {0: [{"kind": "transcript", "start_seconds": 1.0, "quote": "welcome to product analytics"},
                  {"kind": "frame", "start_seconds": 12.0, "text": "the first slide"}],  # no keyframe this close
              20: [{"kind": "transcript", "start_seconds": 21.0, "quote": "retention tells us how many users"}],
              40: [{"kind": "frame", "start_seconds": 45.0, "text": "the last slide"}]}[int(lo)]
        out = {"title": f"At {lo:.0f}s", "notes": [{"text": "A note.", "evidence": ev}], "quiz": []}
        return SectionOutput.model_validate(out), json.dumps(out)

    monkeypatch.setattr(pipeline.syn, "ask", fake_ask)
    result = pipeline.run(tmp_path, lambda step=None, **kw: None)

    assert result.pending and [c.start_seconds for c in result.chapters] == [0, 20, 40]
    assert all(clips) and len(clips) == 3, "every section clip carries sound"
    assert all("Not given: listen" in p and "Welcome" not in p for p in prompts), "written before the transcript"
    assert set(firsts) == {"muse:muse-spark-1.2"}, "1.2 leads on listen-first sections"
    frame = next(e for e in result.chapters[0].notes[0].evidence if e.kind == "frame")
    assert frame.frame_url == "frames/at120.jpg" and (tmp_path / frame.frame_url).exists(), "cited second grabbed"
    assert result.dropped_notes == 0 and result.citations_rechecked == 0
    for _ in range(50):  # the title and takeaways land right after "done"
        saved = json.loads((tmp_path / "result.json").read_text())
        if not saved["pending"]:
            break
        _time.sleep(0.1)
    assert not saved["pending"] and saved["title"] == "Product analytics 101"


def test_listen_first_survives_a_failed_audio_fetch(fixture_clip, tmp_path, monkeypatch):
    """The audio stream refusing twice must not sink the job: notes with on-screen proof stand."""
    import subprocess as sp

    video, _ = fixture_clip
    shutil.copy(video, tmp_path / "video.mp4")
    monkeypatch.setattr(pipeline, "SECTION_S", 20.0)
    monkeypatch.setattr(pipeline, "FIRST_S", 20.0)
    monkeypatch.setenv("MODEL_API_KEY", "k")
    monkeypatch.setenv("LLM_MODELS", "muse:muse-spark-1.2")
    monkeypatch.setattr(pipeline, "load_audio", lambda *a: (_ for _ in ()).throw(sp.CalledProcessError(8, "ffmpeg")))
    monkeypatch.setattr(pipeline, "_clip", lambda *a, **k: b"clip")
    monkeypatch.setattr(pipeline, "_track_figures", lambda src, emit: ({}, 0.0, None))
    monkeypatch.setattr(pipeline.syn, "read_screen", lambda image: "")
    monkeypatch.setattr(pipeline, "_extras", lambda *a: None)

    def fake_ask(messages, model, cls):
        if cls is not SectionOutput:
            return cls.model_validate({"title": "T", "tldr": "S"} if "tldr" in cls.model_fields else {}), "{}"
        lo = float(re.search(r"Section (\d+)s", messages[1]["content"][0]["text"]).group(1))
        out = {"title": "T", "notes": [{"text": "Shown on screen.", "evidence": [
            {"kind": "transcript", "start_seconds": lo + 1, "quote": "words nobody can check now"},
            {"kind": "frame", "start_seconds": lo + 1, "text": "a slide"}]}]}
        return SectionOutput.model_validate(out), json.dumps(out)

    monkeypatch.setattr(pipeline.syn, "ask", fake_ask)
    result = pipeline.run(tmp_path, lambda step=None, **kw: None)
    assert len(result.chapters) == 3
    assert all(e.kind == "frame" for c in result.chapters for n in c.notes for e in n.evidence)  # quotes dropped


def test_grabbed_frames_merge_into_a_new_sorted_list_without_duplicates(fixture_clip, tmp_path, monkeypatch):
    """Listen-first grabs a frame at each cited second; when keyframes land later at the same second, the saved
    list keeps one image per time, in order, and the keyframe list the side pool indexes is never changed."""
    import threading

    from vidmind.schema import Frame

    video, _ = fixture_clip
    shutil.copy(video, tmp_path / "video.mp4")
    monkeypatch.setattr(pipeline, "SECTION_S", 20.0)
    monkeypatch.setattr(pipeline, "FIRST_S", 20.0)
    monkeypatch.setenv("MODEL_API_KEY", "k")
    monkeypatch.setenv("LLM_MODELS", "muse:muse-spark-1.2")
    monkeypatch.setattr(pipeline, "transcribe", lambda audio: ([], "asr-x"))
    monkeypatch.setattr(pipeline, "_clip", lambda *a, **k: b"clip")
    monkeypatch.setattr(pipeline, "_track_figures", lambda src, emit: ({}, 0.0, None))
    monkeypatch.setattr(pipeline, "_read_screens", lambda *a, **k: None)
    monkeypatch.setattr(pipeline, "_extras", lambda *a: None)
    extract, grabs = pipeline.fr.extract_frame, threading.Semaphore(0)
    monkeypatch.setattr(pipeline.fr, "extract_frame", lambda *a: (extract(*a), grabs.release()))
    keys = [Frame(0.0, "frames/0.jpg"), Frame(12.0, "frames/12.jpg"), Frame(30.0, "frames/30.jpg")]
    before = list(keys)

    def late_keyframes(src, job_dir, emit):  # after all three cited seconds were grabbed, so 12 s is grabbed and keyed
        assert all(grabs.acquire(timeout=20) for _ in range(3))
        return keys

    monkeypatch.setattr(pipeline, "_keyframes", late_keyframes)

    def fake_ask(messages, model, cls):
        if cls is not SectionOutput:
            return cls.model_validate({"title": "T", "tldr": "S"} if "tldr" in cls.model_fields else {}), "{}"
        lo = int(float(re.search(r"Section (\d+)s", messages[1]["content"][0]["text"]).group(1)))
        cite = {0: 12.0, 40: 45.0}.get(lo, lo + 1.0)
        out = {"title": "T", "notes": [{"text": "On screen.", "evidence": [
            {"kind": "frame", "start_seconds": cite, "text": "a slide"}]}]}
        return SectionOutput.model_validate(out), json.dumps(out)

    monkeypatch.setattr(pipeline.syn, "ask", fake_ask)
    pipeline.run(tmp_path, lambda step=None, **kw: None)

    saved = json.loads((tmp_path / "frames.json").read_text())
    times, urls = [f["t"] for f in saved], [f["url"] for f in saved]
    assert len(set(urls)) == len(urls) and len(set(times)) == len(times), "one image per time"
    assert times == sorted(times) and 12.0 in times and 45.0 in times
    assert "frames/12.jpg" in urls and "frames/at450.jpg" in urls, "the keyframe wins; a new second is added"
    assert keys == before, "the keyframe list is never mutated"


