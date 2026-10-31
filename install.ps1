# VidMind one-shot installer for Windows (PowerShell 5+).
#   irm https://raw.githubusercontent.com/ashutoshrath1/vidmind/main/install.ps1 | iex
# Installs what is missing (git, ffmpeg, Node 22, uv + Python 3.12) with winget, clones VidMind to ~\vidmind, asks
# which AI provider to use, writes .env, and adds a `vidmind` command. Re-run it any time to update or switch.
$ErrorActionPreference = "Stop"
$Dir = if ($env:VIDMIND_DIR) { $env:VIDMIND_DIR } else { Join-Path $HOME "vidmind" }
$Repo = "https://github.com/ashutoshrath1/vidmind.git"
$OllamaModel = if ($env:VIDMIND_OLLAMA_MODEL) { $env:VIDMIND_OLLAMA_MODEL } else { "qwen2.5:3b" }
function Say($t) { Write-Host "> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "OK $t" -ForegroundColor Green }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
function Want($cmd, $id) { if (-not (Has $cmd)) { Say "Installing $id"; winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null; Refresh } }

Write-Host "`nVidMind  Any video. Notes with proof.`nInstalling to $Dir`n"

# 1. Tools
if (-not (Has winget)) { throw "winget is missing: install 'App Installer' from the Microsoft Store, then run this again." }
Want git "Git.Git"
Want ffmpeg "Gyan.FFmpeg"
Want node "OpenJS.NodeJS.LTS"
if (-not (Has uv)) { Say "Installing uv (Python manager)"; powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"; Refresh; $env:Path += ";$HOME\.local\bin" }
Ok "Tools ready"

# 2. Code
if (Test-Path "$Dir\.git") { Say "Updating VidMind"; git -C $Dir pull --ff-only -q } else { Say "Downloading VidMind"; git clone -q --depth 1 $Repo $Dir }
Say "Setting up the backend (Python 3.12)"; Push-Location "$Dir\api"; uv sync -q; Pop-Location
Say "Building the web app (about a minute)"; Push-Location "$Dir\web"; npm ci --silent --no-audit --no-fund; npm run build --silent | Out-Null; Pop-Location
Ok "VidMind built"

# 3. Provider
$choice = $env:VIDMIND_PROVIDER  # with VIDMIND_API_KEY: skips the questions, for scripted installs
if (-not $choice) { Write-Host @"

Which AI should make your notes?
  1) Meta Muse     best quality, everything on      key: https://dev.meta.ai
  2) OpenAI                                         key: https://platform.openai.com/api-keys
  3) Anthropic     Claude                           key: https://console.anthropic.com/settings/keys
  4) Groq          free tier, very fast             key: https://console.groq.com/keys
  5) NVIDIA        free tier                        key: https://build.nvidia.com
  6) OpenRouter    free models available            key: https://openrouter.ai/keys
  7) xAI Grok                                       key: https://console.x.ai
  8) Ollama        free and private, on this PC     no key
"@
$choice = Read-Host "Choose 1-8 [1]" }
if (-not $choice) { $choice = "1" }
$offMuse = "IMAGE_MODEL=`nSEGMENT_MODEL=`nSPEECH_MODEL=`nREADER_MODEL=`nLLM_VISION_MODELS=`n"
$presets = @{
  "1" = @("MODEL_API_KEY", "")
  "2" = @("OPENAI_API_KEY", "LLM_MODELS=openai:gpt-4.1-mini`nLLM_VISION_MODELS=openai:gpt-4.1-mini`nREADER_MODEL=openai:gpt-4.1-mini`nSPEECH_MODEL=openai:whisper-1`nIMAGE_MODEL=openai:gpt-image-1`nSEGMENT_MODEL=`n")
  "3" = @("ANTHROPIC_API_KEY", "IMAGE_MODEL=`nSEGMENT_MODEL=`nSPEECH_MODEL=`nLLM_MODELS=anthropic:claude-haiku-5-5`nLLM_VISION_MODELS=anthropic:claude-haiku-5-5`nREADER_MODEL=anthropic:claude-haiku-5-5`n")
  "4" = @("GROQ_API_KEY", "${offMuse}LLM_MODELS=groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b`n")
  "5" = @("NVIDIA_API_KEY", "${offMuse}LLM_MODELS=nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b`n")
  "6" = @("OPENROUTER_API_KEY", "${offMuse}LLM_MODELS=openrouter:meta-llama/llama-3.3-70b-instruct:free`n")
  "7" = @("XAI_API_KEY", "${offMuse}LLM_MODELS=xai:grok-4`n")
  "8" = @("", "${offMuse}LLM_MODELS=ollama:$OllamaModel`n")
}
if (-not $presets.ContainsKey($choice)) { throw "Pick a number from 1 to 8." }
$var, $lines = $presets[$choice]
$key = "$env:VIDMIND_API_KEY"
if ($var -and -not $key -and -not $env:VIDMIND_PROVIDER) {
  $s = Read-Host "Paste your API key (hidden; Enter to add it later in $Dir\.env)" -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
if ($choice -eq "8") {
  Want ollama "Ollama.Ollama"
  if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) { Start-Process ollama -ArgumentList serve -WindowStyle Hidden; Start-Sleep 3 }
  Say "Downloading $OllamaModel (1.9 GB, once)"; ollama pull $OllamaModel
}
$env_ = (Get-Content "$Dir\.env.example") -replace '^ASR_ENGINE=.*', 'ASR_ENGINE=whisper'
if ($var -eq "MODEL_API_KEY") { $env_ = $env_ -replace '^MODEL_API_KEY=.*', "MODEL_API_KEY=$key" }
$extra = "`n# Chosen by the installer`n"
if ($var -and $var -ne "MODEL_API_KEY") { $extra += "$var=$key`n" }
Set-Content -Path "$Dir\.env" -Value (($env_ -join "`n") + $extra + $lines) -Encoding UTF8
Ok "Settings saved to $Dir\.env"

# 4. The vidmind command
$bin = Join-Path $HOME ".local\bin"; New-Item -ItemType Directory -Force $bin | Out-Null
$ollamaLine = if ($choice -eq "8") { "if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) { Start-Process ollama -ArgumentList serve -WindowStyle Hidden }" } else { "" }
@"
# Starts VidMind (API on :8000, web on :3000) and opens it. Close this window to stop.
Set-Location "$Dir"
$ollamaLine
`$api = Start-Process uv -ArgumentList 'run','--env-file','../.env','uvicorn','vidmind.main:app','--port','8000','--log-level','warning' -WorkingDirectory "$Dir\api" -NoNewWindow -PassThru
`$web = Start-Process npm.cmd -ArgumentList 'start','--','-p','3000' -WorkingDirectory "$Dir\web" -NoNewWindow -PassThru
foreach (`$i in 1..60) { try { Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 } }
Write-Host "VidMind is running at http://localhost:3000  (Ctrl+C to stop)"
Start-Process http://localhost:3000
try { Wait-Process -Id `$api.Id } finally { Stop-Process -Id `$api.Id,`$web.Id -ErrorAction SilentlyContinue }
"@ | Set-Content "$bin\vidmind.ps1" -Encoding UTF8
"@powershell -ExecutionPolicy Bypass -File `"%~dp0vidmind.ps1`" %*" | Set-Content "$bin\vidmind.cmd" -Encoding ASCII
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$bin*") { [Environment]::SetEnvironmentVariable("Path", "$userPath;$bin", "User") }

Write-Host "`nDone. Open a new terminal and start VidMind with:`n`n  vidmind`n" -ForegroundColor Green
