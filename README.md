# VidMind

VidMind turns a video into notes where every point is checked against the exact second it came from: what was
said, or what was on screen. Click any piece of evidence and the player jumps to that moment.

Built for the Meta AI Developer Hackathon (Oct 26 – Nov 4, 2026).

## Modes

Pick the kind of video on the home page, or leave it on **Auto** and the model tells from what it hears and sees.

| Mode | For | Adds to the notes |
|---|---|---|
| Lecture (`learn`) | lectures, talks, tutorials | takeaways, a diagram of what the video explains, posts for LinkedIn and X |
| Meeting (`meet`) | meeting recordings | decisions and action items with owners and deadlines, soonest first; "Post to Slack", "Copy for Slack", "Download Jira CSV" |
| Demo (`test`) | product demos, screen recordings | test scenarios, each with a Playwright test file |

Every mode keeps the notes. Actions and test steps pass the same evidence check as notes.

## Features

- **Verified notes.** Quotes must match the transcript within ±5 s and screen-text citations a real frame within
  ±2 s. One repair round; notes that still fail are removed (never shown unverified) and listed with the reason.
  Notes that rest on hard-to-read screen text are labelled **Uncertain**.
- **Keyframes and point-and-ask.** Up to 30 scene-change keyframes with their screen text. Point at part of a
  keyframe and ask about it; SAM 3.1 outlines what you pointed at.
- **Ask the video.** Answers cite the transcript or a keyframe and go through the same check. When the video
  doesn't answer it, a web search answers instead, labelled as not from the video, with its sources.
- **Web fact-check.** The takeaways are checked against the web: confirmed, outdated, disputed or unclear, with sources.
- **Diagram.** When the video explains a system or flow, a Mermaid diagram whose boxes each cite evidence.
- **Summary card.** A Muse Image card from the checked result; its text is read back and the card is dropped
  unless every line matches.
- **Posts.** LinkedIn and X posts built from the takeaways, with a 1080x1350 image.
- **Exports.** Markdown (copy), Slack message (copied, or posted through your incoming webhook), Jira CSV, Playwright tests, the card image. Timestamps link to the
  exact second on YouTube.
- **Behind the scenes.** Every step is traced live (transcript, keyframes and their text, each model call and
  citation check) and can be replayed at half speed.

## Models

| Model | Does |
|---|---|
| Muse Spark 1.3 | notes, overview and mode detection, takeaways and diagram, Meet/Test output, Ask, point-and-ask, web search (fact-check, sources, web answers); reads keyframes and short clips |
| Muse Spark 1.2 | backup when 1.3 is slow or fails (hedged); first for listen-first sections, where it was steadier |
| Muse Voice Transcribe | speech to text, in ~6 s pieces sent in parallel, diarized, English and Hindi |
| SAM 3.1 | finds diagrams in keyframes and outlines what was pointed at |
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
     ├─ whole video: title, summary and mode; takeaways and diagram; Meet or Test output
     └─ after the notes: web fact-check, web sources, summary card
```

The output contract is `api/src/vidmind/schema.py`, mirrored in `web/lib/api.ts`.

## Measured

- The sample (a real Muse run of a 4:44 lecture): all notes in **10.35 s**; **19 of 19** notes passed the
  evidence check. The e2e tests check it stays under 11 s.
- `scripts/eval_modes.py` on the synthetic fixtures (Oct 27): action-item F1 **1.0** (5/5, one shown only on a
  slide); **3/3** generated Playwright tests pass against the recorded app; **47 min** saved per hour of video
  (reading the notes vs watching, on the 5-minute lecture). Details: `docs/MODES_PLAN.md`.
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
uv run --project api --env-file .env python scripts/eval_modes.py                         # Meet/Test (~$0.10)
```

The Learn fixture (`scripts/make_fixture.py`) has one fact that is **shown but never spoken**, so a
transcript-only summary cannot get it.

## API

| Method | Path | |
|---|---|---|
| POST | `/jobs` | multipart `file`, optional `mode` (`learn`, `meet`, `test`); returns `{id, reused}` |
| POST | `/jobs/from-url` | JSON `{url, rights_confirmed, mode?}`; returns `{id, title, reused}` |
| GET | `/jobs/{id}` | `{status, error, sections_done, sections_total}` |
| GET | `/jobs/{id}/events` | status and trace as server-sent events until the job ends |
| GET | `/jobs/{id}/result` | the result JSON; partial as soon as one section is done |
| POST | `/jobs/{id}/ask` | `{question}` → `{answer, found, evidence, web, sources}` |
| POST | `/jobs/{id}/point` | `{frame_url, x, y, question}` → an answer about that spot |
| GET | `/jobs/{id}/video`, `/jobs/{id}/frames/{n}.jpg` | media |
| POST | `/jobs/{id}/actions/slack` | `{webhook, origin?}` posts decisions and actions to a `https://hooks.slack.com/services/...` webhook |
| DELETE | `/jobs/{id}` | removes the job's files |
| POST | `/mcp` | MCP (Streamable HTTP), read-only: see below |

`sample` works as a read-only job id.

## Use the notes from Claude or ChatGPT (MCP)

The API serves a read-only MCP server at `http://localhost:8000/mcp` (Streamable HTTP, no sign-in). Its tools:
`get_notes(job_id)` (title, summary, takeaways and notes, each with its evidence seconds), `get_actions(job_id)`
(decisions and actions with owner and deadline) and `ask_video(job_id, question)` (a checked answer that cites
seconds; it calls the model, so it spends credit). `job_id` is the id in a result link, or `sample`.

- **Claude Code:** `claude mcp add --transport http vidmind http://localhost:8000/mcp`
- **Claude (custom connector) or ChatGPT (developer mode connector):** these call the server from the internet, so
  they need a public HTTPS URL. Run a tunnel to port 8000 that sets the Host header to `localhost:8000` (the MCP
  SDK's DNS-rebinding guard accepts only localhost), e.g. `ngrok http 8000 --host-header=localhost:8000`, and add
  `https://<tunnel>/mcp` as the connector URL. Anyone with that URL can read any job whose id they know, and ask
  questions on your model credit, so stop the tunnel when you're done.
