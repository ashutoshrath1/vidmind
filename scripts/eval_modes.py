"""The submission's three evaluation numbers, measured end to end through a running API.

Usage: uv run --project api --env-file .env python scripts/eval_modes.py [--api http://localhost:8000]
Needs scripts/fixtures (make_mode_fixtures.py) and `npm install` in scripts/eval_demo. Costs ~$0.10 of Muse credit.

- Action-item F1: the Meet result for fixtures/meeting.mp4 against meeting.answers.json.
- Test pass rate: the Playwright tests generated from fixtures/demo.mp4, run against the app it was recorded from.
- Minutes saved per hour: video length minus the time to read the result, at READ_WPM, scaled to one hour.
Also prints the Hinglish transcript of fixtures/hinglish.wav (Muse Voice Transcribe).
"""

import argparse
import json
import subprocess
import time
import wave
from pathlib import Path

import httpx
import numpy as np
from vidmind.transcribe import muse_asr

HERE = Path(__file__).parent
FIX = HERE / "fixtures"
READ_WPM = 200  # an adult's typical reading speed; shortcut: not measured on our users


def process(api: str, video: Path) -> dict:
    with video.open("rb") as f:
        job = httpx.post(f"{api}/jobs", files={"file": (video.name, f, "video/mp4")}, timeout=120).raise_for_status().json()
    while (s := httpx.get(f"{api}/jobs/{job['id']}").json())["status"] not in ("done", "failed"):
        time.sleep(0.5)
    if s["status"] == "failed":
        raise RuntimeError(f"{video.name}: {s.get('error')}")
    return httpx.get(f"{api}/jobs/{job['id']}/result").json()


def f1(predicted: list[dict], answers: list[dict]) -> dict:
    """Each answer matches at most one predicted item of the same kind containing all its keywords."""
    used, hits = set(), 0
    for a in answers:
        for i, p in enumerate(predicted):
            hay = " ".join(str(p.get(k) or "") for k in ("text", "owner", "deadline")).lower()
            if i not in used and p["kind"] == a["kind"] and all(k in hay for k in a["keywords"]):
                used.add(i)
                hits += 1
                break
    precision, recall = hits / max(1, len(predicted)), hits / max(1, len(answers))
    return {"f1": round(2 * precision * recall / max(1e-9, precision + recall), 3), "precision": round(precision, 3),
            "recall": round(recall, 3), "matched": hits, "predicted": len(predicted), "expected": len(answers)}


def pass_rate(scenarios: list[dict]) -> dict:
    out = HERE / "eval_demo" / "generated"
    out.mkdir(exist_ok=True)
    for old in out.glob("*.spec.ts"):
        old.unlink()
    for i, sc in enumerate(scenarios):
        (out / f"s{i}.spec.ts").write_text(sc["playwright"])
    subprocess.run(["npx", "playwright", "test"], cwd=HERE / "eval_demo", capture_output=True)
    report = json.loads((HERE / "eval_demo" / "results.json").read_text())
    tests = [t for s in report["suites"] for spec in _specs(s) for t in spec["tests"]]
    passed = sum(t["status"] == "expected" for t in tests)
    return {"pass_rate": round(passed / max(1, len(tests)), 3), "passed": passed, "tests": len(tests),
            "errors": report.get("errors", [])[:3]}


def _specs(suite: dict) -> list[dict]:
    return suite.get("specs", []) + [s for child in suite.get("suites", []) for s in _specs(child)]


def minutes_saved(result: dict) -> float:
    words = sum(len(n["text"].split()) for c in result["chapters"] for n in c["notes"])
    words += len(result.get("tldr", "").split()) + sum(len(a["text"].split()) for a in result.get("actions", []))
    words += sum(len(s["text"].split()) for sc in result.get("scenarios", []) for s in sc["steps"])
    read_s = words / READ_WPM * 60
    return round(max(0.0, result["duration_seconds"] - read_s) / result["duration_seconds"] * 60, 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    api = ap.parse_args().api

    meet = process(api, FIX / "meeting.mp4")
    demo = process(api, FIX / "demo.mp4")
    report = {
        "meeting": {"mode": meet["mode"], **f1(meet["actions"], json.loads((FIX / "meeting.answers.json").read_text())),
                    "minutes_saved_per_hour": minutes_saved(meet)},
        "demo": {"mode": demo["mode"], "scenarios": len(demo["scenarios"]), **pass_rate(demo["scenarios"]),
                 "minutes_saved_per_hour": minutes_saved(demo)},
    }
    with wave.open(str(FIX / "hinglish.wav")) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    report["hinglish_transcript"] = " ".join(s.text for s in muse_asr(audio))
    print(json.dumps(report, indent=2))
