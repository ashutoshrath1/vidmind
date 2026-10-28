"""Timestamped speech: subtitles when the video has them, else Muse Voice Transcribe (keyed) or local ASR."""

import html
import io
import json
import logging
import os
import re
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import httpx
import numpy as np

from .schema import Segment

log = logging.getLogger(__name__)
MUSE_ASR_URL = "https://api.meta.ai/v1/asr/transcribe"
MUSE_ASR_MODEL = "muse-voice-transcribe-1.0"
SAMPLE_RATE = 16000  # mono float32 in [-1, 1]; what faster-whisper expects and Muse accepts as 16-bit WAV
_local = threading.Lock()  # one local ASR run at a time: jobs run in parallel, the model and the CPU/GPU are shared


def transcribe(audio: np.ndarray) -> tuple[list[Segment], str]:
    """Timestamps are relative to the start of `audio`. Returns (segments, transcriber name).
    Order: Muse (if keyed) → Parakeet (if ASR_ENGINE=parakeet) → local faster-whisper, each falling through on error."""
    # Muse is ~8 s per audio minute; pipeline.run sends sections in parallel (5 x 60 s: 10 s).
    if os.environ.get("MODEL_API_KEY"):
        try:
            return muse_asr_chunked(audio), MUSE_ASR_MODEL
        except Exception:
            log.exception("Muse transcription failed; falling back to local ASR")
    with _local:
        if os.environ.get("ASR_ENGINE") == "parakeet":
            try:
                return parakeet_local(audio), _parakeet_repo()
            except Exception:
                log.exception("Parakeet transcription failed; falling back to faster-whisper")
        size = os.environ.get("WHISPER_MODEL", "base")
        return whisper_local(audio, size), f"faster-whisper-{size}"


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


CHUNK_S = 6.0  # Muse times whole turns only (a lone speaker was one 34 s turn); 6 s pieces: finer and fastest (3.4 s vs 4.0 s at 12 s, 4.9 s at 4 s)


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


def muse_asr_chunked(audio: np.ndarray) -> list[Segment]:
    """Muse on ~CHUNK_S pieces cut at quiet moments, in parallel: timestamps within a few seconds, and faster
    (Muse takes ~8 s per audio minute per request)."""
    end = len(audio) / SAMPLE_RATE
    cuts = [quietest(audio, t, 2.0) for t in np.arange(CHUNK_S, end - CHUNK_S / 2, CHUNK_S)]
    bounds = [0.0, *cuts, end]
    pieces = [(a, audio[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)]) for a, b in zip(bounds, bounds[1:])]
    # Every piece at once (Muse allows 256 streams): a 5-minute video is ~50 pieces, done in about one piece's time.
    with ThreadPoolExecutor(max_workers=min(64, len(pieces))) as ex:
        found = ex.map(lambda p: [Segment(round(s.start + p[0], 2), round(s.end + p[0], 2), s.text)
                                  for s in muse_asr(p[1])], pieces)
    return [s for part in found for s in part]


def muse_asr(audio: np.ndarray) -> list[Segment]:
    # Muse caps: 10 min, 32 MB, mono 16-bit PCM WAV at 16/24 kHz; 10 min at 16 kHz is ~19 MB.
    # Hinglish: a bias, not a lock; the model code-switches and still detects other languages.
    # DIARIZATION also cuts a turn at each speaker change: on a 4-speaker meeting 7 turns vs ENDPOINTING's 2 (one
    # 22 s turn put every quote at its start); lectures get the same turns. Same speed and price.
    request = {"mode": "DIARIZATION", "model": MUSE_ASR_MODEL, "audioEncoding": "WAV",
               "languageBias": ["English", "Hindi"]}
    headers = {"Authorization": f"Bearer {os.environ['MODEL_API_KEY']}"}
    body = _wav_bytes(audio)
    for attempt in range(4):
        resp = httpx.post(
            MUSE_ASR_URL,
            headers=headers,
            files={
                "request": (None, json.dumps(request), "application/json"),
                "audio": ("audio.wav", body, "audio/wav"),
            },
            timeout=300,
        )
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
