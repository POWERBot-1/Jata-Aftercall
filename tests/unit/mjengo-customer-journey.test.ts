/**
 * Regression tests for the MJENGO OS customer journey (issue #115):
 * public CTA → sign-in/registration → entitlement gate → purchase path → workspace.
 *
 * Defects reproduced and fixed:
 *  1. `/login?next=/dashboard/mjengo` discarded the destination; customers landed on /dashboard.
 *  2. A business that had never subscribed (status NONE) or had cancelled received HTTP 403 from
 *     the gate, and the workspace shell offers checkout only on 402 — a dead end with no purchase
 *     path from the public "Get MJENGO OS" CTA.
 *  3. A PAID-but-not-yet-activated payment must never be offered a second checkout.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Pure decision functions only; no database or session is consulted by these assertions.
vi.mock("@/lib/db", () => ({ default: {} }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => null) }));
import { postAuthNextToken, resolvePostAuthDestination } from "@/lib/post-auth-destination";
import { mjengoDenialStatus } from "@/lib/mjengo/access";
import { deriveMjengoEntitlement } from "@/lib/mjengo/entitlement";

describe("post-authentication destination allowlist", () => {
  it("returns MJENGO OS customers to the MJENGO entry after sign-in", () => {
    expect(resolvePostAuthDestination("mjengo")).toBe("/dashboard/mjengo");
    expect(resolvePostAuthDestination("/dashboard/mjengo")).toBe("/dashboard/mjengo");
    expect(resolvePostAuthDestination(["mjengo"])).toBe("/dashboard/mjengo");
  });

  it("refuses an ambiguous repeated next parameter", () => {
    expect(resolvePostAuthDestination(["mjengo", "control"])).toBe("/dashboard");
    expect(resolvePostAuthDestination(["agents", "https://evil.test"])).toBe("/dashboard");
    expect(resolvePostAuthDestination([])).toBe("/dashboard");
  });

  it("keeps the existing agent and control destinations", () => {
    expect(resolvePostAuthDestination("agents")).toBe("/agents/dashboard");
    expect(resolvePostAuthDestination("control")).toBe("/control");
  });

  it("never follows an arbitrary or crafted destination (open-redirect protection)", () => {
    for (const hostile of ["https://evil.example", "//evil.example", "/dashboard/mjengo/../../admin", "/dashboard/mjengo?x=1", "javascript:alert(1)", "__proto__", "constructor", "", undefined, null, 42]) {
      expect(resolvePostAuthDestination(hostile)).toBe("/dashboard");
    }
  });

  it("round-trips the token across login ⇄ register links", () => {
    for (const d of ["/dashboard/mjengo", "/agents/dashboard", "/control"] as const) {
      expect(resolvePostAuthDestination(postAuthNextToken(d))).toBe(d);
    }
    expect(postAuthNextToken("/dashboard")).toBeNull();
  });

  it("wires the allowlist into login, register and the MJENGO entry redirect", () => {
    const login = readFileSync("app/login/page.tsx", "utf8");
    const register = readFileSync("app/register/page.tsx", "utf8");
    const entry = readFileSync("app/dashboard/mjengo/page.tsx", "utf8");
    expect(login).toContain("resolvePostAuthDestination(params.next)");
    expect(register).toContain("resolvePostAuthDestination(params.next)");
    expect(register).toContain("destination={destination}");
    expect(entry).toContain('redirect("/login?next=mjengo")');
    // The chooser shows business names rather than raw internal ids.
    expect(entry).not.toMatch(/>\{id\}<\/a>/);
  });
});

describe("MJENGO OS gate offers a purchase path whenever payment is the next step", () => {
  const now = new Date("2026-11-17T12:00:00Z");

  it("never-subscribed business without configuration → 402 (checkout offered)", () => {
    const ent = deriveMjengoEntitlement({ subscription: null, configured: false, now });
    expect(ent.status).toBe("NONE");
    expect(mjengoDenialStatus(ent)).toBe(402);
  });

  it("never-subscribed configured business → 402", () => {
    expect(mjengoDenialStatus(deriveMjengoEntitlement({ subscription: null, configured: true, now }))).toBe(402);
  });

  it("cancelled subscription → 402 to resubscribe", () => {
    const ent = deriveMjengoEntitlement({ subscription: { status: "CANCELLED", planKey: "MJENGO_OS" }, now });
    expect(ent.status).toBe("CANCELLED");
    expect(mjengoDenialStatus(ent)).toBe(402);
  });

  it("expired subscription beyond grace → 402 to renew", () => {
    const ent = deriveMjengoEntitlement({
      subscription: { status: "ACTIVE", planKey: "MJENGO_OS", expiresAt: new Date("2026-10-01"), graceUntil: new Date("2026-10-04") }, now,
    });
    expect(ent.status).toBe("EXPIRED");
    expect(mjengoDenialStatus(ent)).toBe(402);
  });

  it("PAID but not yet activated → 403 (no second checkout; customer is told activation is in progress)", () => {
    const ent = deriveMjengoEntitlement({ subscription: null, paidPayment: { status: "PAID", planKey: "MJENGO_OS" }, now });
    expect(ent.status).toBe("PENDING");
    expect(ent.nextAction).toBe("none");
    expect(mjengoDenialStatus(ent)).toBe(403);
  });

  it("suspended (e.g. refunded) → 403 with no checkout", () => {
    const ent = deriveMjengoEntitlement({ subscription: { status: "SUSPENDED", planKey: "MJENGO_OS", expiresAt: new Date("2026-12-01") }, paidPayment: { status: "PAID", planKey: "MJENGO_OS" }, now });
    expect(ent.status).toBe("SUSPENDED");
    expect(mjengoDenialStatus(ent)).toBe(403);
  });

  it("R-MJ-08: a real refund (payment REFUNDED, so no PAID evidence) still resolves to SUSPENDED → 403, never a second checkout", () => {
    // The webhook's refund.processed moves the payment PAID → REFUNDED and suspends both rows, so
    // getMjengoEntitlement finds no PAID payment. The fixture above (SUSPENDED + PAID) never occurs.
    for (const entitlement of [{ status: "SUSPENDED" }, { status: "ACTIVE" }, null]) {
      const ent = deriveMjengoEntitlement({
        subscription: { status: "SUSPENDED", planKey: "MJENGO_OS", expiresAt: new Date("2026-12-01") },
        entitlement: entitlement as any,
        paidPayment: null,
        now,
      });
      expect(ent.entitled).toBe(false);
      expect(ent.status).toBe("SUSPENDED");
      expect(ent.nextAction).toBe("none");
      expect(mjengoDenialStatus(ent)).toBe(403);
    }
    // Entitlement-row suspension alone is enough, even if the subscription still says ACTIVE.
    const rowOnly = deriveMjengoEntitlement({
      subscription: { status: "ACTIVE", planKey: "MJENGO_OS", expiresAt: new Date("2026-12-01") },
      entitlement: { status: "SUSPENDED" } as any,
      paidPayment: null,
      now,
    });
    expect(rowOnly.status).toBe("SUSPENDED");
    expect(mjengoDenialStatus(rowOnly)).toBe(403);
  });

  it("a Business POS subscription never unlocks MJENGO OS and is routed to MJENGO checkout", () => {
    const ent = deriveMjengoEntitlement({ subscription: { status: "ACTIVE", planKey: "BUSINESS_POS", expiresAt: new Date("2026-12-01") }, now });
    expect(ent.entitled).toBe(false);
    expect(mjengoDenialStatus(ent)).toBe(402);
  });

  it("keeps the approved MJENGO OS price and duration", () => {
    const ent = deriveMjengoEntitlement({ subscription: null, now });
    expect(ent.priceKES).toBe(2000);
    expect(readFileSync("lib/mjengo/entitlement.ts", "utf8")).toContain("MJENGO_PLAN_DURATION_DAYS = 30");
  });
});
