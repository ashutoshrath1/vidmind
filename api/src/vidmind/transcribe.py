"""Timestamped speech: subtitles when the video has them, else the SPEECH_MODEL (if its provider is keyed) or local ASR."""

import html
import io
import json
import logging
import os
import re
import subprocess
import threading
import time
import wave
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from functools import lru_cache

import httpx
import numpy as np

from . import models as mdl
from .schema import Segment

log = logging.getLogger(__name__)
SAMPLE_RATE = 16000  # mono float32 in [-1, 1]; what faster-whisper expects and Muse accepts as 16-bit WAV
_local = threading.Lock()  # one local ASR run at a time: jobs run in parallel, the model and the CPU/GPU are shared


def transcribe(audio: np.ndarray, queued: threading.Event | None = None) -> tuple[list[Segment], str]:
    """Timestamps are relative to the start of `audio`. Returns (segments, transcriber name).
    Order: SPEECH_MODEL (if its provider is keyed) → Parakeet (if ASR_ENGINE=parakeet) → local faster-whisper,
    each falling through on error."""
    model = hosted_speech()
    if model:
        try:
            if mdl.of(model).kind == "muse":
                return muse_asr_fast(audio, queued=queued), model
            return openai_asr(audio, model), model
        except Exception:
            log.exception("%s transcription failed; falling back to local ASR", model)
    with _local:
        if os.environ.get("ASR_ENGINE") == "parakeet":
            try:
                return parakeet_local(audio), _parakeet_repo()
            except Exception:
                log.exception("Parakeet transcription failed; falling back to faster-whisper")
        size = os.environ.get("WHISPER_MODEL", "base")
        return whisper_local(audio, size), f"faster-whisper-{size}"


def hosted_speech() -> str:
    """The configured speech model when its provider is keyed, else "" (local ASR)."""
    model = mdl.role("speech")
    return model if mdl.available(model) else ""


_TIME = re.compile(r"(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)")


def _secs(stamp: str) -> float:
    h, m, s = _TIME.match(stamp.strip()).groups()
    return int(h or 0) * 3600 + int(m) * 60 + float(s)


def parse_vtt(text: str) -> list[Segment]:
    """WebVTT subtitles (YouTube creator captions, or a track embedded in an upload) → segments."""
    out: list[Segment] = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "")):
        lines = block.strip().split("\n")
        i = next((k for k, line in enumerate(lines) if "-->" in line), None)
        if i is None:  # header, NOTE or STYLE block
            continue
        start, end = (_secs(part.split()[0]) for part in lines[i].split("-->")[:2])  # end may carry cue settings
        words = html.unescape(re.sub(r"<[^>]+>", "", " ".join(lines[i + 1 :]))).split()
        if words and not (out and out[-1].text == " ".join(words)):  # some tracks repeat a cue across splits
            out.append(Segment(round(start, 2), round(end, 2), " ".join(words)))
    return out


def parse_json3(data: dict) -> list[Segment]:
    """YouTube's json3 captions: one segment per caption line, timed by its first word, ending where the next starts.
    Unlike the VTT form of auto-captions, lines are not repeated as they roll."""
    lines = [(e["tStartMs"] / 1000, (e["tStartMs"] + e.get("dDurationMs", 0)) / 1000,
              " ".join("".join(x.get("utf8", "") for x in e["segs"]).split()))
             for e in data.get("events", []) if e.get("segs")]
    lines = [x for x in lines if x[2]]
    return [Segment(round(a, 2), round(min(b, lines[k + 1][0]) if k + 1 < len(lines) else b, 2), text)
            for k, (a, b, text) in enumerate(lines)]


def _parakeet_repo() -> str:
    return os.environ.get("PARAKEET_MODEL", "mlx-community/parakeet-tdt-0.6b-v2")


@lru_cache(maxsize=1)
def _parakeet(repo: str):
    from parakeet_mlx import from_pretrained

    return from_pretrained(repo)


def parakeet_local(audio: np.ndarray) -> list[Segment]:
    # English-only, Apple Silicon (MLX). On 105 s of lecture audio on an M2 Air: 3.1 s vs 4.1 s for
    # faster-whisper base, with better punctuation and spelling. Same steps as Parakeet's transcribe(),
    # minus its file loading, since our audio is already 16 kHz mono in memory.
    import mlx.core as mx
    from parakeet_mlx.audio import get_logmel

    model = _parakeet(_parakeet_repo())
    # float32, as Parakeet's own loader returns: get_logmel reinterprets the complex FFT in the input dtype.
    mel = get_logmel(mx.array(audio, dtype=mx.float32), model.preprocessor_config)
    result = model.generate(mel)[0]
    return [Segment(round(s.start, 2), round(s.end, 2), s.text.strip()) for s in result.sentences]


