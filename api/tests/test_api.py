import json

import pytest
from fastapi.testclient import TestClient

from vidmind import fetch, jobs
from vidmind.main import app

client = TestClient(app)  # no `with`: lifespan (worker thread) stays off, jobs just queue


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "DATA_DIR", tmp_path / "jobs")


def test_rejects_wrong_extension():
    r = client.post("/jobs", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_rejects_non_video_and_cleans_up(tmp_path):
    r = client.post("/jobs", files={"file": ("fake.mp4", b"not a video", "video/mp4")})
    assert r.status_code == 400
    assert not any((tmp_path / "jobs").iterdir())


def test_rejects_oversized_upload_by_header():
    r = client.post("/jobs", files={"file": ("big.mp4", b"x", "video/mp4")},
                    headers={"content-length": str(3 * 1024**3)})
    assert r.status_code == 413


def test_upload_creates_queued_job_and_serves_video(fixture_clip):
    video, _ = fixture_clip
    r = client.post("/jobs", files={"file": ("demo.mp4", video.read_bytes(), "video/mp4")})
    assert r.status_code == 201
    job_id = r.json()["id"]
    assert client.get(f"/jobs/{job_id}").json()["status"] == "queued"
    ranged = client.get(f"/jobs/{job_id}/video", headers={"Range": "bytes=0-99"})
    assert ranged.status_code == 206 and len(ranged.content) == 100
    assert client.get(f"/jobs/{job_id}/result").status_code == 404
    assert client.delete(f"/jobs/{job_id}").status_code == 204
    assert client.get(f"/jobs/{job_id}").status_code == 404


@pytest.mark.parametrize("job_id", ["nope", "../../etc", "0" * 32])
def test_unknown_or_malformed_job_ids_404(job_id):
    assert client.get(f"/jobs/{job_id}").status_code == 404


def test_frame_names_are_restricted():
    assert client.get("/jobs/sample/frames/..%2Fjob.json").status_code == 404


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        ({"url": "https://www.youtube.com/watch?v=x"}, "Confirm you own"),
        ({"url": "https://www.udemy.com/course/x/learn/lecture/1", "rights_confirmed": True}, "copy-protected"),
        ({"url": "http://localhost:8000/jobs", "rights_confirmed": True}, "private or local"),
        ({"url": "http://169.254.169.254/latest/meta-data", "rights_confirmed": True}, "private or local"),
        ({"url": "file:///etc/passwd", "rights_confirmed": True}, "http(s) link"),
    ],
)
def test_link_import_rejections(body, fragment, tmp_path):
    r = client.post("/jobs/from-url", json=body)
    assert r.status_code == 400 and fragment in r.json()["detail"]
    assert not (tmp_path / "jobs").exists()


def test_same_upload_is_reused_once_done(fixture_clip):
    video, _ = fixture_clip
    first = client.post("/jobs", files={"file": ("demo.mp4", video.read_bytes(), "video/mp4")}).json()
    assert first["reused"] is False
    jobs.write_status(jobs.job_dir(first["id"]), status=jobs.DONE)
    again = client.post("/jobs", files={"file": ("copy.mp4", video.read_bytes(), "video/mp4")}).json()
    assert again == {"id": first["id"], "reused": True}
    assert len(list(jobs.DATA_DIR.iterdir())) == 1  # the duplicate upload was removed
    # Both uploaders now hold the id, so neither may delete it for the other.
    r = client.delete(f"/jobs/{first['id']}")
    assert r.status_code == 403 and "same video" in r.json()["detail"]


def test_events_stream_status_until_done():
    with client.stream("GET", "/jobs/sample/events") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    assert [e["status"] for e in events if "status" in e] == ["done"]  # trace lines also start with "data: "


