const RETENTION_S = 24 * 3600; // jobs.RETENTION_S on the server

/** When the server deletes the job, in ms: 24 hours after creation, or later if it was kept (as jobs.sweep decides). */
export const expiresAt = (createdAt: number, keepUntil?: number | null) => Math.max(createdAt + RETENTION_S, keepUntil ?? 0) * 1000;

/** The read-only proof view of a job, for sharing. */
export const proofLink = (origin: string, id: string) => `${origin}/jobs/${encodeURIComponent(id)}?view=proof`;
