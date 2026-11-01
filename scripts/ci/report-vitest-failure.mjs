#!/usr/bin/env node
/**
 * Publish a bounded Vitest failure excerpt as a GitHub annotation.
 *
 * Release artifacts can be unavailable to reviewers due to the separate
 * Actions artifact host. The job annotation API remains available and makes
 * the failing test title/assertion/stack visible without weakening the test
 * gate. This helper is diagnostic only: it never changes the suite verdict.
 */
import { readFileSync } from "node:fs";

const ANSI = /\u001b\[[0-9;]*m/g;
const MAX_CHARS = 6000;

export function failureExcerpt(text, limit = MAX_CHARS) {
  const plain = String(text).replace(ANSI, "").replace(/\r/g, "");
  const lines = plain.split("\n");
  // Vitest prints the failed test and its assertion/stack immediately before
  // the final test summary. Keep a bounded tail so the excerpt is useful even
  // when reporter formatting changes, without emitting unrelated setup logs.
  const relevant = lines.slice(-80).join("\n").trim();
  if (!relevant) return "No Vitest output was captured.";
  if (relevant.length <= limit) return relevant;
  return `[excerpt truncated to ${limit} characters]\n${relevant.slice(-limit)}`;
}

export function workflowCommandMessage(text) {
  return String(text)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function main(argv) {
  const path = argv[2];
  if (!path) {
    console.log("::notice title=Vitest diagnostics::No log path supplied; the original test failure remains unchanged.");
    return;
  }

  try {
    const excerpt = failureExcerpt(readFileSync(path, "utf8"));
    console.log(`::error title=Vitest failure details::${workflowCommandMessage(excerpt)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown read error";
    console.log(`::notice title=Vitest diagnostics::Could not read captured output: ${workflowCommandMessage(message)}`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main(process.argv);
