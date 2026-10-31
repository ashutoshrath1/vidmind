#!/usr/bin/env bash
# Removes VidMind from macOS or Linux: the app folder (with its notes and settings) and the `vidmind` command.
#   curl -fsSL https://raw.githubusercontent.com/ashutoshrath1/vidmind/main/uninstall.sh | bash
# Shared tools (git, ffmpeg, Node, uv, Ollama) stay: other apps may use them. An Ollama model VidMind pulled is
# removed only if you say yes.
set -euo pipefail
DIR="${VIDMIND_DIR:-$HOME/vidmind}"
OLLAMA_MODEL="${VIDMIND_OLLAMA_MODEL:-qwen2.5:3b}"

pkill -f "vidmind.main:app" 2>/dev/null || true
rm -f "$HOME/.local/bin/vidmind"
if [ -d "$DIR" ]; then rm -rf "$DIR"; echo "✓ Removed $DIR"; else echo "Nothing at $DIR"; fi
if command -v ollama >/dev/null 2>&1 && ollama list 2>/dev/null | grep -q "^$OLLAMA_MODEL"; then
  read -r -p "Also delete the Ollama model $OLLAMA_MODEL (1.9 GB)? [y/N] " a </dev/tty
  [[ "$a" =~ ^[Yy] ]] && ollama rm "$OLLAMA_MODEL" && echo "✓ Deleted $OLLAMA_MODEL"
fi
echo "✓ VidMind uninstalled."
