import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).parents[2]


@pytest.fixture(scope="session")
def fixture_clip(tmp_path_factory) -> tuple[Path, dict]:
    """The synthetic 60 s clip from scripts/make_fixture.py and its annotations."""
    if not shutil.which("say"):
        pytest.skip("fixture generation needs macOS `say`")
    out = tmp_path_factory.mktemp("fixture")
    subprocess.run([sys.executable, str(REPO / "scripts" / "make_fixture.py"), str(out)], check=True)
    return out / "fixture.mp4", json.loads((out / "fixture.annotations.json").read_text())


@pytest.fixture(autouse=True)
def fake_llm_key(monkeypatch):
    """Model calls are stubbed in tests; a key just lets bare model ids into the pool."""
    monkeypatch.setenv("LLM_API_KEY", "test")
