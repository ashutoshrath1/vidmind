import json
import time
import re
import shutil
import subprocess

import numpy as np

from vidmind import pipeline
from vidmind.schema import Overview, SectionOutput, Segment, VisualOutput


def fake_ask_factory(calls):
    """Stub for synthesize.ask: cites the section's first transcript line and keyframe, like a good model would."""

    def fake_ask(messages, model, cls, on_text=None):
        if cls is Overview:
            return Overview(title="Product analytics 101", tldr="Activation, retention and the north star."), "raw"
        if cls is VisualOutput:
            return VisualOutput(), "{}"  # whole-video takeaways: covered by their own test
        if messages[0]["content"] is pipeline.syn.SCREEN_SYSTEM:
            return SectionOutput(title="On screen", notes=[]), "{}"  # the on-screen pass: covered by its own test
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
            quote = "activation requires a paid plan"  # fabricated: the check drops this citation
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
    assert result.pending  # the notes are out first; title, summary and takeaways follow
    for _ in range(100):
        later = json.loads((tmp_path / "result.json").read_text())
        if not later["pending"]:
            break
        time.sleep(0.05)
    assert later["title"] == "Product analytics 101" and later["tldr"]
    assert result.dropped_notes == 0 and result.rejected == []
    assert result.notes_checked == 3 and result.citations_rechecked == 1  # the fabricated quote, counted
    assert "model-b" not in result.model  # b always fails; its sections were won by a racing or fallback model
    # The fabricated quote is dropped and the note stands on its keyframe: no ~5 s repair round for one bad citation.
    assert sum(1 for lo, m, _ in calls if lo == 0 and m == "model-a") == 1
    assert [e.frame_url for c in result.chapters for e in c.notes[0].evidence if e.kind == "frame"] == \
        ["frames/0.jpg", "frames/1.jpg", "frames/2.jpg"]
    assert all(c.cover_url and c.summary and c.key_terms for c in result.chapters)
    assert ("transcribing", {"sections_done": 0, "sections_total": 3}) in updates
    assert [kw["sections_done"] for step, kw in updates if step is None] == [1, 2, 3]
    assert (tmp_path / "result.json").exists() and (tmp_path / "transcript.json").exists()
    assert len(json.loads((tmp_path / "frames.json").read_text())) == 3  # kept for "Ask the video"
    assert not list(tmp_path.glob("*.wav"))

    # The live "behind the scenes" trace: every step the page shows. Screen reading starts after the notes.
    for _ in range(100):
        if any(k == "stage" and d.get("name") == "ocr" and d.get("state") == "end" for k, d in events):
            break
        time.sleep(0.05)
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
    audio[int(18 * sr) : int(19 * sr)] = 0  # the only quiet second near the 20 s first cut
    sections = pipeline.plan_sections(audio, 200)
    assert len(sections) == 5 and 18 <= sections[0][1] <= 19 and sections[-1][1] == 200  # 20 s, then ~45 s each


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


