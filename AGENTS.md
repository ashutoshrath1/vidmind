# AGENTS.md

Instructions for AI coding agents (Codex, Cursor, Copilot, Claude Code, Gemini, …) working in this repository.
Humans: start with the [README](README.md).

## What this is

VidMind turns a video into a checked, blog-style article. Every note cites the second (or keyframe) it came from,
and a note that the transcript or a keyframe does not support is removed before anyone sees it. That check is the
product: never weaken or bypass it.

- `api/`: FastAPI backend, Python 3.12, managed with `uv`. The pipeline is in `api/src/vidmind/`.
- `web/`: Next.js 16 + React + Tailwind 4 frontend.
- `scripts/eval_demo/`: Playwright end-to-end tests (`e2e/`), the live browser check and the demo recorder.
- `samples/`: the precomputed example run served at `/jobs/sample` (Karpathy's 2-hour "Let's build GPT").
- `docs/`: demo script, submission draft, research notes, media for the README.

## Commands

```bash
# run (two terminals); needs a key in .env (see .env.example)
cd api && uv run --env-file ../.env uvicorn vidmind.main:app --port 8000 --reload
cd web && npm install && npm run dev                         # http://localhost:3000

# checks: all must pass before a change is done
cd api && uv run pytest -q                                    # API, pipeline and the evidence check (models stubbed)
cd web && npx tsc --noEmit -p . && npm run lint && npm test   # types, lint, unit tests for web/lib and components
cd scripts/eval_demo && npx playwright test -c e2e.config.ts  # end to end against the running app
```

## Where things live

| Concern | File |
|---|---|
| Stages, concurrency, keyframes vs notes timing, articles, images | `api/src/vidmind/pipeline.py` |
| The evidence check (quote within 5 s, keyframe within 2 s) | `api/src/vidmind/schema.py` |
| Providers and model roles (all from environment) | `api/src/vidmind/models.py` |
| Prompts and model calls | `api/src/vidmind/synthesize.py` |
| YouTube links, captions, streams | `api/src/vidmind/fetch.py` |
| Scene scan, keyframe choice, OCR | `api/src/vidmind/frames.py` |
| Speech recognition (hosted or on-device) | `api/src/vidmind/transcribe.py` |
| Jobs, workers, failure messages | `api/src/vidmind/jobs.py` |
| HTTP routes, uploads, the live event stream | `api/src/vidmind/main.py` |
| Result page | `web/components/Workspace.tsx`, `Sections.tsx`, `Cite.tsx`, `RunPanel.tsx`, `ScreenText.tsx` |
| Trace → view, the live narration | `web/lib/trace.ts` |
| Design tokens, motion, glass | `web/app/globals.css` |

## Rules

1. **Models are configuration.** Never hardcode a provider or model id in code paths. Add a provider to `BUILTIN`
   in `models.py` or through `PROVIDER_<NAME>_BASE_URL` / `_API_KEY`. Meta Muse is the default for every role
   (it is the hackathon build); do not change the defaults.
2. **Every note goes through the check.** New note sources must pass `ground_notes` / `_ground_section`. Never
   show an unchecked claim, and never loosen the thresholds to make a test pass.
3. **Only measured numbers.** Any speed, accuracy or size figure in code comments, docs, UI copy or commit
   messages must come from a run you measured; say what and how (video length, machine, number of runs).
4. **Secrets stay out of git.** Keys live in `.env` (git-ignored). `.env.example` holds no values. Never print a
   key in logs or output.
5. **Live runs cost money.** Model calls are paid. Test pipeline changes on `fixtures/` (a 1-minute clip; generate
   it with `uv run python scripts/make_fixture.py fixtures`) or on finished jobs (`/jobs/<id>`, `/jobs/sample`),
   not on long videos.
6. **Cached results.** `PIPELINE_VERSION` in `pipeline.py` is part of the cache key: bumping it makes every video
   be processed again. Bump it only when a result's shape or meaning changes.
7. **UI work is checked in a browser.** Types and tests passing is not enough: look at the page (light and dark,
   desktop and phone width). Respect `prefers-reduced-motion`; use the tokens in `globals.css`, not raw colours.
8. **Match the surrounding code.** Comments explain why, not what. Keep functions where their stage lives. Prefer
   the smallest change that fully works; delete code a change makes unused.
9. **Git.** `main` is protected: open a pull request. Commit messages say what changed and why, in plain words.
   Do not add AI co-author or session trailers to commits.

## Definition of done

The three check commands pass, the change is visible and correct in the running app, docs mention any new setting
(`.env.example`, README), and nothing in the diff is a secret, a stray screenshot or a test artifact.
