// How long VidMind should take for a video, before it starts. Rates measured on an M2 Air with Groq first in the
// model pool (Oct 2026); other machines and providers differ, so the UI always says "about".
// No imports: `node --test lib/*.test.ts` runs this without the Next toolchain.

export type Estimate = { transcript: number; frames: number; notes: number; total: number };

/** duration in seconds; height of the video in pixels (720 when unknown); subtitles: the video brings its own. */
export function estimate({ duration, height = 720, subtitles = false }: { duration: number; height?: number; subtitles?: boolean }): Estimate {
  // Parakeet: 2.5 s per 100 s of speech; 3 s per 100 s leaves room for whisper on other machines.
  const transcript = subtitles ? 0 : 0.03 * duration;
  // Scene detection decodes every frame: 3.8 s for 316 s of 720p, growing with pixel count. Then 12 grabs + OCR, ~3 s.
  const frames = 0.012 * (Math.max(height, 360) / 720) ** 2 * duration + 3;
  // The last section's notes start once its transcript and the keyframes are ready; Groq takes ~2-4 s a section.
  const notes = 4;
  return { transcript, frames, notes, total: Math.max(transcript, frames) + notes };
}
