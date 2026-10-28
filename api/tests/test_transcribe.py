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
