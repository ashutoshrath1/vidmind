#!/usr/bin/env bash
# VidMind one-shot installer for macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/ashutoshrath1/vidmind/main/install.sh | bash
# Installs what is missing (git, ffmpeg, Node 20+, uv + Python 3.12), clones VidMind to ~/vidmind, asks which AI
# provider to use, writes .env, and adds a `vidmind` command. Re-run it any time to update or switch provider.
set -euo pipefail

DIR="${VIDMIND_DIR:-$HOME/vidmind}"
REPO="https://github.com/ashutoshrath1/vidmind.git"
BIN="$HOME/.local/bin"
OLLAMA_MODEL="${VIDMIND_OLLAMA_MODEL:-qwen2.5:3b}"

bold=$'\e[1m'; dim=$'\e[2m'; blue=$'\e[34m'; green=$'\e[32m'; red=$'\e[31m'; off=$'\e[0m'
say()  { printf '%s\n' "${blue}▸${off} $*"; }
ok()   { printf '%s\n' "${green}✓${off} $*"; }
die()  { printf '%s\n' "${red}✗ $*${off}" >&2; exit 1; }
ask()  { local a; read -r -p "$1" a </dev/tty; printf '%s' "$a"; }
secret() { local a; read -r -s -p "$1" a </dev/tty; echo >/dev/tty; printf '%s' "$a"; }
has()  { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"
printf '\n%s\n%s\n\n' "${bold}VidMind${off}  Any video. Notes with proof." "${dim}Installing to $DIR${off}"

# --- 1. Tools -----------------------------------------------------------------------------------------------------
install_pkgs() {  # $@: packages, by the system's own package manager
  if [ "$OS" = Darwin ]; then
    has brew || { say "Installing Homebrew"; NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; }
    brew install "$@"
  elif has apt-get; then sudo apt-get update -qq && sudo apt-get install -y -qq "$@"
  elif has dnf; then sudo dnf install -y -q "$@"
  elif has pacman; then sudo pacman -Sy --noconfirm "$@"
  else die "Install $* yourself, then run this again."; fi
}
has git || { say "Installing git"; install_pkgs git; }
has ffmpeg || { say "Installing ffmpeg"; install_pkgs ffmpeg; }
node_ok() { has node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
if ! node_ok; then
  say "Installing Node.js 22"
  if [ "$OS" = Darwin ]; then install_pkgs node
  elif has apt-get; then curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y -qq nodejs
  elif has dnf; then curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y -q nodejs
  else install_pkgs nodejs npm; fi
fi
if ! has uv; then
  say "Installing uv (Python manager)"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
ok "Tools ready: git, ffmpeg, node $(node -v), uv"

# --- 2. Code --------------------------------------------------------------------------------------------------------
if [ -d "$DIR/.git" ]; then say "Updating VidMind"; git -C "$DIR" pull --ff-only -q
else say "Downloading VidMind"; git clone -q --depth 1 "$REPO" "$DIR"; fi
say "Setting up the backend (Python 3.12)"
(cd "$DIR/api" && uv sync -q)
say "Building the web app (about a minute)"
(cd "$DIR/web" && npm ci --silent --no-audit --no-fund && npm run build --silent >/dev/null)
ok "VidMind built"

# --- 3. Provider ----------------------------------------------------------------------------------------------------
# VIDMIND_PROVIDER (1-8) and VIDMIND_API_KEY skip the questions, for scripted installs.
choice="${VIDMIND_PROVIDER:-}"
[ -n "$choice" ] || cat >/dev/tty <<MENU

${bold}Which AI should make your notes?${off}
  1) Meta Muse        best quality, everything on (hackathon build)     key: https://dev.meta.ai
  2) OpenAI                                                             key: https://platform.openai.com/api-keys
  3) Anthropic        Claude                                            key: https://console.anthropic.com/settings/keys
  4) Groq             free tier, very fast                              key: https://console.groq.com/keys
  5) NVIDIA           free tier                                         key: https://build.nvidia.com
  6) OpenRouter       free models available                             key: https://openrouter.ai/keys
  7) xAI Grok                                                           key: https://console.x.ai
  8) Ollama           free and private, runs on this computer           no key
MENU
[ -n "$choice" ] || choice="$(ask "Choose 1-8 [1]: ")"; choice="${choice:-1}"

