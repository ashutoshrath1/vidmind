# What wins AI hackathons, and what it means for VidMind

Researched 2026-10-29. "UNVERIFIED" marks claims I could not confirm from a primary source.

## Summary

- Judges watch the demo video first and use it to decide how much time the project deserves. A short, scripted video that shows the product running matters more than slides.
- Big AI competitions score on several separate criteria (Gemini: impact, remarkability, creativity, usefulness, execution). Weak spots on one criterion cost more than extra points on another. If two entries tie, the video decides.
- Meta's winners solved one concrete, painful problem and made the model's job visible (OrgLens, CCTV Operator, Geo-ML).
- For VidMind, "every point links to the exact second and is checked" is the creative and technical hook. The video and the result page should make that check something people can see and click, not just a claim.

## Findings

### 1. What the winners had in common

- LlamaCon Hackathon 2025 (238 developers, 24 h, $35k): the task was "a demonstrable project" on the Llama API. The winners were OrgLens (expert matching from a knowledge graph), Compliance Wizards (fraud detection plus a voice assistant), Llama CCTV Operator (plain-language surveillance events using Llama 4 vision) and Geo-ML (400-page reports turned into 3D models; Best API Usage). [Meta AI blog]
- Every winner tied the model's ability to a specific job and a specific user. The CCTV and Geo-ML winners showed a multimodal or long-context feature doing something you can see. [Meta AI blog; HackWinners OrgLens page]
- Judges praised OrgLens for its "practical value… a common pain point as organizations grow" (from a third-party winners gallery, not a judge's own words; treat as secondary). [HackWinners]
- Gemini API Developer Competition winners (Jayu, Vite Vere, Outdraw AI, Prospera, ViddyScribe…): each named a clear user (people with cognitive disabilities, ALS patients, sales reps, blind viewers of video). ViddyScribe, a video-accessibility app, won Best Web App. [Google Developers Blog]
- Llama 4 NYC/Seattle and Llama Impact winners: I found only Meta's Facebook announcement for Seattle and could not get the details. UNVERIFIED.
- Live vs recorded: Devpost's online judging relies on a recorded video of about 3 minutes. Judges say they "watch the video to get context and then use that for testing the submission." [Devpost judges post; Devpost demo-video post]

### 2. What judges reward and penalise

- The demo video is "one of the first things that judges will look at" and runs about 3 minutes. [Devpost demo-video post]
- Judge Richard: the video "becomes crucial in giving us our first indicator of how much time was invested." Judge Karen: "Presentation and storytelling matters." [Devpost judges post]
- Judges reward balance across criteria, creativity, user experience, enough technical detail and a founder's mindset. They penalise leaning too hard on one criterion, thin technical detail and rehashed ideas. [Devpost judges post]
- Winners' advice on the video: write the script yourself ("avoid ChatGPT… too generic"); open with the pitch and the problem; show the product running on real input; "no slide shows/decks"; "key info upfront" in the first 2-3 minutes; don't speed up the audio; use good sound; on YouTube, mark the video "Not made for kids" so judges can view it. [Devpost demo-video post]
- Gemini competition rubric (65 points): Impact; Remarkability ("surprising to those well-versed in LLMs" and to those who are not); Creativity (differs from known apps in function and UX); Usefulness (a defined user persona, specific needs); Execution (software engineering and LLM best practices). Ties go to "overall video impact." [Google AI forum post quoting the official rules]
- Recent Devpost AI hackathons also grade the README and an architecture diagram as their own items. [Devpost "All Things Agentic" judging Q&A video]
- Meta 2026: dates confirmed (submissions close Nov 5, judging Nov 5-9, finals Nov 10; two tracks: indie and startup). The official page (dev.meta.ai/events/global-hackathon) could not be fetched, so the criteria wording in the brief (creativity, technical ambition, works; production readiness) is UNVERIFIED here. Re-read the official rules before you submit. [Internshala listing]

### 3. Making trust and grounding visible (inference from the above)

- "Remarkability" and "execution / LLM best practice" both reward checks a judge can see. A hallucination guard nobody sees scores nothing. An on-screen "dropped 3 unsupported claims" with the reasons scores on both criteria. This is my inference, not a quote.

## Recommendations (ranked)

### Result page
1. **Notes tab: put the check on screen.** Each point gets a timestamp chip that seeks the embedded player, plus a small "checked" mark. Hovering or tapping it shows the transcript line or keyframe that supports the point.
2. **Show what was dropped.** Add a collapsed "Removed: N claims not supported by the video" list with the reasons. This is the cheapest proof that grounding is real (Remarkability and Execution).
3. **Show time-to-first-note on screen.** A small live timer ("first note 4.3 s · done 5.0 s") while notes stream in, so the speed shows in the video without anyone narrating it.
4. **How it was made: real numbers from this run, not a generic diagram.** A per-stage waterfall (fetch, Voice Transcribe, Spark, check) with ms and the Muse model used at each step. Judges in this hackathon must see the Muse models being used.
5. **On screen tab:** pair each keyframe with its timestamp and the notes it supports, so the link to slides is clear.
6. Polish: one readable article style, a mobile layout, no debug JSON. Judges also test the app themselves after watching. [Devpost judges post]

### Submission
7. **Demo video (≤3 min, recorded, unedited speed):** 0-10 s show the problem (a 40-minute lecture, scrubbing). 10-30 s paste a URL, the timer runs, and notes appear in about 5 s, all in one take with no cuts. Then click a timestamp to jump to that exact second. Then show a dropped claim. Then the How it was made tab. End with who it is for. No slide deck, real voice, a script you wrote yourself. [Devpost demo-video post]
8. **First 30 seconds = the whole pitch.** If a judge stops there, they have already seen speed, timestamps and the check. [Devpost demo-video post: "key info upfront"]
9. **README:** a one-line pitch, a GIF, a live link, an architecture diagram naming each Muse model, a benchmark table (video length, route, first note, done, n runs, and hardware or network), how the check works, how to run it, and known limits. [Devpost Agentic Q&A video]
10. **Devpost page:** name a specific user (students, people watching talks, accessibility). Map each paragraph to a judging criterion, giving the indie track creativity and ambition and the startup track cost per video, failure handling and a reliability table. On YouTube, mark the video "Not made for kids". [Google AI forum rules; Devpost demo-video post]

## Sources

- Meta AI, "Meet the winners of our first-ever LlamaCon Hackathon": https://ai.meta.com/blog/llamacon-hackathon/
- HackWinners, OrgLens page (secondary): https://hackwinners.pages.dev/en/p/orglens/
- Meta for Developers, Llama 4 Seattle winners post (not fetched): https://www.facebook.com/MetaforDevelopers/posts/1134953121998355/
- Google Developers Blog, Gemini API Developer Competition winners: https://developers.googleblog.com/announcing-the-winners-of-the-gemini-api-developer-competition/
- Google AI Developers Forum (quotes the official rubric): https://discuss.ai.google.dev/t/do-we-need-to-submit-the-full-code-how-will-judges-verify-partial-code/33566
- Devpost, "How to win a hackathon: Advice from 5 seasoned judges": https://info.devpost.com/blog/hackathon-judging-tips
- Devpost, "6 Tips for making a winning hackathon demo video": https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video
- Devpost, "Understanding hackathon submission and judging criteria": https://info.devpost.com/blog/understanding-hackathon-submission-and-judging-criteria
- Devpost, "How to Win the All Things Agentic Hackathon" judging Q&A: https://www.youtube.com/watch?v=DCXjvKmUIGY
- Meta Global AI Developer Hackathon (official, could not fetch): https://dev.meta.ai/events/global-hackathon
- Internshala listing (dates, tracks): https://internshala.com/competitions/meta-global-ai-developer-hackathon-2026/
