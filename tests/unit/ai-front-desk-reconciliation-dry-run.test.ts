/**
 * Reconciliation dry-run classification (P0, "identify existing unpaid records marked LIVE").
 *
 * The audit script itself needs a database connection, which this environment does not have.
 * Its classification rules are a separate module precisely so they can be proven here, without a
 * connection and without touching any row: the same rules decide what the dry run reports.
 */

import { describe, expect, it } from "vitest";
// Plain ESM helper module shared with scripts/audit/*.mjs (untyped by design: it runs under node).
import {
  AI_PLAN_KEY,
  evaluate,
  operationalStatusFromSnapshot,
  parseArgs,
  reconciliationPlan,
} from "../../scripts/audit/ai-front-desk-live-status-rules.mjs";

const now = Date.parse("2026-10-26T09:00:00Z");
const future = new Date(now + 20 * 86_400_000).toISOString();
const past = new Date(now - 86_400_000).toISOString();

const paidActive = {
  planKey: AI_PLAN_KEY,
  hasPaidPayment: true,
  subscription: { status: "ACTIVE", expiresAt: future, graceUntil: null },
  entitlement: { status: "ACTIVE" },
};

describe("dry-run classification", () => {
  it("flags a published, switched-on desk with no paid subscription as incorrectly LIVE", () => {
    const result = evaluate({
      isPublished: true,
      operationalStatus: "LIVE",
      subscription: null,
      entitlement: { status: "PENDING" },
      planKey: AI_PLAN_KEY,
      hasPaidPayment: false,
      now,
    });
    expect(result.incorrectlyLive).toBe(true);
    expect(result.derivedState).toBe("SUSPENDED");
  });

  it("flags an expired subscriber whose stored switch still says LIVE", () => {
    const result = evaluate({
      isPublished: true,
      operationalStatus: "LIVE",
      subscription: { status: "EXPIRED", expiresAt: past, graceUntil: null },
      entitlement: { status: "EXPIRED" },
      planKey: AI_PLAN_KEY,
      hasPaidPayment: true,
      now,
    });
    expect(result.incorrectlyLive).toBe(true);
    expect(result.derivedState).toBe("SUSPENDED");
  });

  it("flags a cheaper plan that never bought the AI package", () => {
    const result = evaluate({
      isPublished: true,
      operationalStatus: "LIVE",
      subscription: { status: "ACTIVE", expiresAt: future, graceUntil: null },
      entitlement: null,
      planKey: "MONTHLY",
      hasPaidPayment: true,
      now,
    });
    expect(result.incorrectlyLive).toBe(true);
    expect(result.entitled).toBe(false);
  });

  it("does not flag a legitimate paid subscriber", () => {
    const result = evaluate({ isPublished: true, operationalStatus: "LIVE", now, ...paidActive });
    expect(result.incorrectlyLive).toBe(false);
    expect(result.derivedState).toBe("LIVE");
    expect(result.publiclyOperational).toBe(true);
  });

  it("respects an existing grace window and never invents one", () => {
    const inGrace = evaluate({
      isPublished: true,
      operationalStatus: "LIVE",
      subscription: { status: "ACTIVE", expiresAt: past, graceUntil: future },
      entitlement: { status: "ACTIVE" },
      planKey: AI_PLAN_KEY,
      hasPaidPayment: true,
      now,
    });
    expect(inGrace.entitled).toBe(true);

    const noGrace = evaluate({
      isPublished: true,
      operationalStatus: "LIVE",
      subscription: { status: "ACTIVE", expiresAt: past, graceUntil: null },
      entitlement: { status: "ACTIVE" },
      planKey: AI_PLAN_KEY,
      hasPaidPayment: true,
      now,
    });
    expect(noGrace.entitled).toBe(false);
  });

  it("does not flag an unpublished draft, however the switch was left", () => {
    const result = evaluate({
      isPublished: false,
      operationalStatus: "LIVE",
      subscription: null,
      entitlement: null,
      planKey: null,
      hasPaidPayment: false,
      now,
    });
    expect(result.derivedState).toBe("DRAFT");
    expect(result.publiclyOperational).toBe(false);
    // Still an inconsistent stored switch — the label fix is the derived state above.
    expect(result.incorrectlyLive).toBe(true);
  });

  it("survives a corrupt or missing config snapshot by treating it as DRAFT", () => {
    expect(operationalStatusFromSnapshot(null)).toBe("DRAFT");
    expect(operationalStatusFromSnapshot("{not json")).toBe("DRAFT");
    expect(operationalStatusFromSnapshot(JSON.stringify({ operationalStatus: "live" }))).toBe("LIVE");
  });
});

describe("dry-run tooling refuses to write", () => {
  it("has no apply mode", () => {
    expect(() => parseArgs(["--apply"])).toThrow(/owner authorisation/i);
  });

  it("defaults to a bounded, read-only report", () => {
    expect(parseArgs([])).toEqual({ json: false, limit: 100, help: false });
    expect(parseArgs(["--json", "--limit", "5000"]).limit).toBe(1000);
    expect(() => parseArgs(["--limit", "0"])).toThrow();
  });

  it("describes each reconciliation step with its data-change scope", () => {
    const plan = reconciliationPlan({ incorrectlyLive: 3, withPaymentHistory: 1 });
    expect(plan).toHaveLength(4);
    expect(plan[0].dataChange).toBe("none (review only)");
    expect(plan[2].dataChange).toBe("none (server-derived)");
    expect(plan[3].dataChange).toContain("NOT performed by this script");
  });
});
