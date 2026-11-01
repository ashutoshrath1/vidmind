# Demo video script (under 3 minutes, one uncut take)

Judges watch the video first and decide largely from it (docs/HACKATHON_WINNING_RESEARCH.md). So the first 30 seconds
must show the three things that make VidMind different: speed, every point linked to its second, and the check.

Record the screen part with `scripts/eval_demo/record.mjs` (one take, 1440x900, dark) and add your own voice over it in
any editor. Use a YouTube video you own or that is openly licensed, about 10 minutes long, and one not processed in
the last 24 h, so the notes are seen streaming in and the finish plays. Before recording: plug the laptop in and quit
other apps (background load made runs 2x slower). Do one rehearsal run on a different video first: YouTube sometimes
refuses caption requests after many runs (HTTP 429), and the run then takes the speech route (first notes ~8 s).

| Time | On screen | Say (in your own words) |
|---|---|---|
| 0:00-0:08 | Home page: the headline, the link box, the numbers, all on one screen | "A 10-minute lecture takes 10 minutes to watch. Notes from AI often miss or invent things." |
| 0:08-0:15 | Paste a YouTube link, click "I have the rights — make notes" | "Paste a video." |
| 0:15-0:30 | The live "Now" line narrates ("Section 3: …, 4 checked notes"); sections stream in; when the last lands, every ✓ lights up green in order | "Notes arrive in seconds, section by section, and every point is checked before it shows up." |
| 0:30-0:50 | Hover a ✓ marked "on screen": the exact slide it was checked against. Click it: the player opens at that second | "Each point links to the exact second it came from. Here is the slide it rests on." |
| 0:50-1:00 | Scroll to the end: "All N claims checked against the video" (or the removed ones, listed with why) | "Anything the video doesn't back is thrown out, and you can see what and why." |
| 1:00-1:25 | On screen tab: a slide, its explanation, what was said around it; click its time | "It reads the slides too: what's only on screen makes it into the notes." |
| 1:25-1:55 | How it was made: "N notes verified in X s", then the "When each step ran" chart | "Every step and model, with real timings from this run: Muse Voice Transcribe, Muse Spark, Muse Image." |
| 1:55-2:15 | Example (Karpathy's 2-hour "Let's build GPT"): scroll its 140 sections | "It scales: a 2-hour talk had its first note in 14 seconds and about 440 checked notes in a minute and a quarter." |
| 2:15-2:30 | Back on your run: Copy as Markdown, paste into any editor | "And it's yours as a clean article, one click. That's VidMind." |

Numbers you may say (measured on this laptop; say "on my laptop" with them):
- a 10-minute YouTube talk with captions to all checked notes: 4.2-5.1 s (4 runs); first notes 4.0-6.5 s;
- a video without usable captions (speech recognition): first notes about 8-9 s;
- the 2-hour example (2 runs): first note 13-14 s, 439-440 checked notes in 1 min 11-14 s.

Mention the models the run card shows. SAM 3.1 is listed only when its diagram tracking finished in that run.

## Before you record (tomorrow)

1. `cd api && uv run --env-file ../.env uvicorn vidmind.main:app --port 8000` and `cd web && npm run dev`; open
   http://localhost:3000 once so pages are compiled.
2. Rehearse once on a different video (YouTube may refuse captions after many runs; then first notes take ~8 s).
3. Pick a fresh ~10-minute talk you may show (owned or openly licensed), never processed before.
4. Record: `cd scripts/eval_demo && node record.mjs <youtube-url>` (dark, 1440x900, one take, about 2 minutes),
   or record your screen and follow the table. Press `?` on the notes page if you want to show the shortcuts.
5. Close other apps and plug in: background load made runs 2x slower.

Upload to YouTube as Unlisted or Public, and mark it "Not made for kids" so judges can play it embedded.
