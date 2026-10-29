# VidMind

VidMind turns a video into notes where every point is checked against the exact second it came from: what was
said, or what was on screen. Click any piece of evidence and the player jumps to that moment.

Built for the Meta AI Developer Hackathon (Oct 26 – Nov 4, 2026).

## Features

- **Verified notes.** Quotes must match the transcript within ±5 s and screen-text citations a real frame within
  ±2 s. One repair round; notes that still fail are removed (never shown unverified) and listed with the reason.
  Notes that rest on hard-to-read screen text are labelled **Uncertain**.
- **Keyframes.** Up to 30 scene-change keyframes with their screen text; SAM 3.1 finds diagrams and crops them.
- **Diagram.** When the video explains a system or flow, a Mermaid diagram whose boxes each cite evidence.
- **Summary card.** A Muse Image card from the checked result; its text is read back and the card is dropped
  unless every line matches.
- **Exports.** Markdown (copy) and the card image. Timestamps link to the
  exact second on YouTube.
- **Behind the scenes.** Every step is traced live (transcript, keyframes and their text, each model call and
  citation check) and can be replayed at half speed.

## Models

| Model | Does |
|---|---|
| Muse Spark 1.2 | notes from each section's transcript and keyframes, overview, takeaways and diagram (12 sections at once: 5.7 s vs 6.85 s on 1.3) |
| Muse Spark 1.3 | backup when 1.2 is slow or fails (hedged); reads the keyframes' screen text after the notes |
| Muse Voice Transcribe | speech to text, in ~6 s pieces sent in one wave over kept-alive connections, slow pieces re-sent; diarized, English and Hindi |
| SAM 3.1 | finds diagrams in keyframes and crops them |
| Muse Image | the summary card |

Without `MODEL_API_KEY`, notes use the `LLM_MODELS` pool (Groq, NVIDIA; see `.env.example`) and speech uses
Parakeet (Apple Silicon, English) or faster-whisper. Creator subtitles, when present, replace speech recognition.
Every result records which models and transcriber produced it.

## How it works

```
Next.js (web/)  ── upload or link, live progress (server-sent events), player, notes + evidence, tabs per mode
     │  HTTP
FastAPI (api/)  ── validate → reuse a finished job for the same video and mode, else a file-backed job
     ├─ media: an uploaded file, or YouTube streamed with ranged requests (no download)
     ├─ transcript: creator subtitles, else Muse Voice Transcribe (with Muse, sections go to Spark as clips with
     │    sound at once, and the transcript checks their quotes afterwards)
     ├─ in parallel: scene detection → ≤30 keyframes → screen text (OCR)
     ├─ per section: notes, hedged across models; first grounded result wins; published as soon as it's checked
     ├─ whole video: title and summary; takeaways and diagram
     └─ after the notes: summary card
```

The output contract is `api/src/vidmind/schema.py`, mirrored in `web/lib/api.ts`.

## Measured

- A 595 s (10-minute) YouTube talk, start to checked notes: **8.8-9.1 s** over 3 runs (Oct 29), from 16.9 s.
  YouTube's own captions of the original audio in ~0.4 s, keyframes ~3.5 s, notes ~4 s a section, all 12 at
  once. Without captions (Muse speech recognition): 12.4-13.1 s.
- The sample (a real Muse run of a 4:44 lecture): all notes in **10.35 s**; **19 of 19** notes passed the
  evidence check. The e2e tests check it stays under 11 s.
- Speech on 105 s of lecture audio (M2 Air): Parakeet TDT 0.6B 2.5 s, faster-whisper base 4.1 s, faster-whisper
  small 19.1 s.

## Run it locally

Requirements: Python 3.12 + [uv](https://docs.astral.sh/uv/), Node 20+, ffmpeg, and optionally Tesseract for OCR
outside macOS. On Apple Silicon, `uv sync` also installs Parakeet (MLX) and Apple Vision OCR.

```bash
cp .env.example .env              # then set MODEL_API_KEY (or a Groq/NVIDIA key)

cd api && uv run --env-file ../.env uvicorn vidmind.main:app --port 8000   # API
cd web && npm install && npm run dev                                       # web, in another terminal
```

Open http://localhost:3000, or the precomputed sample at `/jobs/sample` (labelled as precomputed in the UI;
regenerate it with `scripts/make_sample.sh <job-id>`).

## Video sources

- **Upload:** MP4, MOV, M4V, WebM or MKV, including screen recordings. A text subtitle track inside the file is
  used as the transcript.
- **Link:** YouTube, Vimeo, a direct video URL, or another site [yt-dlp](https://github.com/yt-dlp/yt-dlp)
  supports. YouTube is streamed, not downloaded, and plays in YouTube's player; others are downloaded (≤720p).
  The user must confirm they own the video or that it is openly licensed. Playlists, live streams, private or
  local network addresses, and paid or DRM-protected platforms are refused.

## Limits and data handling

- Up to **12 hours** and **2 GB** per video.
- Jobs live under `api/data/jobs/<id>/` and are deleted after **24 hours** (checked hourly and at startup).
  "Delete from server" removes one sooner, unless someone else submitted the same video. Audio stays in memory.
- The video, transcript and screen text go to the AI model provider (Meta, with `MODEL_API_KEY`).
- Muse Voice Transcribe times whole speech turns, so citations are as fine as a ~6 s piece.
- A finished result is reused when the same file (SHA-256) or link is submitted again with the same mode
  choice, and the page says so.

## Tests and evaluation

```bash
cd api && uv run pytest                                          # API, pipeline, checks (models stubbed)
cd web && npm test                                               # pure functions in web/lib
cd scripts/eval_demo && npx playwright test -c e2e.config.ts     # end to end, against the running app
python3 scripts/eval.py api/data/jobs/<id>/result.json fixtures/fixture.annotations.json   # Learn fixture
```

The Learn fixture (`scripts/make_fixture.py`) has one fact that is **shown but never spoken**, so a
transcript-only summary cannot get it.

## API

| Method | Path | |
|---|---|---|
| POST | `/jobs` | multipart `file`; returns `{id, reused}` |
| POST | `/jobs/from-url` | JSON `{url, rights_confirmed}`; returns `{id, title, reused}` |
| GET | `/jobs/{id}` | `{status, error, sections_done, sections_total}` |
| GET | `/jobs/{id}/events` | status and trace as server-sent events until the job ends |
| GET | `/jobs/{id}/result` | the result JSON; partial as soon as one section is done |
| GET | `/jobs/{id}/video`, `/jobs/{id}/frames/{n}.jpg` | media |
| DELETE | `/jobs/{id}` | removes the job's files |

`sample` works as a read-only job id.

