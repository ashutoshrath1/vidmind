# Plan: what the submission promises and VidMind does not do yet (Oct 27, 2026)

Re-checked against the code: Learn mode, Muse Voice Transcribe, scene-change keyframes, Muse Spark notes and
timestamps all exist. These are missing:

| # | Gap | Build | Muse cost |
|---|---|---|---|
| 1 | No mode detection | The overview call (already one per video) also returns `mode`: learn, meet or test | none extra |
| 2 | No Meet mode | One Spark call over the whole transcript and screen text → decisions and actions (owner, deadline), each with evidence. They pass the same evidence check as notes (wrapped as notes, so `ground()` is reused unchanged) | ~$0.01 a video |
| 3 | No Jira or Slack | "Copy for Slack" (formatted message) and "Download Jira CSV" (Jira's CSV importer). No tokens or OAuth needed | none |
| 4 | No Test mode | One Spark call → scenarios, each step with evidence, plus a Playwright test file per scenario. Steps are checked like notes | ~$0.01 a video |
| 5 | No SAM 3.1 | Each keyframe goes to `sam-3.1` with "screen"; the largest box is cropped, then OCR and Spark see the crop. Uses Meta's API directly (no Modal needed) | $0.0025 a frame, ≤12 a video |
| 6 | No Muse Image card | One `muse-image-1.0` card from the title, summary and checked notes; shown above the notes, downloadable | $0.01 a video |
| 7 | Hinglish untested | `languageBias: ["English", "Hindi"]` on Muse transcription; test on a generated Hindi/English clip | <$0.01 |
| 8 | Evaluation | `scripts/eval_modes.py`: action-item F1 on a generated meeting with a known answer key; Playwright pass rate of generated tests run against the demo app they were made from; minutes saved per hour of video | ~$0.10 a run |

Order: 1 → 2 → 3 → 4 → 6 → 5 → 7 → 8, then the UI (mode badge, Actions tab, Tests tab, card), then tests.

Not in this pass: sending the raw video to Spark instead of keyframes, real Jira/Slack API posting (needs the
user's tokens), speaker names from diarization.

## Result (Oct 27, measured with `scripts/eval_modes.py` on `scripts/fixtures`)

| Promise | Status | Measured |
|---|---|---|
| Mode detection | Done (overview call) | meeting → meet, demo → test, lecture → learn |
| Meet: decisions, owners, deadlines | Done, every item evidence-checked | action-item F1 **1.0** (5/5, incl. one shown only on a slide) |
| Jira / Slack | Done as "Copy for Slack" and "Download Jira CSV" (web test covers both) | — |
| Test: scenarios + Playwright | Done, steps evidence-checked | **3/3** generated tests pass against the recorded app |
| SAM 3.1 | Done: crops the screen out of each keyframe (left whole when the frame already is the screen) | ~0.7 s a frame, in parallel |
| Muse Image card | Done; tools off, text read back by OCR and dropped unless every line matches | ~10 s, $0.01 |
| Hinglish | Muse transcription with `languageBias` English+Hindi | transcribed correctly, in Devanagari script |
| Minutes saved per hour | Measured on the 5-min lecture | **47 min** (fixtures under a minute read as long as they play) |

Fixed along the way: keyframe picking dropped the scene cuts it found on short videos; Muse ASR now uses
DIARIZATION turns (meeting quotes were all stamped 0:05, now at each speaker change); Muse Image invented
features with web search on.

Still open: raw video to Spark, real Jira/Slack posting, speaker names, a real (not synthetic) meeting and demo
in the eval set, and the card adding ~10 s before a job reports done.
