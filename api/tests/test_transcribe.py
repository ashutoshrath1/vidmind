import platform
import sys

import pytest

from vidmind.pipeline import load_audio
from vidmind.transcribe import parakeet_local, transcribe


@pytest.mark.skipif(sys.platform != "darwin" or platform.machine() != "arm64", reason="Parakeet runs on Apple Silicon")
def test_parakeet_sentence_timestamps_on_fixture(fixture_clip, monkeypatch):
    video, _ = fixture_clip
    audio = load_audio(video)
    segs = parakeet_local(audio)
    activation = next(s for s in segs if "first project" in s.text.lower())
    assert 3 <= activation.start <= 9  # spoken at ~3.9-8.2 s in the fixture
    monkeypatch.setenv("ASR_ENGINE", "parakeet")
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    assert transcribe(audio[: 10 * 16000])[1].endswith("parakeet-tdt-0.6b-v2")


def test_muse_chunks_cut_at_quiet_moments_and_keep_times(monkeypatch):
    import numpy as np

    from vidmind import transcribe as tr

    audio = np.full(30 * 16000, 0.5, np.float32)
    audio[int(11.0 * 16000) : int(11.4 * 16000)] = 0  # a pause near the 12 s cut
    seen = []
    monkeypatch.setattr(tr, "CHUNK_S", 12.0)  # the cut rule, at a size the numbers below were worked out for
    monkeypatch.setattr(tr, "muse_asr", lambda a: seen.append(len(a) / 16000) or [tr.Segment(0.5, 1.0, "hi")])
    segs = tr.muse_asr_chunked(audio)
    assert [round(s, 1) for s in sorted(seen)] == [11.1, 18.9]  # cut in the pause; the last piece may run to 1.5x
    assert [s.start for s in segs] == [0.5, 11.55]  # each piece's times shifted to the video's clock


def test_muse_resends_a_slow_piece_and_takes_the_first_good_reply(monkeypatch):
    import threading
    import time

    import numpy as np

    from vidmind import transcribe as tr

    audio = np.full(24 * 16000, 0.5, np.float32)
    calls: dict[int, int] = {}
    lock = threading.Lock()

    def asr(a):
        key = len(a)
        with lock:
            calls[key] = calls.get(key, 0) + 1
            n = calls[key]
        if key == 12 * 16000 and n == 1:  # the second piece's first copy hangs
            time.sleep(2)
            return [tr.Segment(0.0, 1.0, "late")]
        if key == 12 * 16000 and n == 2:
            return [tr.Segment(0.2, 1.0, "resent")]
        return [tr.Segment(0.5, 1.0, "hi")]

    monkeypatch.setattr(tr, "CHUNK_S", 12.0)
    monkeypatch.setattr(tr, "HEDGE_S", 0.2)
    monkeypatch.setattr(tr, "quietest", lambda a, t, span: t)
    monkeypatch.setattr(tr, "muse_asr", asr)
    started = time.monotonic()
    segs = tr.muse_asr_chunked(audio)
    assert time.monotonic() - started < 1.5  # didn't wait for the hung copy
    assert [(s.start, s.text) for s in segs] == [(0.5, "hi"), (12.2, "resent")]


def test_muse_falls_back_to_the_other_copy_when_one_fails(monkeypatch):
    import numpy as np

    from vidmind import transcribe as tr

    calls = []

    def asr(a):
        calls.append(1)
        if len(calls) == 1:
            import time
            time.sleep(0.3)
            raise RuntimeError("500 from Muse")
        return [tr.Segment(0.1, 1.0, "ok")]

    monkeypatch.setattr(tr, "HEDGE_S", 0.1)
    monkeypatch.setattr(tr, "muse_asr", asr)
    assert [s.text for s in tr.muse_asr_chunked(np.full(5 * 16000, 0.5, np.float32))] == ["ok"]
