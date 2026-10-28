"""File-backed job store: a queue served by a few worker threads, one folder per job."""

import json
import logging
import os
import queue
import re
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path

from . import fetch, pipeline

log = logging.getLogger(__name__)
DATA_DIR = Path(os.environ.get("VIDMIND_DATA", Path(__file__).parents[2] / "data")) / "jobs"
SAMPLE_DIR = Path(__file__).parents[3] / "samples"
SAMPLE_ID = "sample"
RETENTION_S = 24 * 3600
KEEP_MAX_DAYS = 30  # a kept job still goes this long after it was created, however often it is kept again
DONE, FAILED = "done", "failed"
# Jobs run in parallel: most of a job is waiting on hosted models. Local ASR is serialised in transcribe.py.
WORKERS = int(os.environ.get("VIDMIND_WORKERS", "3"))

_queue: queue.Queue[str] = queue.Queue()
_status_lock = threading.Lock()  # section threads, the pipeline and workers all update job.json
_trace_lock = threading.Lock()


def job_dir(job_id: str) -> Path:
    """Raises KeyError for unknown or malformed ids (the regex also blocks path traversal)."""
    if job_id == SAMPLE_ID:
        return SAMPLE_DIR
    d = DATA_DIR / job_id
    if not re.fullmatch(r"[0-9a-f]{32}", job_id) or not d.is_dir():
        raise KeyError(job_id)
    return d


def read_status(job_id: str) -> dict:
    return json.loads((job_dir(job_id) / "job.json").read_text())


def write_status(d: Path, **fields) -> None:
    path = d / "job.json"
    with _status_lock:  # read-modify-write: without it, concurrent updates lose each other's fields
        status = json.loads(path.read_text()) if path.exists() else {}
        status.update(fields, updated_at=time.time())
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(status))
        tmp.replace(path)  # atomic, so readers never see half a file


def tracer(d: Path) -> Callable[..., None]:
    """emit(kind, **data) appends one JSON line to the job's trace.jsonl, timed from job creation. The page streams
    these lines live, so the viewer sees each step: extracted text, keyframes, which models raced, what was checked."""
    created = json.loads((d / "job.json").read_text())["created_at"]

    def emit(kind: str, **data) -> None:
        line = json.dumps({"t": round(time.time() - created, 2), "kind": kind, **data})
        with _trace_lock, (d / "trace.jsonl").open("a") as f:
            f.write(line + "\n")

    return emit


def create(**fields) -> tuple[str, Path]:
    job_id = uuid.uuid4().hex
    d = DATA_DIR / job_id
    d.mkdir(parents=True)
    write_status(d, id=job_id, status="uploading", error=None, created_at=time.time(), **fields)
    return job_id, d


def reuse_done(cache_key: str, mode: str | None = None) -> str | None:
    """A finished job for the same video and pipeline version, so it is not processed twice. Marks it shared:
    whoever submitted the same video now has its id too, so nobody may delete it for everyone else.
    shortcut: scans job folders (24 h retention keeps them few); keep an index if jobs grow to thousands."""
    if not DATA_DIR.exists():
        return None
    for d in DATA_DIR.iterdir():
        try:
            status = json.loads((d / "job.json").read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if status.get("cache_key") == cache_key and status.get("status") == DONE:
            if mode and _result_mode(d) != mode:
                continue
            write_status(d, shared=True)
            return status["id"]
    return None


def _result_mode(d: Path) -> str | None:
    try:
        return json.loads((d / "result.json").read_text()).get("mode")
    except (OSError, json.JSONDecodeError):
        return None


def delete(job_id: str) -> None:
    if job_id == SAMPLE_ID:
        raise PermissionError("The sample cannot be deleted")
    if read_status(job_id).get("shared"):
        raise PermissionError("Others opened this same video, so it stays until it expires after 24 hours")
    shutil.rmtree(job_dir(job_id))


def keep(job_id: str, days: int | None) -> float | None:
    """Keep the job `days` from now (None: back to the default 24 hours). Returns keep_until."""
    status = read_status(job_id)
    until = min(time.time() + days * 86400, status["created_at"] + KEEP_MAX_DAYS * 86400) if days else None
    write_status(job_dir(job_id), keep_until=until)
    return until


def enqueue(job_id: str) -> None:
    write_status(job_dir(job_id), status="queued")
    _queue.put(job_id)


def _work() -> None:
    while True:
        job_id = _queue.get()
        d = job_dir(job_id)
        emit = tracer(d)
        try:
            src = None
            started = time.monotonic()
            if (d / "stream.json").exists():
                emit("stage", name="fetch", state="start", detail="Opening YouTube streams and subtitles")
                src = fetch.stream_source(json.loads((d / "stream.json").read_text()))
                emit("stage", name="fetch", state="end", seconds=round(time.monotonic() - started, 2))
            elif url := read_status(job_id).get("source_url"):
                write_status(d, status="downloading")
                emit("stage", name="fetch", state="start", detail="Downloading the video (up to 720p)")
                fetch.download(url, d)
                emit("stage", name="fetch", state="end", seconds=round(time.monotonic() - started, 2))
            update = lambda step=None, **kw: write_status(d, **({"status": step} if step else {}), **kw)  # noqa: E731
            pipeline.run(d, update, src, emit, read_status(job_id).get("mode"))
            emit("done")  # before the status: the event stream closes as soon as it reads "done"
            write_status(d, status=DONE)
        except Exception as e:
            log.exception("job %s failed", job_id)
            emit("failed", error=f"{type(e).__name__}: {e}")
            write_status(d, status=FAILED, error=f"{type(e).__name__}: {e}")


def start_workers() -> None:
    for i in range(WORKERS):
        threading.Thread(target=_work, name=f"vidmind-worker-{i}", daemon=True).start()


def start_cleanup() -> None:
    """Retention while the server runs, not only at restart: the page promises deletion after 24 hours."""

    def loop() -> None:
        while True:
            time.sleep(3600)
            try:
                sweep(restart=False)
            except Exception:
                log.exception("cleanup failed")

    threading.Thread(target=loop, name="vidmind-cleanup", daemon=True).start()


def sweep(restart: bool = True) -> None:
    """Delete jobs past retention. On startup (restart=True), also fail jobs a previous server run left unfinished;
    never while running, since those jobs are in progress."""
    if not DATA_DIR.exists():
        return
    now = time.time()
    for d in DATA_DIR.iterdir():
        try:
            status = json.loads((d / "job.json").read_text())
        except (OSError, json.JSONDecodeError):
            shutil.rmtree(d, ignore_errors=True)
            continue
        if now > max(status.get("created_at", 0) + RETENTION_S, status.get("keep_until") or 0):
            shutil.rmtree(d, ignore_errors=True)
        elif restart and status.get("status") not in (DONE, FAILED):
            write_status(d, status=FAILED, error="Server restarted before this job finished")
