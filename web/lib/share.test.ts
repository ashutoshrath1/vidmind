import assert from "node:assert/strict";
import { test } from "node:test";
import { expiresAt, proofLink } from "./share.ts";

test("expiry: 24 hours after creation unless kept longer; a keep shorter than that changes nothing", () => {
  const created = 1_800_000_000;
  assert.equal(expiresAt(created), (created + 86400) * 1000);
  assert.equal(expiresAt(created, null), (created + 86400) * 1000);
  assert.equal(expiresAt(created, created + 30 * 86400), (created + 30 * 86400) * 1000);
  assert.equal(expiresAt(created, created + 60), (created + 86400) * 1000);
});

test("proof link opens the read-only view", () => {
  assert.equal(proofLink("https://vidmind.app", "sample"), "https://vidmind.app/jobs/sample?view=proof");
});