def _wav_bytes(audio: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


MAX_STREAMS = mdl.setting("ASR_MAX_STREAMS", 256)  # Muse ASR concurrent streams
HEDGE_S = mdl.setting("ASR_HEDGE_S", 4.0)  # re-send only real stragglers: at full load (198 pieces) p50 is 2.4 s, max 4.0 s; Muse is throughput-
# bound, so re-sending at 2.6 s doubled the work and took the transcript from ~4 s to 10.3 s
CHUNK_S = mdl.setting("ASR_CHUNK_S", 3.0)  # Muse times whole turns only, so short pieces also time quotes finely. On warm connections, 10 minutes
# of speech took 2.71 s as 3 s pieces vs 2.88 s at 4 s, 3.55 s at 2 s and 4.10 s at 6 s (Oct 29).


def quietest(audio: np.ndarray, t: float, span_s: float, window_s: float = 0.1) -> float:
    """The quietest moment within span_s of t, so a cut there does not split a word."""
    lo = max(0, int((t - span_s) * SAMPLE_RATE))
    span = audio[lo : int((t + span_s) * SAMPLE_RATE)]
    w = int(window_s * SAMPLE_RATE)
    n = len(span) // w
    if n == 0:
        return t
    energy = np.square(span[: n * w].reshape(n, w)).mean(axis=1)
    return lo / SAMPLE_RATE + (int(energy.argmin()) + 0.5) * window_s


ASR_SPEED = mdl.setting("ASR_SPEED", 2.0)  # Muse is throughput-bound: 10 minutes at 2x took 3.14 s vs 5.77 s, word error 4.9% vs 5.1%


def faster(audio: np.ndarray, speed: float = ASR_SPEED) -> np.ndarray:
    """The audio played `speed` times faster with its pitch kept (ffmpeg atempo), for less audio to transcribe."""
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "1",
                          "-i", "-", "-af", f"atempo={speed}", "-f", "f32le", "-"],
                         input=audio.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def muse_asr_fast(audio: np.ndarray, speed: float = ASR_SPEED, queued: threading.Event | None = None) -> list[Segment]:
    """Muse on the sped-up audio, with times scaled back to the original's clock."""
    return [Segment(round(s.start * speed, 2), round(s.end * speed, 2), s.text)
            for s in muse_asr_chunked(faster(audio, speed), queued)]


def muse_asr_chunked(audio: np.ndarray, queued: threading.Event | None = None) -> list[Segment]:
    """Muse on ~CHUNK_S pieces cut at quiet moments, in parallel: timestamps within a few seconds, and faster
    (Muse takes ~8 s per audio minute per request)."""
    end = len(audio) / SAMPLE_RATE
    cuts = [quietest(audio, t, CHUNK_S / 3) for t in np.arange(CHUNK_S, end - CHUNK_S / 2, CHUNK_S)]
    bounds = [0.0, *cuts, end]
    pieces = [(a, audio[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)]) for a, b in zip(bounds, bounds[1:])]
    # All pieces of every section share one pool, in the order sections ask: the first section's pieces go first,
    # so its notes can start while later sections are still being heard. A piece still out after HEDGE_S is sent
    # again and the first reply wins.
    copies = [[_pool.submit(muse_asr, audio_piece)] for _, audio_piece in pieces]
    if queued:
        queued.set()  # this audio's pieces are in line; whoever waited on that may send theirs
    wait([c[0] for c in copies], timeout=HEDGE_S)
    for c, (_, audio_piece) in zip(copies, pieces):
        if not c[0].done():
            c.append(_pool.submit(muse_asr, audio_piece))
    found = [_first_answer(c) for c in copies]
    for c in copies:
        for f in c:
            f.cancel()  # a losing copy still queued never goes out
    return [Segment(round(s.start + at, 2), round(s.end + at, 2), s.text)
            for (at, _), part in zip(pieces, found) for s in part]


def _first_answer(copies: list) -> list[Segment]:
    """The first copy to succeed; raises only when every copy failed."""
    pending = list(copies)
    while True:
        done, _ = wait(pending, return_when=FIRST_COMPLETED)
        for f in done:
            if f.exception() is None:
                return f.result()
            pending.remove(f)
        if not pending:
            return copies[0].result()  # all failed: raise the first error