def test_sections_written_before_the_keyframes_get_checked_on_screen_notes_afterwards(fixture_clip, tmp_path, monkeypatch):
    video, _ = fixture_clip
    monkeypatch.setattr(pipeline, "SECTION_S", 20.0)
    monkeypatch.setattr(pipeline, "FIRST_S", 20.0)
    monkeypatch.setenv("LLM_MODELS", "model-a")
    keyframes = pipeline._keyframes
    monkeypatch.setattr(pipeline, "_keyframes", lambda *a: (time.sleep(1.0), keyframes(*a))[1])  # captions come first
    sections_ask = fake_ask_factory([])
    seen_screen = []

    def fake_ask(messages, model, cls, on_text=None):
        if messages[0]["content"] is pipeline.syn.SCREEN_SYSTEM:
            text = messages[1]["content"][0]["text"]
            frame_t = float(re.findall(r"\[frame ([\d.]+)s\]", text)[-1])  # a real keyframe
            seen_screen.append(text)
            out = {"title": "On screen", "notes": [
                {"text": "The slide shows the target.", "evidence": [{"kind": "frame", "start_seconds": frame_t, "text": "slide"}]},
                {"text": "Invented.", "evidence": [{"kind": "frame", "start_seconds": 59.9, "text": "nothing there"}]}]}
            return SectionOutput.model_validate(out), json.dumps(out)
        return sections_ask(messages, model, cls)

    monkeypatch.setattr(pipeline.syn, "ask", fake_ask)
    captions = [Segment(t + 1, t + 4, f"caption number {t} says something useful here") for t in (0, 21, 41)]
    src = pipeline.Source(str(video), 60.0, audio=str(video), captions=captions, youtube_id="abc")
    result = pipeline.run(tmp_path, lambda *a, **k: None, src)
    assert result.pending and all(len(c.notes) == 1 for c in result.chapters)  # written without keyframes
    for _ in range(100):
        later = json.loads((tmp_path / "result.json").read_text())
        if not later["pending"]:
            break
        time.sleep(0.05)
    assert seen_screen and "NOTES ALREADY WRITTEN\n- A grounded note." in seen_screen[0]
    at = float(re.findall(r"\[frame ([\d.]+)s\]", seen_screen[0])[-1])
    starts = [c["start_seconds"] for c in later["chapters"]]
    home = max(k for k, lo in enumerate(starts) if lo <= at)
    # The slide note joined the section its keyframe falls in; the invented one failed the check.
    assert [len(c["notes"]) for c in later["chapters"]] == [2 if k == home else 1 for k in range(len(starts))]


def test_notes_are_shown_as_they_are_written_but_only_after_the_evidence_check(fixture_clip, tmp_path, monkeypatch):
    video, _ = fixture_clip
    monkeypatch.setattr(pipeline, "SECTION_S", 60.0)
    monkeypatch.setattr(pipeline, "FIRST_S", 60.0)
    monkeypatch.setenv("LLM_MODELS", "model-a")
    captions = [Segment(1, 4, "welcome to product analytics today"), Segment(21, 24, "retention tells us how many users")]
    reply = json.dumps({"title": "T", "notes": [
        {"text": "Welcome.", "evidence": [{"kind": "transcript", "start_seconds": 1, "quote": "welcome to product analytics"}]},
        {"text": "Made up.", "evidence": [{"kind": "transcript", "start_seconds": 21, "quote": "pricing doubles next year"}]},
        {"text": "Retention.", "evidence": [{"kind": "transcript", "start_seconds": 21, "quote": "retention tells us how many"}]}]})

    def fake_ask(messages, model, cls, on_text=None):
        if cls is not SectionOutput or messages[0]["content"] is pipeline.syn.SCREEN_SYSTEM:
            return fake_ask_factory([])(messages, model, cls)
        for k in [*range(20, len(reply), 20), len(reply)]:  # streams in pieces, then the end
            on_text and on_text(reply[:k])
        return SectionOutput.model_validate_json(reply), reply

    monkeypatch.setattr(pipeline.syn, "ask", fake_ask)
    events = []
    src = pipeline.Source(str(video), 60.0, audio=str(video), captions=captions)
    pipeline.run(tmp_path, lambda *a, **k: None, src, lambda kind, **d: events.append((kind, d)))
    kinds = [k for k, _ in events]
    shown = [d["note"]["text"] for k, d in events if k == "note"]
    assert shown == ["Welcome.", "Retention."]  # the made-up quote never reached the page
    assert kinds.index("note") < kinds.index("section")  # before the section was finished


def test_notes_finish_without_waiting_for_slow_keyframes(fixture_clip, tmp_path, monkeypatch):
    video, _ = fixture_clip
    monkeypatch.setattr(pipeline, "SECTION_S", 20.0)
    monkeypatch.setattr(pipeline, "FIRST_S", 20.0)
    monkeypatch.setenv("LLM_MODELS", "model-a")
    monkeypatch.setattr(pipeline.syn, "ask", fake_ask_factory([]))
    keyframes = pipeline._keyframes
    monkeypatch.setattr(pipeline, "_keyframes", lambda *a: (time.sleep(3), keyframes(*a))[1])  # a throttled stream
    captions = [Segment(t + 1, t + 4, f"caption number {t} says something useful here") for t in (0, 21, 41)]
    src = pipeline.Source(str(video), 60.0, audio=str(video), captions=captions, youtube_id="abc")
    started = time.monotonic()
    result = pipeline.run(tmp_path, lambda *a, **k: None, src)
    assert time.monotonic() - started < 2.5 and result.chapters  # the notes did not wait the 3 s
    for _ in range(100):
        if (tmp_path / "frames.json").exists():
            break
        time.sleep(0.1)
    assert json.loads((tmp_path / "frames.json").read_text())  # the keyframes still arrive, afterwards


