#!/usr/bin/env bash
# Copy a finished job into samples/ as the labelled, precomputed fallback result.
set -euo pipefail
job="${1:?usage: scripts/make_sample.sh <job-id>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/api/data/jobs/$job"
dst="$root/samples"
[[ -f "$src/result.json" ]] || { echo "no finished job at $src" >&2; exit 1; }

rm -rf "$dst" && mkdir -p "$dst"
cp -R "$src/frames" "$dst/frames"
cp "$src"/video.* "$dst/" 2>/dev/null || true  # YouTube jobs have no file: they play from YouTube
# "Ask the video" answers from these.
cp "$src/transcript.json" "$src/frames.json" "$dst/"
# The step-by-step record behind "Behind the scenes".
cp "$src/trace.jsonl" "$dst/" 2>/dev/null || true
python3 - "$src/result.json" "$dst" <<'EOF'
import json, sys, time
result = json.load(open(sys.argv[1]))
result["source"] = "precomputed"
json.dump(result, open(f"{sys.argv[2]}/result.json", "w"), indent=2)
json.dump({"id": "sample", "status": "done", "error": None, "created_at": time.time()}, open(f"{sys.argv[2]}/job.json", "w"))
EOF
echo "sample written to $dst"