def test_stream_plan_picks_fast_formats_and_creator_subtitles():
    f = lambda fid, h, vcodec, acodec="none", abr=None: {  # noqa: E731
        "format_id": fid, "height": h, "vcodec": vcodec, "acodec": acodec, "abr": abr, "protocol": "https",
        "url": f"https://v/{fid}", "http_headers": {"User-Agent": "UA"}}
    info = {"extractor_key": "Youtube", "id": "abc", "duration": 316, "language": "en",
            "formats": [f("394", 144, "av01"), f("134", 360, "avc1.4D401E"), f("396", 360, "av01"),
                        f("136", 720, "avc1.4d401f"), f("398", 720, "av01"), f("299", 1080, "avc1"),
                        f("139", None, "none", "mp4a", 48), f("140", None, "none", "mp4a", 129)],
            "subtitles": {"live_chat": [{"ext": "json"}], "en": [{"ext": "json3", "url": "j"}, {"ext": "vtt", "url": "s"}]}}
    plan = fetch.stream_plan(info)
    assert (plan["video"], plan["scan"], plan["audio"]) == ("https://v/136", "https://v/134", "https://v/139")
    assert plan["captions"] == "s" and plan["headers"] == "User-Agent: UA\r\n" and plan["youtube_id"] == "abc"
    assert fetch.stream_plan({**info, "playable_in_embed": False}) is None  # embedding off → download instead
    assert fetch.stream_plan({**info, "extractor_key": "Vimeo"}) is None


def test_stream_plan_takes_the_original_audio_not_a_dub_and_youtubes_own_captions_when_no_subtitles():
    track = lambda fid, lang, pref, abr: {  # noqa: E731
        "format_id": fid, "vcodec": "none", "acodec": "opus", "abr": abr, "protocol": "https", "url": f"https://v/{fid}",
        "language": lang, "language_preference": pref}
    info = {"extractor_key": "Youtube", "id": "abc", "duration": 600, "language": "en-US",
            "formats": [{"format_id": "136", "height": 720, "vcodec": "avc1", "acodec": "none", "protocol": "https",
                         "url": "https://v/136"},
                        track("249-de", "de-DE", -1, 45), track("249-en", "en-US", 10, 49), track("251-en", "en-US", 10, 130)],
            "automatic_captions": {"de-orig": [{"ext": "json3", "url": "de"}],
                                   "en-orig": [{"ext": "vtt", "url": "v"}, {"ext": "json3", "url": "en"}]}}
    plan = fetch.stream_plan(info)
    assert plan["audio"] == "https://v/249-en"  # the German dub has the lowest bitrate, but isn't the original
    assert plan["captions"] == "en"


def test_events_stream_the_trace_then_status():
    job_id, d = jobs.create()
    emit = jobs.tracer(d)
    emit("plan", sections=[[0, 40]])
    emit("frame", i=0, t=10.0, text="Week-1 retention target: 40%")
    jobs.write_status(d, status=jobs.DONE)
    with client.stream("GET", f"/jobs/{job_id}/events") as r:
        lines = [line for line in r.iter_lines() if line]
    traces = [json.loads(lines[i + 1][6:]) for i, line in enumerate(lines) if line == "event: trace"]
    assert [t["kind"] for t in traces] == ["plan", "frame"] and traces[1]["text"].endswith("40%")
    status = json.loads(next(line for line in lines if line.startswith("data: {\"id\""))[6:])
    assert status["status"] == "done" and "server_time" in status


def test_upload_without_a_size_is_refused_before_reading_it():
    # A chunked body has no Content-Length; FastAPI would otherwise spool all of it to disk first.
    r = client.post("/jobs", content=(b"x" * 1024 for _ in range(4)),
                    headers={"content-type": "multipart/form-data; boundary=b"})
    assert r.status_code == 411


def test_events_resume_after_last_event_id():
    job_id, d = jobs.create()
    emit = jobs.tracer(d)
    emit("plan", sections=[[0, 40]])
    emit("frame", i=0, at=10.0, text="first")
    emit("frame", i=1, at=30.0, text="second")
    jobs.write_status(d, status=jobs.DONE)
    with client.stream("GET", f"/jobs/{job_id}/events") as r:
        ids = [int(line[4:]) for line in r.iter_lines() if line.startswith("id: ")]
    with client.stream("GET", f"/jobs/{job_id}/events", headers={"Last-Event-ID": str(ids[1])}) as r:
        lines = list(r.iter_lines())
    traces = [json.loads(lines[i + 1][6:]) for i, line in enumerate(lines) if line == "event: trace"]
    assert ids == sorted(ids) and [t.get("text") for t in traces] == ["second"]  # nothing replayed twice




def test_frames_serves_only_pipeline_file_names():
    for ok in ("0.jpg", "0_fig.jpg", "ch0.webp", "card.webp"):
        assert client.get(f"/jobs/sample/frames/{ok}").status_code == 200, ok
    for bad in ("../result.json", "x.png", "ch0.webp.jpg", "0.jpeg", "result.json"):
        assert client.get(f"/jobs/sample/frames/{bad}").status_code == 404, bad