off_muse="IMAGE_MODEL=\nSEGMENT_MODEL=\nSPEECH_MODEL=\nREADER_MODEL=\nLLM_VISION_MODELS=\n"
case "$choice" in
  1) var=MODEL_API_KEY;      lines="" ;;
  2) var=OPENAI_API_KEY;     lines="LLM_MODELS=openai:gpt-4.1-mini\nLLM_VISION_MODELS=openai:gpt-4.1-mini\nREADER_MODEL=openai:gpt-4.1-mini\nSPEECH_MODEL=openai:whisper-1\nIMAGE_MODEL=openai:gpt-image-1\nSEGMENT_MODEL=\n" ;;
  3) var=ANTHROPIC_API_KEY;  lines="IMAGE_MODEL=\nSEGMENT_MODEL=\nSPEECH_MODEL=\nLLM_MODELS=anthropic:claude-haiku-5-5\nLLM_VISION_MODELS=anthropic:claude-haiku-5-5\nREADER_MODEL=anthropic:claude-haiku-5-5\n" ;;
  4) var=GROQ_API_KEY;       lines="${off_muse}LLM_MODELS=groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b\n" ;;
  5) var=NVIDIA_API_KEY;     lines="${off_muse}LLM_MODELS=nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b\n" ;;
  6) var=OPENROUTER_API_KEY; lines="${off_muse}LLM_MODELS=openrouter:meta-llama/llama-3.3-70b-instruct:free\n" ;;
  7) var=XAI_API_KEY;        lines="${off_muse}LLM_MODELS=xai:grok-4\n" ;;
  8) var="";                 lines="${off_muse}LLM_MODELS=ollama:${OLLAMA_MODEL}\n" ;;
  *) die "Pick a number from 1 to 8." ;;
esac
key="${VIDMIND_API_KEY:-}"
if [ -n "$var" ] && [ -z "$key" ] && [ -z "${VIDMIND_PROVIDER:-}" ]; then
  key="$(secret "Paste your API key (hidden; Enter to add it later in $DIR/.env): ")"
fi
if [ "$choice" = 8 ]; then
  has ollama || { say "Installing Ollama"; if [ "$OS" = Darwin ]; then install_pkgs ollama; else curl -fsSL https://ollama.com/install.sh | sh; fi; }
  pgrep -x ollama >/dev/null || (ollama serve >/dev/null 2>&1 &)
  for _ in $(seq 20); do ollama list >/dev/null 2>&1 && break; sleep 1; done
  say "Downloading $OLLAMA_MODEL (1.9 GB, once)"
  ollama pull "$OLLAMA_MODEL"
fi
asr=parakeet; [ "$OS" = Darwin ] && [ "$(uname -m)" = arm64 ] || asr=whisper  # Parakeet runs on Apple Silicon only
{
  sed -e "s|^MODEL_API_KEY=.*|MODEL_API_KEY=$([ "$var" = MODEL_API_KEY ] && printf '%s' "$key")|" \
      -e "s|^ASR_ENGINE=.*|ASR_ENGINE=$asr|" "$DIR/.env.example"
  printf '\n# Chosen by the installer\n'
  [ -n "$var" ] && [ "$var" != MODEL_API_KEY ] && printf '%s=%s\n' "$var" "$key"
  printf "%b" "$lines"
} >"$DIR/.env"
chmod 600 "$DIR/.env"
ok "Settings saved to $DIR/.env"

# --- 4. The vidmind command -----------------------------------------------------------------------------------------
mkdir -p "$BIN"
cat >"$BIN/vidmind" <<LAUNCH
#!/usr/bin/env bash
# Starts VidMind (API on :8000, web on :3000) and opens it. Ctrl+C stops both.
cd "$DIR"
$( [ "$choice" = 8 ] && echo 'pgrep -x ollama >/dev/null || (ollama serve >/dev/null 2>&1 &)' || true)
(cd api && uv run --env-file ../.env uvicorn vidmind.main:app --port 8000 --log-level warning) &
(cd web && npm start --silent -- -p 3000) &
trap 'kill 0' EXIT INT TERM
for _ in \$(seq 60); do curl -sf http://localhost:3000 >/dev/null && break; sleep 1; done
echo "VidMind is running at http://localhost:3000  (Ctrl+C to stop)"
(open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true)
wait
LAUNCH
chmod +x "$BIN/vidmind"
case ":$PATH:" in *":$BIN:"*) ;; *) for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do [ -f "$rc" ] && grep -q '.local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$rc"; done ;; esac

printf '\n%s\n\n  %s\n\n%s\n' "${green}${bold}Done.${off} Start VidMind with:" "${bold}vidmind${off}" \
  "${dim}(new terminal, or: $BIN/vidmind). Switch provider: run this installer again. Remove: see README, Uninstall.${off}"
