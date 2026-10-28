"""Score a VidMind result against hand annotations.

Usage: python scripts/eval.py RESULT.json ANNOTATIONS.json [--tolerance 5]

Annotations: {"facts": [{"id", "keywords": [...], "source": "both"|"frame"|"transcript",
                         "start_seconds", "end_seconds"}]}
A fact is covered when some note contains all its keywords (case-insensitive). A citation is on time
when an evidence timestamp of that note falls within [start - tol, end + tol].
"""

import argparse
import json
from pathlib import Path


def evaluate(result: dict, facts: list[dict], tol: float) -> dict:
    notes = [n for c in result["chapters"] for n in c["notes"]]
    covered, on_time, visual = [], [], []
    for f in facts:
        matches = [n for n in notes if all(k.lower() in n["text"].lower() for k in f["keywords"])]
        evidence = [e for n in matches for e in n["evidence"]]
        hit = bool(matches)
        timely = any(f["start_seconds"] - tol <= e["start_seconds"] <= f["end_seconds"] + tol for e in evidence)
        covered.append(hit)
        on_time.append(timely)
        if f["source"] == "frame":
            visual.append(any(e["kind"] == "frame" for e in evidence))
        print(f"  {f['id']:<20} covered={hit!s:<5} on_time={timely!s:<5} kinds={sorted({e['kind'] for e in evidence})}")

    share = lambda xs: round(sum(xs) / len(xs), 3) if xs else None  # noqa: E731
    return {
        "notes": len(notes),
        "notes_with_evidence": share([bool(n["evidence"]) for n in notes]),
        "fact_coverage": share(covered),
        "timestamp_accuracy": share(on_time),
        "visual_only_facts_with_frame_evidence": share(visual),
        "quiz_items": len(result["quiz"]),
        "dropped_notes": result.get("dropped_notes", 0),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("result", type=Path)
    ap.add_argument("annotations", type=Path)
    ap.add_argument("--tolerance", type=float, default=5.0)
    args = ap.parse_args()
    result = json.loads(args.result.read_text())
    facts = json.loads(args.annotations.read_text())["facts"]
    print(json.dumps(evaluate(result, facts, args.tolerance), indent=2))


if __name__ == "__main__":
    main()
