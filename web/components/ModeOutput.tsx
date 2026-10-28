"use client";

import { type FormEvent, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import Icon from "@/components/Icon";
import { Proof as ProofLine } from "@/components/Proof";
import { Button, Chip, EvidenceChip, type Seek, inputClass } from "@/components/ui";
import { type LearnResult, type Note, formatTime, jobUrl } from "@/lib/api";
import { byDeadline, isSlackWebhook, shownAt, toJiraCsv, toReproSteps, toSlack, toTestSuite } from "@/lib/export";
import { proofLink } from "@/lib/share";

export function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

// `text` may be a function, for text that needs the page's address (unknown while rendering on the server).
function CopyButton({ text, label }: { text: string | (() => string); label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <Button type="button" variant="quiet" aria-live="polite" onClick={() => navigator.clipboard.writeText(typeof text === "function" ? text() : text).then(() => setDone(true))}>
      {done ? "Copied" : label}
    </Button>
  );
}

function Proof({ item, base, seek }: { item: Note; base: string; seek: Seek }) {
  const at = shownAt(item);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {at !== null && (
        <button type="button" onClick={() => seek(at)}
          className="hit inline-flex items-center gap-1.5 rounded-full bg-scan-soft px-2.5 py-0.5 text-xs font-semibold text-scan-ink hover:bg-scan hover:text-on-scan">
          <Icon name="watch" className="size-3.5" />
          Watch at {formatTime(at)}
        </button>
      )}
      {item.evidence.map((e, i) => <EvidenceChip key={i} evidence={e} base={base} seek={seek} />)}
    </div>
  );
}

const HOOK_KEY = "vidmind-slack-webhook";
const HOOK_CHANGED = "vidmind-slack-changed";
const readHook = () => { try { return localStorage.getItem(HOOK_KEY) ?? ""; } catch { return ""; } };

function storeHook(url: string) {
  try {
    if (url) localStorage.setItem(HOOK_KEY, url);
    else localStorage.removeItem(HOOK_KEY);
  } catch {} // private mode: the webhook works for this post, it just isn't remembered
  window.dispatchEvent(new Event(HOOK_CHANGED));
}

function subscribeHook(changed: () => void) {
  window.addEventListener(HOOK_CHANGED, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(HOOK_CHANGED, changed);
    window.removeEventListener("storage", changed);
  };
}

