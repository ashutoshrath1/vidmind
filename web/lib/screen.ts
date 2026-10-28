// The screen text vault: search, highlight and code detection over what OCR read on each keyframe.
// Relative .ts imports only: `node --test lib/*.test.ts` runs this file without the Next toolchain.
import { formatTime } from "./api.ts";

export type ScreenFrame = { at: number; url: string; text: string };
export type Piece = { text: string; hit: boolean };
export type Block = { code: boolean; text: string };

const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Frames whose text holds every word of the query, in any order and case. An empty query keeps every frame with text. */
export function searchFrames(frames: ScreenFrame[], query: string): ScreenFrame[] {
  const words = terms(query);
  return frames.filter((f) => f.text.trim() && words.every((w) => f.text.toLowerCase().includes(w)));
}

/** The text cut into plain and matched pieces, marking every occurrence of every query word. */
export function highlight(text: string, query: string): Piece[] {
  const words = terms(query).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return [{ text, hit: false }];
  // Longest first, so "spring cloud" marks "springcloud" whole rather than "spring" alone.
  const re = new RegExp(`(${words.sort((a, b) => b.length - a.length).join("|")})`, "gi");
  // split with one capture group alternates plain, match, plain...: odd pieces are the matches.
  return text.split(re).map((t, i) => ({ text: t, hit: i % 2 === 1 })).filter((p) => p.text);
}

const CODE = [
  /^\s*(\$\s+[a-z.\/~]|>>>\s|PS [A-Za-z]:\\[^>]*>|[\w.-]+@[\w.-]+:\S*[$#])/, // shell or REPL prompt ("$3700" is a price)
  /^\s*([$%>]\s*)?(sudo|npm|npx|yarn|pnpm|pip3?|uv|git|docker|kubectl|curl|wget|mvn|\.\/mvnw|gradle|\.\/gradlew|cargo|rustc|rustup|brew|apt(-get)?|cd|ls|mkdir|python3?|node|java)\s+[\w@./:~=-]/, // a command
  /\b(https?:\/\/|www\.)\S+|\blocalhost:\d+/i, // URL
  /(^|\s)(~|\.{1,2})?\/[\w.-]+\/[\w./-]*|\b[A-Za-z]:\\\w|\b[\w-]+(\/[\w.-]+)+\.[a-z]{1,5}\b|\b[\w-]+\/[\w-]+\/[\w./-]+/, // file path
  /(^|\s)[a-z_][\w-]*\.(rs|py|ts|tsx|jsx?|java|kt|go|rb|sh|c|cpp|h|cs|swift|ya?ml|toml|json|xml|sql|properties|env)\b/, // file name
  /[;{}]\s*$|^\s*}|=>|\w\.\w+\(.*\)|^\s*\.\w+\(|^\s*(@[A-Z]\w+|#\[)|\b[A-Z]\w*<[^<>]+>|<\/?[a-z][\w-]*(\s[^<>]*)?\/?>/, // code syntax
  /^\s*(pub\s+)?(def|function|class|interface|fn|struct|trait|impl|enum)\s+\w+\s*[({:<]|^\s*(const|let|var)\s+(mut\s+)?\w+\s*[=:]/, // definitions
  /^\s*(import|from|package|use)\s+[\w.@'"{*/:]+\S*\s*(;|$|import\b)|^\s*[\w-]+(\.[\w-]+)+\s*[=:]\s*\S/, // imports, dotted config keys
];

/** A line that reads as code, a command, a URL or a file path rather than prose. Editor line numbers are ignored. */
export const isCode = (line: string) => CODE.some((re) => re.test(line.replace(/^\s*\d{1,4}\s+(?=\S)/, "")));

/** Consecutive lines grouped into prose and code blocks; prose lines are joined with a dot, code keeps its lines. */
export function screenBlocks(text: string): Block[] {
  const blocks: { code: boolean; lines: string[] }[] = [];
  for (const line of text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim())) {
    const code = isCode(line);
    const last = blocks.at(-1);
    if (last?.code === code) last.lines.push(line);
    else blocks.push({ code, lines: [line] });
  }
  return blocks.map((b) => ({ code: b.code, text: b.lines.join(b.code ? "\n" : " · ") }));
}

/** Every frame's text under its timestamp, for the clipboard. */
export const screenText = (frames: ScreenFrame[]) =>
  searchFrames(frames, "").map((f) => `[${formatTime(f.at)}]\n${f.text.trim()}`).join("\n\n");
