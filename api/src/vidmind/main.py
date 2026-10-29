"""HTTP API: upload a video or link, follow the job (server-sent events), fetch the result and media, ask questions.

Blocking work (ffprobe, yt-dlp, LLM calls) runs in plain `def` routes or `run_in_threadpool`, never on the event loop.
"""

import asyncio
import hashlib
import json
import logging
import re
import os
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path


from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from . import fetch, jobs
from .pipeline import MAX_BYTES, MAX_DURATION_S, PIPELINE_VERSION, probe
from .schema import LearnResult

logging.basicConfig(level=logging.INFO)
ALLOWED_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
WEB_ORIGINS = os.environ.get("VIDMIND_WEB_ORIGIN", "http://localhost:3000").split(",")


@asynccontextmanager
async def lifespan(_: FastAPI):
    jobs.sweep()
    jobs.start_workers()
    jobs.start_cleanup()
    yield


app = FastAPI(title="VidMind API", lifespan=lifespan)


@app.middleware("http")  # registered before CORS, so CORS wraps it and the browser can read these errors
async def limit_upload(request: Request, call_next):
    # FastAPI reads the whole multipart body to disk before the route runs, so the size check must come first.
    if request.method == "POST" and request.url.path == "/jobs":
        size = request.headers.get("content-length", "")
        if not size.isdigit():
            return JSONResponse({"detail": "Upload size unknown (no Content-Length header)"}, 411)
        if int(size) > MAX_BYTES + 1024 * 1024:  # multipart framing adds a little
            return JSONResponse({"detail": f"Video is larger than {MAX_BYTES // 1024**3} GB"}, 413)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=WEB_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _dir(job_id: str) -> Path:
    try:
        return jobs.job_dir(job_id)
    except KeyError:
        raise HTTPException(404, "Job not found") from None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/jobs", status_code=201)
async def create_job(file: UploadFile):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type. Use one of: {', '.join(sorted(ALLOWED_EXT))}")

    job_id, d = jobs.create()
    try:
        size, digest = 0, hashlib.sha256()
        with (d / f"video{ext}").open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, f"Video is larger than {MAX_BYTES // 1024**3} GB")
                digest.update(chunk)
                await run_in_threadpool(out.write, chunk)
        try:
            duration, _ = await run_in_threadpool(probe, d / f"video{ext}")
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        if duration > MAX_DURATION_S:
            raise HTTPException(400, f"Video is {duration / 3600:.1f} h; the limit is {MAX_DURATION_S // 3600} hours")
        key = f"{PIPELINE_VERSION}:sha256:{digest.hexdigest()}"
        done = jobs.reuse_done(key)
        if done:  # same file analysed before: reuse it (the UI says so)
            shutil.rmtree(d, ignore_errors=True)
            return {"id": done, "reused": True}
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise
    jobs.write_status(d, cache_key=key)
    jobs.tracer(d)("source_ready", origin="upload", size_mb=round(size / 2**20, 1), duration=round(duration, 2))
    jobs.enqueue(job_id)
    return {"id": job_id, "reused": False}


class LinkJob(BaseModel):
    url: str
    rights_confirmed: bool = False


@app.post("/jobs/from-url", status_code=201)
def create_link_job(body: LinkJob):
    if not body.rights_confirmed:
        raise HTTPException(400, "Confirm you own this video or it is openly licensed")
    started = time.monotonic()
    try:
        info = fetch.check_url(body.url)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    key = f"{PIPELINE_VERSION}:{fetch.cache_key(info)}"
    done = jobs.reuse_done(key)
    if done:
        return {"id": done, "title": info.get("title"), "reused": True}
    job_id, d = jobs.create(source_url=info.get("webpage_url", body.url), source_title=info.get("title"), cache_key=key)
    plan = fetch.stream_plan(info)
    if plan:
        # Separate from job.json, which the browser reads: signed stream URLs stay server-side.
        (d / "stream.json").write_text(json.dumps(plan))
    jobs.tracer(d)("source_ready", origin="link", site=info.get("extractor_key"), title=info.get("title"),
                   duration=info.get("duration"), seconds=round(time.monotonic() - started, 2),
                   streaming=bool(plan), subtitles=bool(plan and plan["captions"]),
                   thumbnail=info.get("thumbnail"), channel=info.get("channel") or info.get("uploader"))
    jobs.enqueue(job_id)
    return {"id": job_id, "title": info.get("title"), "reused": False}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    _dir(job_id)
    return jobs.read_status(job_id)


@app.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request):
    """Server-sent events until the job ends: the job status whenever it changes (default event), and each new line
    of the job's trace as a `trace` event (every step, from extracted text to the model race). The page listens
    instead of polling, so each step shows up within a quarter second.
    Each trace event's id is its end offset in trace.jsonl; a reconnecting browser sends it back as Last-Event-ID,
    so the stream resumes there instead of replaying every step."""
    d = _dir(job_id)
    resume = request.headers.get("last-event-id", "")

    async def stream():
        last = object()  # not None: the sample's job.json has no updated_at
        offset = int(resume) if resume.isdigit() else 0
        while True:
            try:
                status = jobs.read_status(job_id)  # one small file read
            except (KeyError, OSError):
                return  # deleted
            trace = d / "trace.jsonl"
            if trace.exists():
                with trace.open("rb") as f:
                    f.seek(offset)
                    chunk = f.read()
                complete = chunk[: chunk.rfind(b"\n") + 1]  # a line still being written waits for the next tick
                for line in complete.splitlines(keepends=True):
                    offset += len(line)
                    yield f"id: {offset}\nevent: trace\ndata: {line.decode().rstrip()}\n\n"
            if status.get("updated_at") != last:
                last = status.get("updated_at")
                yield f"data: {json.dumps({**status, 'server_time': time.time()})}\n\n"
            if status.get("status") in (jobs.DONE, jobs.FAILED):
                return
            await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: str):
    _dir(job_id)
    try:
        jobs.delete(job_id)
    except PermissionError as e:
        raise HTTPException(403, str(e)) from None


@app.get("/jobs/{job_id}/result", response_model=LearnResult)
def get_result(job_id: str):
    path = _dir(job_id) / "result.json"
    if not path.exists():
        raise HTTPException(404, "Result not ready")
    # Parsed rather than streamed so results saved by older versions gain the newer fields' defaults.
    return LearnResult.model_validate_json(path.read_text())


@app.get("/jobs/{job_id}/video")
def get_video(job_id: str):
    # FileResponse honours Range requests, which the browser player needs to seek.
    video = next(_dir(job_id).glob("video.*"), None)
    if video is None:
        raise HTTPException(404, "Video not found")
    return FileResponse(video)


FRAME_NAME = re.compile(r"(\d+(_fig)?|at\d+)\.jpg|ch\d+\.webp|card\.webp")


@app.get("/jobs/{job_id}/frames/{name}")
def get_frame(job_id: str, name: str):
    # Only names the pipeline writes: keyframes (3.jpg), diagram crops (3_fig.jpg), frames grabbed at a cited
    # second (at400.jpg), chapter illustrations (ch2.webp) and the card. Nothing else, so no path tricks.
    path = _dir(job_id) / "frames" / name
    if not FRAME_NAME.fullmatch(name) or not path.exists():
        raise HTTPException(404, "Frame not found")
    return FileResponse(path, media_type="image/webp" if name.endswith(".webp") else "image/jpeg")