# One kept-alive pool for every ASR request: 99 pieces in 3.91 s on open connections, 4.74 s on a shared but cold
# pool, 5.85 s with a new connection per request. No pre-warming: run beside the real requests it fought them for
# connections (10-minute transcript ~10 s with it, 5.7 s without).
# One pool for every ASR request of every job: it keeps all of them under Muse's 256 concurrent streams.
_pool = ThreadPoolExecutor(max_workers=MAX_STREAMS - 16)
_http = httpx.Client(limits=httpx.Limits(max_connections=MAX_STREAMS, max_keepalive_connections=MAX_STREAMS), timeout=300)


def muse_asr(audio: np.ndarray) -> list[Segment]:
    # Muse caps: 10 min, 32 MB, mono 16-bit PCM WAV at 16/24 kHz; 10 min at 16 kHz is ~19 MB.
    # Hinglish: a bias, not a lock; the model code-switches and still detects other languages.
    # DIARIZATION also cuts a turn at each speaker change: on a 4-speaker meeting 7 turns vs ENDPOINTING's 2 (one
    # 22 s turn put every quote at its start); lectures get the same turns. Same speed and price.
    model = mdl.role("speech")
    prov = mdl.of(model)
    request = {"mode": "DIARIZATION", "model": mdl.bare(model), "audioEncoding": "WAV",
               "languageBias": ["English", "Hindi"]}
    headers = {"Authorization": f"Bearer {mdl.key(prov)}"}
    url = f"{prov.base_url}/asr/transcribe"
    body = _wav_bytes(audio)
    for attempt in range(4):
        resp = _http.post(
            url,
            headers=headers,
            files={
                "request": (None, json.dumps(request), "application/json"),
                "audio": ("audio.wav", body, "audio/wav"),
            },
        )
        if resp.status_code == 429:
            log.warning("Muse ASR 429 (attempt %d)", attempt + 1)
        if resp.status_code != 429 or attempt == 3:
            break
        time.sleep(2**attempt)
    resp.raise_for_status()
    body = resp.json()
    # Turn-level timestamps only; Muse has no word timestamps.
    segments = [Segment(t["startMs"] / 1000, t["endMs"] / 1000, t["transcript"]) for t in body.get("turns", [])]
    if not segments and body.get("transcript"):
        segments = [Segment(0, body.get("audioDurationMs", 0) / 1000, body["transcript"])]
    return segments


def openai_asr(audio: np.ndarray, model: str) -> list[Segment]:
    """Any OpenAI-compatible /audio/transcriptions endpoint (`openai:whisper-1`, Groq, a local server) that returns
    verbose_json segments. One request per call, at normal speed: the 2x and 3 s pieces are tuned for Muse."""
    prov = mdl.of(model)
    resp = _http.post(f"{prov.base_url}/audio/transcriptions", headers={"Authorization": f"Bearer {mdl.key(prov)}"},
                      data={"model": mdl.bare(model), "response_format": "verbose_json"},
                      files={"file": ("audio.wav", _wav_bytes(audio), "audio/wav")})
    resp.raise_for_status()
    body = resp.json()
    segments = [Segment(round(s["start"], 2), round(s["end"], 2), s["text"].strip()) for s in body.get("segments", [])
                if s["text"].strip()]
    return segments or ([Segment(0, round(len(audio) / SAMPLE_RATE, 2), body["text"].strip())] if body.get("text", "").strip() else [])


@lru_cache(maxsize=1)
def _whisper(size: str):
    from faster_whisper import WhisperModel

    return WhisperModel(size, device="cpu", compute_type="int8")


def whisper_local(audio: np.ndarray, size: str) -> list[Segment]:
    # An array, not a path: faster-whisper's own decoding goes through PyAV, which breaks on new av releases.
    # Greedy decoding: on 105 s of lecture audio, base+beam 1 took 3.9 s vs 19.1 s for small+beam 5, same words.
    segments, _ = _whisper(size).transcribe(audio, vad_filter=True, word_timestamps=True, beam_size=1)
    # Whisper segment bounds drift across silences; rebuild one segment per sentence from word timings.
    out, words = [], []
    for w in (w for s in segments for w in s.words):
        words.append(w)
        if w.word.rstrip().endswith((".", "?", "!")):
            out.append(Segment(round(float(words[0].start), 2), round(float(w.end), 2), "".join(x.word for x in words).strip()))
            words = []
    if words:
        out.append(Segment(round(float(words[0].start), 2), round(float(words[-1].end), 2), "".join(x.word for x in words).strip()))
    return out