def test_a_slow_scene_scan_falls_back_to_evenly_spaced_keyframes(fixture_clip, tmp_path, monkeypatch):
    import subprocess as sp

    video, _ = fixture_clip
    def slow(*a, **k):
        raise sp.TimeoutExpired("ffmpeg", 8)
    monkeypatch.setattr(pipeline.fr, "scene_cuts", slow)
    events = []
    frames = pipeline._keyframes(pipeline.Source(str(video), 60.0), tmp_path, lambda kind, **d: events.append((kind, d)))
    assert len(frames) >= 3 and all((tmp_path / f.url).exists() for f in frames)
    assert any(k == "stage" and d.get("name") == "scenes" and "Evenly spaced" in d.get("detail", "") for k, d in events)


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

    def fake_ask(messages, model, cls, on_text=None):
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
    from vidmind import models as mdl

    monkeypatch.setenv("LLM_MODELS", "muse:muse-spark-1.3,groq:gpt-oss,muse:muse-spark-1.2,nvidia:x")
    monkeypatch.setenv("MODEL_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("NVIDIA_API_KEY", "k")
    assert mdl.notes() == ["muse:muse-spark-1.3", "muse:muse-spark-1.2"]
    from vidmind import pipeline
    assert pipeline._model_order(mdl.notes(), 1) == ["muse:muse-spark-1.3", "muse:muse-spark-1.2"]  # no rotation
    monkeypatch.delenv("MODEL_API_KEY")
    assert mdl.notes() == ["groq:gpt-oss", "nvidia:x"]


def test_clean_article_drops_paragraphs_without_valid_cites():
    from vidmind.schema import ArticleOutput
    out = ArticleOutput.model_validate({"hook": "Hook — here.", "picture": "A funnel.", "paragraphs": [
        {"text": "Rests on note 1.", "cites": [1, 7]}, {"text": "No cites.", "cites": []},
        {"text": "Bad cite only.", "cites": [5, -1]}]})
    clean = pipeline._clean_article(out, 2)
    assert [(p.text, p.cites) for p in clean.paragraphs] == [("Rests on note 1.", [1])] and clean.hook == "Hook, here."
    assert pipeline._clean_article(ArticleOutput.model_validate(
        {"hook": "h", "paragraphs": [{"text": "x", "cites": [9]}]}), 2) == ArticleOutput()


def test_article_illustrations_and_slides_follow_the_notes(fixture_clip, tmp_path, monkeypatch):
    from vidmind.schema import ArticleOutput, SlidesOutput
    video, _ = fixture_clip
    monkeypatch.setattr(pipeline, "SECTION_S", 20.0)
    monkeypatch.setattr(pipeline, "FIRST_S", 20.0)
    monkeypatch.setenv("LLM_MODELS", "model-a")
    monkeypatch.setenv("MODEL_API_KEY", "test")  # turns on the illustrations (and the card, which fails here too)
    sections_ask = fake_ask_factory([])
    release = __import__("threading").Event()

    def fake_ask(messages, model, cls, on_text=None):
        if cls is ArticleOutput:
            release.wait(5)  # holds the after-phase open so `pending` can be seen
            shown = re.findall(r"^\[([\d.]+)s\]", messages[1]["content"].split("KEYFRAMES")[1], re.M)
            visual = {"kind": "keyframe", "keyframe_t": float(shown[0])} if shown else \
                {"kind": "illustration", "type": "infographic", "prompt": "Layout: one rising bar"}
            return ArticleOutput.model_validate({"hook": "Activation is 40%.", "picture": "A rising bar.", "paragraphs": [
                {"text": "Cited.", "cites": [0]}, {"text": "Invented.", "cites": [3]}], "visual": visual}), "{}"
        if cls is SlidesOutput:
            t = float(re.findall(r"\[frame ([\d.]+)s\]", messages[1]["content"])[0])
            return SlidesOutput.model_validate({"slides": [
                {"t": t + 0.5, "title": "Real slide", "explanation": "Shows the target."},
                {"t": 33.0, "title": "Not a keyframe", "explanation": "Made up."}]}), "{}"
        return sections_ask(messages, model, cls)

    monkeypatch.setattr(pipeline.syn, "ask", fake_ask)
    monkeypatch.setattr(pipeline.syn, "draw_card", lambda *a: (_ for _ in ()).throw(RuntimeError("image down")))
    events = []
    captions = [Segment(t + 1, t + 4, f"caption number {t} says something useful here") for t in (0, 21, 41)]
    src = pipeline.Source(str(video), 60.0, audio=str(video), captions=captions)
    result = pipeline.run(tmp_path, lambda *a, **k: None, src, lambda kind, **d: events.append((kind, d)))
    time.sleep(0.5)
    assert json.loads((tmp_path / "result.json").read_text())["pending"]  # article still being written
    release.set()
    for _ in range(200):
        later = json.loads((tmp_path / "result.json").read_text())
        if not later["pending"]:
            break
        time.sleep(0.05)
    assert not later["pending"]
    for c in later["chapters"]:
        assert c["hook"] == "Activation is 40%." and [p["text"] for p in c["article"]] == ["Cited."]
        assert c["notes"]  # the image failed; notes and article stand
        assert c["image_url"] is None or (c["image_kind"] == "keyframe" and c["image_url"].startswith("frames/"))
    assert [s["t"] for s in later["slides"]] == [1.0] and later["slides"][0]["title"] == "Real slide"
    ends = {d["name"]: d for k, d in events if k == "stage" and d.get("state") == "end"}
    assert "error" in ends["images"] and "error" not in ends["article"] and ends["slides"]["kept"] == 1
    assert len(result.chapters) == 3


def test_an_illustration_is_published_by_itself_as_soon_as_it_is_drawn(tmp_path, monkeypatch):
    from vidmind import pipeline as pl

    chapter = pl.Chapter(title="Circuit breakers", start_seconds=0, notes=[], summary="Stops calls to a failing service.")
    prompts, saved, events = [], [], []
    monkeypatch.setattr(pl.syn, "draw_card", lambda prompt, strength="low": prompts.append((prompt, strength)) or b"img")
    pl._draw_image(2, chapter, tmp_path, lambda kind, **d: events.append(kind), lambda: saved.append(chapter.image_url), 0.0)
    assert (tmp_path / "frames" / "ch2.webp").read_bytes() == b"img"
    assert chapter.image_url == "frames/ch2.webp" and chapter.image_alt  # set before the page is told
    assert saved == ["frames/ch2.webp"] and events == ["image"]
    assert "Circuit breakers" in prompts[0][0] and "Stops calls" in prompts[0][0] and prompts[0][1] == "low"
    assert chapter.image_kind == "illustration"
    from vidmind.schema import Visual
    pl._draw_image(3, chapter, tmp_path, lambda *a, **k: None, lambda: None, 0.0,
                   plan=Visual(kind="illustration", type="flowchart", prompt="Layout: three zones left to right"))
    assert prompts[1][0].startswith("A flowchart illustration") and "three zones" in prompts[1][0]
    assert "rendering guidance only" in prompts[1][0] and "no text" in prompts[1][0]


def test_a_keyframe_plan_must_name_a_real_chapter_keyframe():
    from vidmind import pipeline as pl
    from vidmind.schema import Visual
    frames = [pl.Frame(t=12.0, url="frames/0.jpg"), pl.Frame(t=40.0, url="frames/1.jpg", figure_url="frames/1_fig.jpg")]
    kf = lambda t, **k: Visual(kind="keyframe", keyframe_t=t, **k)  # noqa: E731
    assert pl._plan_visual(kf(40.0), frames, True) == ("keyframe", frames[1])
    assert pl._plan_visual(kf(41.0, prompt="Layout: two zones"), frames, True) == ("illustration", None)  # not a keyframe
    assert pl._plan_visual(kf(41.0), frames, True) == ("none", None)  # and no prompt to draw instead
    assert pl._plan_visual(kf(12.0), None, True) == ("none", None)  # frames not captured yet: no keyframe possible
    assert pl._plan_visual(Visual(kind="illustration", prompt="Layout: x"), frames, False) == ("none", None)  # no slot
    c = pl.Chapter(title="T", start_seconds=0, notes=[])
    pl._show_keyframe(c, frames[1])
    assert (c.image_url, c.image_kind, c.image_seconds) == ("frames/1_fig.jpg", "keyframe", 40.0) and c.image_alt


def test_illustrations_go_to_at_most_the_share_of_chapters_with_the_most_notes(monkeypatch):
    from vidmind import pipeline as pl
    monkeypatch.setattr(pl, "ILLUSTRATION_SHARE", 0.5)
    assert pl._illustration_cap(13) == 6 and pl._illustration_cap(1) == 1 and pl._illustration_cap(0) == 1
    counts, used, cap, total = [], 0, pl._illustration_cap(6), 6
    for n in [5, 2, 6, 1, 4, 3]:  # every chapter asks for a drawing
        if pl._may_illustrate(n, counts, used, cap, total - len(counts)):
            used += 1
        counts.append(n)
    assert used == cap == 3
    assert pl._may_illustrate(2, [5], 0, 3, 5) is False  # below the median so far, slots can still go to richer ones
    assert pl._may_illustrate(1, [5, 6], 1, 3, 2) is True  # the chapters left can only just use the slots


def test_a_keyframe_visual_needs_no_image_call(tmp_path, monkeypatch):
    from vidmind import pipeline as pl
    from vidmind.schema import ArticleOutput
    c = pl.Chapter(title="Queues", start_seconds=0, notes=[pl.Note(text="A queue buffers work.", evidence=[])])
    frames = [pl.Frame(t=5.0, url="frames/0.jpg")]
    monkeypatch.setattr(pl.syn, "ask", lambda *a, **k: (ArticleOutput.model_validate({
        "hook": "h", "picture": "A slide of a queue.", "paragraphs": [{"text": "p", "cites": [0]}],
        "visual": {"kind": "keyframe", "keyframe_t": 5.0}}), "{}"))
    monkeypatch.setattr(pl.syn, "draw_card", lambda *a: (_ for _ in ()).throw(AssertionError("no image call")))
    sent = []
    monkeypatch.setattr(pl.syn, "article_messages", lambda *a: sent.append(a[-1]) or [])
    plans = []
    pl._article_one(c, ["m"], lambda *a, **k: None, lambda: None, frames, tmp_path,
                    lambda v: plans.append(pl._plan_visual(v, frames, True)))
    kind, f = plans[0]
    pl._show_keyframe(c, f)
    assert kind == "keyframe" and c.image_url == "frames/0.jpg" and c.image_alt == "A slide of a queue."
    assert [x.t for x in sent[0]] == [5.0]  # the writer saw the chapter's keyframe times


def test_a_raced_request_returns_the_faster_copy_and_survives_one_failure(monkeypatch):
    import threading
    import time

    from vidmind import pipeline as pl

    calls = []
    lock = threading.Lock()

    def draw():
        with lock:
            calls.append(1)
            n = len(calls)
        if n == 1:
            time.sleep(2)  # the first copy is slow
            return b"slow"
        return b"fast"

    started = time.monotonic()
    assert pl._race(draw, 2) == b"fast" and time.monotonic() - started < 1.5

    calls.clear()

    def one_fails():
        with lock:
            calls.append(1)
            n = len(calls)
        if n == 1:
            raise RuntimeError("500")
        time.sleep(0.2)
        return b"ok"

    assert pl._race(one_fails, 2) == b"ok"
    assert pl._race(lambda: b"single", 1) == b"single"  # one copy: no extra requests