/** Posts the actions to a Slack channel through the person's own incoming webhook, kept only in this browser. */
function SlackPost({ jobId, children }: { jobId: string; children: ReactNode }) {
  const saved = useSyncExternalStore(subscribeHook, readHook, () => "");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const hook = saved || draft.trim();
  useEffect(() => () => setSaid(null), []); // the page stays alive in the background: come back to a clean form

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!isSlackWebhook(hook)) return setSaid({ ok: false, text: "Paste a webhook URL that starts with https://hooks.slack.com/services/" });
    setBusy(true);
    setSaid(null);
    try {
      const r = await fetch(`${jobUrl(jobId)}/actions/slack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhook: hook, origin: location.origin }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't post to Slack. Try again.");
      storeHook(hook);
      setDraft("");
      setSaid({ ok: true, text: `Posted ${body.posted} ${body.posted === 1 ? "item" : "items"} to Slack.` });
    } catch (err) {
      setSaid({ ok: false, text: err instanceof TypeError ? "Couldn't reach the server. Try again." : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={post} className="space-y-3">
      {saved ? (
        <p className="text-sm text-graphite">
          Posts to your saved Slack webhook.{" "}
          <button type="button" onClick={() => {
            storeHook("");
            // The button unmounts; hand focus to the input that replaces it, not to <body>.
            requestAnimationFrame(() => document.getElementById("slack-webhook")?.focus());
          }} className="hit underline underline-offset-4 hover:text-ink">
            Forget it
          </button>
        </p>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="slack-webhook" className="font-display text-sm font-semibold">Slack webhook URL</label>
          <input id="slack-webhook" type="url" inputMode="url" autoComplete="off" spellCheck={false} value={draft}
            onChange={(e) => setDraft(e.target.value)} placeholder="https://hooks.slack.com/services/…"
            aria-describedby="slack-webhook-help" className={inputClass} />
          <p id="slack-webhook-help" className="text-xs text-graphite">
            Create one in Slack with{" "}
            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
              Incoming Webhooks
            </a>{" "}
            and pick a channel. It stays in this browser only.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" working={busy} disabled={busy || !hook}>
          <Icon name="chat" />
          {busy ? "Posting" : "Post to Slack"}
        </Button>
        {children}
      </div>
      {said && (
        <p role={said.ok ? "status" : "alert"} className={`text-sm ${said.ok ? "text-proof" : "text-strike"}`}>{said.text}</p>
      )}
    </form>
  );
}

/** Meet mode: decisions and actions, each checked against the video, ready to post to Slack or import to Jira. */
export function Actions({ jobId, result, base, seek }: { jobId: string; result: LearnResult; base: string; seek: Seek }) {
  const items = result.actions ?? [];
  const slug = result.title.replace(/[^\w-]+/g, " ").trim() || "meeting";
  return (
    <div className="space-y-6">
      <SlackPost jobId={jobId}>
        <CopyButton text={toSlack(result)} label="Copy for Slack" />
        <Button type="button" variant="quiet" onClick={() => save(`${slug} actions.csv`, toJiraCsv(result), "text/csv")}>
          Download Jira CSV
        </Button>
      </SlackPost>
      {(["decision", "action"] as const).map((kind) => {
        const list = kind === "action" ? byDeadline(items.filter((a) => a.kind === kind)) : items.filter((a) => a.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind}>
            <h3 className="font-display text-lg font-semibold">{kind === "decision" ? "Decisions" : "Actions"}</h3>
            <ul className="mt-2 divide-y divide-rule">
              {list.map((a, i) => (
                <li key={i} className="space-y-2 py-4">
                  <p className="max-w-[70ch]">{a.text}</p>
                  {kind === "action" && (
                    <p className="flex flex-wrap gap-2">
                      <Chip tone={a.owner ? "proof" : "plain"}>{a.owner ?? "No owner named"}</Chip>
                      <Chip tone={a.deadline ? "scan" : "plain"}>{a.deadline ? `Due ${a.deadline}` : "No deadline said"}</Chip>
                    </p>
                  )}
                  <ul aria-label="Proof" className="space-y-2">
                    {a.evidence.map((e, j) => <ProofLine key={j} evidence={e} base={base} seek={seek} />)}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-sm text-graphite">
        Jira: Filters → Import issues from CSV.
      </p>
    </div>
  );
}

/** Test mode: one scenario per flow in the demo, steps checked against the video, and a Playwright test to run. */
export function Tests({ jobId, result, base, seek }: { jobId: string; result: LearnResult; base: string; seek: Seek }) {
  const slug = result.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "demo";
  const proof = () => proofLink(location.origin, jobId);
  const repro = () => toReproSteps(result, proof());
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => save(`${slug}.spec.ts`, toTestSuite(result, proof()), "text/plain")}>
          <Icon name="code" />
          Download test suite
        </Button>
        <CopyButton text={repro} label="Copy repro steps" />
        <Button type="button" variant="quiet" onClick={() => save(`${slug}-repro-steps.md`, repro(), "text/markdown")}>
          Download repro steps
        </Button>
      </div>
      {(result.scenarios ?? []).map((sc, i) => {
        const file = `${sc.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || `flow-${i + 1}`}.spec.ts`;
        return (
          <section key={i}>
            <h3 className="font-display text-lg font-semibold">{sc.title}</h3>
            <ol className="mt-2 list-decimal space-y-3 pl-6">
              {sc.steps.map((s, j) => (
                <li key={j}>
                  {s.text}
                  <Proof item={s} base={base} seek={seek} />
                </li>
              ))}
            </ol>
            <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-ink p-4 font-mono text-xs leading-relaxed text-lightbox">
              <code>{sc.playwright}</code>
            </pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyButton text={sc.playwright} label="Copy test" />
              <Button variant="quiet" onClick={() => save(file, sc.playwright, "text/plain")}>Download {file}</Button>
            </div>
          </section>
        );
      })}
      <p className="text-sm text-graphite">
        Run with <code className="font-mono">npx playwright test</code>, with <code className="font-mono">baseURL</code> set to
        your app. Locators use the text seen in the video.
      </p>
    </div>
  );
}

/** The Muse Image card. The server reads its text back and only keeps it if it matches the checked result. */
export function SummaryCard({ result, base }: { result: LearnResult; base: string }) {
  if (!result.card_url) return null;
  const src = `${base}/${result.card_url}`;
  return (
    <figure className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API host */}
      <img src={src} alt={`Summary card: ${result.title}`} className="w-full rounded-lg ring-1 ring-rule" />
      <figcaption className="flex items-center justify-between gap-3 text-xs text-graphite">
        <span>Its text was read back and matches the notes.</span>
        <a href={src} download className="hit shrink-0 underline underline-offset-4 hover:text-ink">Download</a>
      </figcaption>
    </figure>
  );
}
