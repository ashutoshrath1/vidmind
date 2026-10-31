# Removes VidMind from Windows: the app folder (with its notes and settings) and the `vidmind` command.
#   irm https://raw.githubusercontent.com/ashutoshrath1/vidmind/main/uninstall.ps1 | iex
# Shared tools (git, ffmpeg, Node, uv, Ollama) stay. An Ollama model VidMind pulled is removed only if you say yes.
$Dir = if ($env:VIDMIND_DIR) { $env:VIDMIND_DIR } else { Join-Path $HOME "vidmind" }
$OllamaModel = if ($env:VIDMIND_OLLAMA_MODEL) { $env:VIDMIND_OLLAMA_MODEL } else { "qwen2.5:3b" }
$bin = Join-Path $HOME ".local\bin"
Remove-Item "$bin\vidmind.ps1", "$bin\vidmind.cmd" -ErrorAction SilentlyContinue
if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir; Write-Host "OK Removed $Dir" } else { Write-Host "Nothing at $Dir" }
if ((Get-Command ollama -ErrorAction SilentlyContinue) -and (ollama list | Select-String -SimpleMatch $OllamaModel)) {
  if ((Read-Host "Also delete the Ollama model $OllamaModel (1.9 GB)? [y/N]") -match '^[Yy]') { ollama rm $OllamaModel; Write-Host "OK Deleted $OllamaModel" }
}
Write-Host "OK VidMind uninstalled."
