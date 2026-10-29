# VidMind: Devpost page draft

## Name
VidMind

## Tagline
Notes from any video in about 5 seconds, each one checked against the second it came from.

## Inspiration
Students and self-learners spend hours scrubbing through lectures and talks to find one point again. AI summaries
help, but you cannot tell which lines the video actually says. For deaf and hard-of-hearing viewers the problem is
sharper: a written version is often the main way in, so it has to be right. We wanted notes you can check in one
click.

## What it does
Paste a YouTube link or upload a video. VidMind writes the notes as a short article. Every point carries a ✓ time
link: click it and the video plays that second; hover it to see the words that were quoted. Notes the video does
not support are removed and listed at the end with the reason ("Removed: N claims").

- **On screen** goes slide by slide: what the notes say, what was said, and the text on the screen.
- **How it was made** shows this run's numbers: time to the first note, time to all notes, % proven, dropped
  notes with reasons, every step, and a chart.

## How we built it
Every model call goes to Meta:

- **Muse Voice Transcribe 1.0** turns speech into text when a video has no captions. Audio is sped up 2x and cut
  into 3 s pieces that run in one pool.
- **Muse Spark 1.2 and 1.3** write the notes for each section. Both get every section at once and the first
  checked answer wins. Spark also writes the title, takeaways and diagram, reads the keyframes, and adds on-screen
  notes.
- **SAM 3.1** finds diagrams in keyframes and crops them.
- **Muse Image 1.0** makes a summary card. Its text is read back and checked before the card is shown.

The backend is FastAPI (Python, uv); the frontend is Next.js. Media processing is open source: ffmpeg, PyAV and
yt-dlp. Notes stream to the page over server-sent events as they are written, and each one is checked before it
is sent.

**The check.** A quote must fuzzy-match the transcript within seconds of the time it cites; near misses are
replaced by the transcript's actual words. A screen citation must hit a real keyframe within ±2 s. If fewer than
half of a section's notes pass, Spark gets one repair round. Whatever still fails is dropped and listed with the
reason.

## Challenges we ran into
- **We were transcribing the wrong audio.** For some videos YouTube served an AI-dubbed track. We now take
  YouTube's captions of the original audio track.
- **Speech recognition hits a throughput limit.** Muse Voice Transcribe takes about 4 s per 10 minutes of audio
  however many pieces run at once. Sending speech at 2x helped. Going faster did not: word error was 4.5-5.0% at
  2x, 7.4-7.7% at 2.5x and 17-19% at 3x.
- **Images slow the notes down.** Sending keyframes with every notes call added 0.6 s per call. Notes are now
  text-only, and one separate pass reads the keyframes and adds checked on-screen notes.
- **Strict checks drop good notes.** Paraphrased quotes failed the check. Snapping near-miss quotes to the
  transcript's words kept them without loosening the rule.

## Accomplishments that we're proud of
Measured on one 10-minute English talk on an M2 MacBook Air:

- YouTube link with captions, start to all checked notes: **4.2-5.1 s** over 4 runs (3 under 5 s). It started
  at 16.9 s.
- Any video without captions (Muse speech recognition): **9.0-9.4 s** on a warm server. First notes on screen in
  **4.0-6.5 s** over 6 runs.
- Keyframe-only scene scan: 0.36-0.48 s instead of 6.22 s. Audio decode in 4 parallel ranges: 0.31 s instead of
  0.81 s.
- Benchmarked 11 audio methods, 12 keyframe methods and 12+ speech engines before choosing.
- The bundled sample, a real Muse run of a 4:44 lecture: 18 of 18 notes checked, none dropped.

## What we learned
- Showing what was dropped builds more trust than any claim of accuracy.
- With a throughput-bound speech model, speed comes from how you cut and send the audio, not from more parallel
  calls.
- Measure first. A faster speech engine (Groq Whisper turbo, 1.1 s) existed, but it is not a Meta model, so we
  made Muse fast enough instead (4.8 s, 3.9% word error).

## What's next
- Deploy it with a public link.
- Measure on more videos, languages and machines; today's numbers come from one laptop and one talk.
- Captions export for deaf and hard-of-hearing viewers, with each line linked to its second.
- Notes from several videos in one course, checked the same way.

## Built with
Muse Spark 1.2, Muse Spark 1.3, Muse Voice Transcribe 1.0, Muse Image 1.0, SAM 3.1, Python, FastAPI, uv,
Next.js, React, TypeScript, ffmpeg, PyAV, yt-dlp.

---

## Judging criteria map

| Criterion | Track | Where it is answered |
|---|---|---|
| Creativity | Indie | Inspiration (a named user; notes you can check in one click); What it does (✓ time links, removed claims shown) |
| Technical ambition | Indie | How we built it (five Meta models, two Spark versions per section, streaming checked notes); Challenges (2x speech, original audio track) |
| Does it work | Indie | Accomplishments (measured times, run counts, sample run 18 of 18); README benchmark table |
| Execution | Startup | How we built it, "The check" (repair round, dropped notes listed); Challenges (fallback from images to a separate on-screen pass) |
| Production readiness | Startup | README Known limits (YouTube rate limit falls back to speech recognition; one laptop; not deployed); What's next; tests in README |
