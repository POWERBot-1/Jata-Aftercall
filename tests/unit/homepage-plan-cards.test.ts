/**
 * Production audit 2026-10-04 — the public plan cards.
 *
 * 1. Production rendered "AI Business Front Desk � KES 499/month" and "Interactive Business �
 *    KES 999/month": the stored plan names carried U+FFFD. Known plans now fall back to their
 *    canonical name when the stored one is corrupt; correct stored names are shown untouched.
 * 2. When the plan read failed the page fell back to Monthly and Annual only, silently dropping
 *    two advertised products. The fallback now lists every publicly advertised plan — and still
 *    never the private Business POS plan (§67).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ rows: null as null | Array<Record<string, unknown>>, fail: false }));

vi.mock("@/lib/db", () => ({
  default: {
    planConfig: {
      findMany: vi.fn(async () => {
        if (state.fail) throw new Error("offline");
        return state.rows ?? [];
      }),
    },
  },
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => null),
  requireSession: vi.fn(async () => null),
  SESSION_COOKIE_NAME: "jata_session",
}));

import HomePage from "@/app/page";
import { planDisplayName } from "@/lib/pricing";

const render = async () => renderToStaticMarkup(await HomePage());

describe("planDisplayName", () => {
  it("shows a healthy stored name exactly as written", () => {
    expect(planDisplayName({ key: "MONTHLY", name: "Monthly — KES 149/month" })).toBe("Monthly — KES 149/month");
    expect(planDisplayName({ key: "PROMO", name: "Promo — KES 499/year" })).toBe("Promo — KES 499/year");
  });

  it("falls back to the canonical name when the stored one is corrupt or blank", () => {
    expect(planDisplayName({ key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk \uFFFD KES 499/month" })).toBe("AI Business Front Desk — KES 499/month");
    expect(planDisplayName({ key: "INTERACTIVE_BUSINESS", name: "Interactive Business \uFFFD KES 999/month" })).toBe("Interactive Business — KES 999/month");
    expect(planDisplayName({ key: "ANNUAL", name: "" })).toBe("Annual — KES 999/year");
  });

  it("never emits U+FFFD for an unknown plan with a corrupt name", () => {
    const shown = planDisplayName({ key: "PROMO", name: "Promo \uFFFD KES 499" });
    expect(shown).not.toContain("\uFFFD");
    expect(shown).toContain("Promo");
  });
});

describe("homepage plan cards", () => {
  it("renders no replacement characters and keeps every price when stored names are corrupt", async () => {
    state.fail = false;
    state.rows = [
      { id: "p1", key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
      { id: "p3", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk \uFFFD KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
      { id: "p2", key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
      { id: "p4", key: "INTERACTIVE_BUSINESS", name: "Interactive Business \uFFFD KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
      { id: "pp", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS", priceKES: 499, durationDays: 30, isActive: true },
    ];
    const html = await render();
    expect(html).not.toContain("\uFFFD");
    expect(html).toContain("AI Business Front Desk — KES 499/month");
    expect(html).toContain("Interactive Business — KES 999/month");
    expect(html).toContain("Monthly — KES 149/month");
    expect(html).toContain("Annual — KES 999/year");
    // The price shown is always the stored price, never the name's text.
    expect(html).toContain(">KES 499<");
    expect(html).not.toContain("JATA AFTERCALL — Business POS —");
  });

  it("falls back to ALL four advertised AFTERCALL plans (and not the private POS plan) when plans cannot be read", async () => {
    state.fail = true;
    const html = await render();
    state.fail = false;
    for (const name of ["Monthly — KES 149/month", "AI Business Front Desk — KES 499/month", "Annual — KES 999/year", "Interactive Business — KES 999/month"]) {
      expect(html, name).toContain(name);
    }
    expect(html).not.toContain("JATA AFTERCALL — Business POS — KES");
    // The dedicated POS entry still exists, from its own server constant.
    expect(html).toContain("Open Business POS");
  });
});
