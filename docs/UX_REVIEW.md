# VidMind UX review and plan (Oct 25, 2026)

Method: apple-skills product / ux-spec. Screenshots of every page and state (desktop 1440, phone 390, light),
reviewed as a product manager against the core job: *turn a video into notes I can trust, fast, and take them with me.*

## Principles

1. **Show the unique trick first.** VidMind catches facts that are shown but never said, and proves every note.
   The first screen must make that visible in seconds, not describe it.
2. **Every state has a way forward.** No dead ends: missing jobs, errors and empty tabs all say what happened and
   what to do next.
3. **The notes leave with you.** A study tool that can't export is a demo.
4. **Motion means something.** 3D and animation only to show the pipeline (video → frames → text → checked note)
   and the brand's promise (play → checked). Reduced motion gets a still, complete version.

## Screen inventory

| Screen | Purpose |
|---|---|
| Home | add a video (file or link), see the estimate, understand the product |
| Job, running | watch every step live (run panel, keyframes, model race, checks) |
| Job, done | read notes with proof, quiz, ask, replay, export |
| Job, not found | expired (24 h) or deleted: explain and send back |
| Sample | the same page, labelled precomputed |

## Findings (from the screenshots)

| # | Finding | Severity |
|---|---|---|
| 1 | Phone: the composer row overflows; placeholder cut to "Paste a YouTul", button hits the edge | P0 |
| 2 | Job not found: red "Lost contact" banner beside a skeleton that scans forever and "Connecting" | P0 |
| 3 | No logo; favicon is Next's default; no link-preview image when the URL is shared | P1 |
| 4 | Hero shows a plain white slide; the product's trick (screen-only fact, proven) is invisible | P1 |
| 5 | Home never mentions quiz, Ask the video or the replay; no footer on privacy and retention | P1 |
| 6 | Finished page is ~5,500 px of one column; each chapter cover is ~290 px; no outline to jump around | P1 |
| 7 | No export of the notes | P1 |

## Plan

| # | Change | Fixes |
|---|---|---|
| 1 | Composer stacks on narrow screens: input full width, buttons on their own row | 1 |
| 2 | Not-found state: plain explanation (expired after 24 h or deleted) and "Add a video" | 2 |
| 3 | Logo: a vermillion tile whose play symbol turns in 3D to a check (video → verified); used in both headers | 3 |
| 4 | `app/icon.svg` favicon from the same mark; `app/opengraph-image.tsx` link preview | 3 |
| 5 | Hero 3D scene (CSS 3D, no library): a video panel, three keyframes fanned in depth, the scan beam reading one, the screen-only fact lifting out toward you, and a note card landing with the "Checked" stamp. Follows the pointer; still for reduced motion | 4 |
| 6 | "In every result" strip (proof, quiz, Ask the video, replay) and a footer (processing, 24 h deletion) | 5 |
| 7 | Chapter outline beside the notes on wide screens; chapter covers become thumbnails beside the summary | 6 |
| 8 | Export: copy the notes as Markdown, or download a `.md` with timestamps and evidence | 7 |

Not in this pass: quiz self-scoring, sound, keyboard shortcuts.

## Result (verified in the browser, 1440 and 390, light, dark, reduced motion)

| # | Status |
|---|---|
| 1 | Done: input on its own row on phones; no horizontal overflow on any page |
| 2 | Done: "These notes aren't here any more", with Add a video / See the sample |
| 3 | Done: 3D coin logo (turns once on load and on hover) in both headers |
| 4 | Done: `app/icon.svg`, `app/opengraph-image.tsx` (1200×630) |
| 5 | Done: CSS 3D hero, pointer tilt, 6 s loop, still under reduced motion |
| 6 | Done: "In every result" strip and footer (says the transcript goes to Groq/NVIDIA) |
| 7 | Done: sticky chapter outline; covers as thumbnails (finished page 5,500 → 4,800 px) |
| 8 | Done: Copy notes / Download .md, timestamps link to the second on YouTube; covered by a web test |
