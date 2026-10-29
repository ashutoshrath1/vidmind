# Muse latency research

Researched 2026-10-29. No Muse API calls were made. "Unverified" marks claims I could not confirm from a primary source.

## Summary

- The file endpoint `POST /v1/asr/transcribe` can **stream its result** as server-sent events (`Accept: text/event-stream`), with turns arriving while the audio is processed. VidMind can start Spark section calls as soon as each turn or piece lands instead of waiting for all ~100 pieces. ([speech-to-text docs](https://dev.meta.ai/docs/speech-to-text#transcribe-accept))
- The transcription limit is **256 concurrent streams and 16,000 streams per hour per team**, shared between realtime and file mode. A 429 means you hit it. ([pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits#rate-limits), [speech-to-text rate limits](https://dev.meta.ai/docs/speech-to-text#rate-limits)) Today's ~100 pieces are under the concurrency cap, so fewer, longer pieces will not unlock more parallelism. Note that 16,000/hour is about 160 videos per hour at 100 pieces each.
- **Muse Spark accepts audio directly** (MP3 or WAV) and video (MP4), and can transcribe speech itself. That opens a route that skips Voice Transcribe and keeps everything on Muse. ([video and audio understanding](https://ai.developer.meta.com/docs/features/video-understanding/)) Whether it is faster, and how good its timestamps are, is unverified.
- **Prompt caching is automatic prefix caching.** It cuts time to first token when the stable prefix comes first. ([prompt caching](https://dev.meta.ai/docs/prompt-caching))
- Chat completions supports streaming. The API reference points to the feature page for streaming usage. ([chat completions reference](https://dev.meta.ai/docs/api-reference/chat-completions), [chat completion guide](https://dev.meta.ai/docs/protocols/chat-completions))
- I found **no** priority or low-latency tier, regional endpoint, or batch API in the docs I read. Voice Transcribe accepts **WAV/PCM only** (no Opus, FLAC or MP3).

## 1. Meta Muse / Model API capabilities

| Capability | Status | Source |
|---|---|---|
| Realtime streaming ASR (WebSocket `wss://api.meta.ai/v1/asr/realtime`) | Yes, but you must **pace audio at about real time** and stay no more than 5 s ahead. That makes it useless for speeding up recorded files: 10 minutes of audio takes about 10 minutes. | [speech-to-text: migrate](https://dev.meta.ai/docs/speech-to-text#migrate), [limits](https://dev.meta.ai/docs/speech-to-text#limits) |
| File transcribe with streamed partials (SSE) | Yes, with `Accept: text/event-stream`. Events are `transcript` (partial) and `speechComplete` (final turn), and they include `audioProcessedMs`. | [transcribe-accept](https://dev.meta.ai/docs/speech-to-text#transcribe-accept), [endpointing](https://dev.meta.ai/docs/speech-to-text#endpointing) |
| File limits | 32 MB body (413), 10 min of audio (400), mono 16-bit PCM WAV at 16 or 24 kHz (400 otherwise). Server budget exceeded gives 500. | [transcribe-limits](https://dev.meta.ai/docs/speech-to-text#transcribe-limits) |
| Compressed audio to Voice Transcribe | No. WAV/PCM only. "Decode WAV, MP3, Opus... before streaming." | [migrate](https://dev.meta.ai/docs/speech-to-text#migrate), [launch blog](https://dev.meta.ai/resources/blog/meet-muse-voice-transcribe-streaming-speech-to-text) |
| Compressed audio to Spark | Yes, MP3 and WAV for audio understanding, MP4 for video. | [video-understanding formats](https://ai.developer.meta.com/docs/features/video-understanding/) |
| Voice Transcribe output | Turn-level timestamps only. No word-level timestamps. | [models: Muse Voice Transcribe](https://dev.meta.ai/docs/models#muse-voice-transcribe) |
| Concurrency (ASR) | 256 concurrent streams, 16,000 per hour, per team, shared by both endpoints | [rate limits](https://dev.meta.ai/docs/pricing-rate-limits#rate-limits) |
| Concurrency (Spark 1.2 / 1.3) | 3,000 RPM and 4M TPM each, per team. The limits are per model, so 1.2 and 1.3 have separate budgets. | [rate limits](https://dev.meta.ai/docs/pricing-rate-limits#rate-limits) |
| Streaming chat output | Supported (`stream`). The API reference links to the guide for streaming. I did not check the exact event schema. | [chat completions ref](https://dev.meta.ai/docs/api-reference/chat-completions), [guide](https://dev.meta.ai/docs/protocols/chat-completions) |
| Prompt caching | Automatic prefix caching with no flag. Put stable content first. Check `cached_tokens`. The minimum prefix length and time to live are **not documented** in what I read. | [prompt caching](https://dev.meta.ai/docs/prompt-caching) |
| Batch API, priority tier, regional endpoints | Not found. Unverified absence. LiteLLM says Voice has no batch endpoint (it predates the file endpoint, so it is stale). | [LiteLLM Meta provider](https://docs.litellm.ai/docs/providers/meta) |
| Spark latency guidance | None found beyond `reasoning_effort` ("minimal" to "xhigh") and the note that caching cuts time to first token. `logprobs` returns 400. | [LiteLLM](https://docs.litellm.ai/docs/providers/meta), [prompt caching](https://dev.meta.ai/docs/prompt-caching) |

Third-party coverage repeats the 10 min / 32 MB file limit and the 60-minute realtime session limit. It cites an older limit of 128 concurrent streams; Meta's page now says 256. ([Kingy AI](https://kingy.ai/blog/meta-muse-voice-transcribe-guide/))

## 2. How fast summary products do it

I found no first-party engineering posts for Eightify, NoteGPT, Glasp, Otter, Fireflies, Descript, or Gemini-in-YouTube in this pass. Everything below is from product pages or is general practice, and is **unverified** as their internals.

- **Caption reuse.** Eightify and NoteGPT advertise instant transcript fetching for YouTube, which means reusing existing captions rather than running ASR. ([Eightify transcript page](https://eightify.app/transcript-of-youtube-video), [NoteGPT summarizer](https://notegpt.io/youtube-video-summarizer)) VidMind already does this.
- **Progressive rendering and streaming tokens.** These tools display the summary as it streams. That is observed UX, not documented.
- **Live transcription.** Otter and Fireflies transcribe during the meeting, so the transcript already exists when the meeting ends. That does not apply to an uploaded file.

## 3. Recommendations for VidMind (ranked)

1. **Pipeline per piece. Do not run two phases.** Fire each Spark section call as soon as the ASR pieces covering that section return, instead of after all ~100. Expected effect: the first section shows at about (slowest piece in that section, ~1-2 s) + Spark (~4.2 s), so **about 5-6 s to first notes**. The total also drops, because the ASR tail overlaps with Spark. To verify, log `t_first_section_rendered` and `t_all` on the 10-minute test video.
2. **Stream Spark output to the UI** (`stream=true`, then SSE to Next.js). This cuts perceived time to first notes by most of the 4.2 s generation time. To verify, measure time to first token against time to full response per call.
3. **Use the file endpoint's SSE mode** (`Accept: text/event-stream`). Then `speechComplete` turns can feed recommendation 1 before a piece's request even finishes. Expected effect: small (pieces are only 6 s long), so try it after 1. To verify, compare the first `speechComplete` arrival with the JSON response time.
4. **Prompt prefix order.** Put the fixed system prompt and instructions first and the transcript last, identical across all 12 section calls. Expected effect: lower time to first token on calls 2-12. To verify, `usage.cached_tokens` > 0.
5. **Experiment: Spark direct audio** (send MP3 of the section to Spark and ask for notes plus timestamps, skipping Voice Transcribe). This could remove the ASR phase entirely, a possible total of ~4-5 s. The risks are the quality of timestamps and evidence and token cost. To verify, A/B on 3 videos for latency, timestamp accuracy and cost.
6. **Split Spark load across 1.2 and 1.3.** They have separate rate-limit budgets. This only helps if you see 429s (unlikely at 12 calls).
7. **Do not** switch to realtime WebSocket (real-time pacing) or compress audio for ASR (not supported).

## Open questions

- Prompt cache minimum prefix length and time to live.
- The exact chunk schema for Spark streaming, and whether `reasoning_effort: minimal` still delays the first token.
- Spark audio-understanding: max duration and size per request, and timestamp precision.
- Whether any region or priority tier exists. Ask Meta at the hackathon.
- Spark latency for the same prompt on 1.2 and 1.3.

## Sources

- https://dev.meta.ai/docs/speech-to-text
- https://dev.meta.ai/docs/pricing-rate-limits
- https://dev.meta.ai/docs/models
- https://dev.meta.ai/docs/prompt-caching
- https://dev.meta.ai/docs/api-reference/chat-completions
- https://dev.meta.ai/docs/protocols/chat-completions
- https://ai.developer.meta.com/docs/features/video-understanding/
- https://dev.meta.ai/resources/blog/meet-muse-voice-transcribe-streaming-speech-to-text
- https://docs.litellm.ai/docs/providers/meta (third party)
- https://kingy.ai/blog/meta-muse-voice-transcribe-guide/ (third party)
- https://eightify.app/transcript-of-youtube-video, https://notegpt.io/youtube-video-summarizer (product pages)
