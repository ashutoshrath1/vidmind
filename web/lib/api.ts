export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const MAX_UPLOAD_MB = 2048;
export const MAX_MINUTES = 12 * 60;

export type Evidence =
  | { kind: "transcript"; start_seconds: number; quote: string }
  | { kind: "frame"; start_seconds: number; text: string; frame_url: string | null };

export type Note = { text: string; evidence: Evidence[]; uncertain: boolean; uncertain_reason: string | null };
export type Chapter = {
  title: string;
  start_seconds: number;
  notes: Note[];
  summary: string;
  key_terms: string[];
  cover_url: string | null;
};
export type QuizItem = { question: string; answer: string; evidence_start_seconds: number };
// A study flashcard; the server keeps it only if source_note is a checked note and start_seconds one of its seconds.

export type LearnResult = {
  title: string;
  chapters: Chapter[];
  quiz: QuizItem[];
  source: "live" | "precomputed";
  tldr: string;
  duration_seconds: number;
  transcriber: string;
  model: string;
  dropped_notes: number;
  youtube_id?: string | null;
  notes_checked?: number;
  citations_rechecked?: number;
  rejected?: Rejected[];
  mode?: "learn" | "meet" | "test";
  actions?: Action[]; // meet mode
  scenarios?: Scenario[]; // test mode
  card_url?: string | null; // summary card from the image model, its text checked against the result
  takeaways?: Note[];
  diagram?: Diagram | null;
  questions?: string[]; // the model's suggestions for Ask the video
  pending?: boolean; // notes done; title, takeaways and diagram still being written
};

export type Action = Note & { kind: "decision" | "action"; owner: string | null; deadline: string | null };
export type DiagramNode = Note & { id: string };
export type Diagram = {
  kind: "architecture" | "flowchart" | "sequence";
  title: string;
  nodes: DiagramNode[];
  edges: { source: string; target: string; label: string }[];
};
export type Scenario = { title: string; steps: Note[]; playwright: string };
export type Rejected = { text: string; reasons: string[] };

export type JobStatus = {
  id: string;
  status: string;
  error: string | null;
  source_url?: string;
  source_title?: string | null;
  sections_done?: number;
  sections_total?: number;
  created_at?: number;
  shared?: boolean; // reused by someone who added the same video, so it can't be deleted
  server_time?: number; // sent with each event, to line the server's clock up with this browser's
};

export const jobUrl = (id: string) => `${API_URL}/jobs/${id}`;

/** "groq:openai/gpt-oss-120b" → "gpt-oss-120b"; the host goes in a separate label. */
export const modelName = (id: string) => id.split(":").pop()!.split("/").pop()!;
export const modelHost = (id: string) => (id.includes(":") ? id.split(":")[0] : "");

/** Elapsed or remaining seconds, e.g. "4.2 s" or "1 min 05 s". */
export function formatSeconds(s: number) {
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;
}

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
