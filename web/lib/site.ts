// Brand strings used in copy. A fork rebrands by setting these env vars; the hackathon build keeps the defaults.
export const MODEL_BRAND = process.env.NEXT_PUBLIC_MODEL_BRAND ?? "Meta's Muse models"; // "...reads every slide with {MODEL_BRAND}"
export const MODEL_FAMILY = process.env.NEXT_PUBLIC_MODEL_FAMILY ?? "Meta models"; // "4 {MODEL_FAMILY} on every video"
export const MODEL_API = process.env.NEXT_PUBLIC_MODEL_API ?? "Meta's Model API"; // where the video's text is sent

export type ModelCard = { icon: "spark" | "listen" | "frame" | "image"; name: string; does: string };
const DEFAULT_MODELS: ModelCard[] = [
  { icon: "spark", name: "Muse Spark", does: "Watches and hears each section, writes the notes, the diagram and the takeaways, and judges the web check" },
  { icon: "listen", name: "Muse Voice Transcribe", does: "Turns the speech into timed text, in 6-second pieces at once, so every quote can be checked" },
  { icon: "frame", name: "SAM 3.1", does: "Tracks the diagrams through the video, cropping them for the notes model" },
  { icon: "image", name: "Muse Image", does: "Draws a summary card, whose text is read back and must match the notes" },
];
// NEXT_PUBLIC_MODELS_JSON: a JSON array of {icon, name, does} replaces the four cards on the landing page.
export const MODEL_CARDS: ModelCard[] = (() => {
  try { return process.env.NEXT_PUBLIC_MODELS_JSON ? JSON.parse(process.env.NEXT_PUBLIC_MODELS_JSON) : DEFAULT_MODELS; } catch { return DEFAULT_MODELS; }
})();
