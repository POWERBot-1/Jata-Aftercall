/**
 * The POS banner's call to action (§38, §44, §60, §61).
 *
 * The banner lives in the POS shell, so it renders on every POS screen — including the screen its
 * notice points at. In the AWAITING_PAYMENT state the notice href is `/plan`, and on `/plan` a
 * Next `<Link>` to the current route suppresses the browser's default navigation and pushes the
 * same URL: the control looked active and did nothing (reported from production, 2026-10-03).
 *
 * These tests pin the presentation rule: the link is rendered only when it leads somewhere else.
 * They do not touch entitlement, lifecycle, payment or authorization — the state itself, the
 * notice text and the href the workspace computes are unchanged.
 */

import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ pathname: "/dashboard/pos/bizA" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { PosBanner } from "@/components/pos/PosBanner";

const BASE = "/dashboard/pos/bizA";

const AWAITING_PAYMENT = {
  notice: "Your plan is chosen. Complete the payment to switch your POS on.",
  tone: "warn" as const,
  href: `${BASE}/plan`,
  lifecycleLabel: "Awaiting payment",
  entitlementReason: "Complete the KES 499 payment to activate your Business POS.",
  entitled: false,
};

/** No JSX in a `.ts` test file: build the element the way React does. */
const render = (props: Parameters<typeof PosBanner>[0]) => renderToStaticMarkup(createElement(PosBanner, props));

describe("the banner stops offering a link to the page already open (§44, §60)", () => {
  beforeEach(() => {
    mocks.pathname = BASE;
  });

  it("points away from itself on every other POS screen", () => {
    mocks.pathname = BASE;
    const html = render(AWAITING_PAYMENT);
    expect(html).toContain("Awaiting payment");
    expect(html).toContain(AWAITING_PAYMENT.notice);
    expect(html).toContain(`href="${BASE}/plan"`);
    expect(html).toContain("Continue");
  });

  it("renders the notice but no self-referential link on /plan itself", () => {
    mocks.pathname = `${BASE}/plan`;
    const html = render(AWAITING_PAYMENT);
    // The owner still sees exactly the same status and the same sentence.
    expect(html).toContain("Awaiting payment");
    expect(html).toContain(AWAITING_PAYMENT.notice);
    // …and there is no dead control pointing back at the page they are on.
    expect(html).not.toContain(`href="${BASE}/plan"`);
    expect(html).not.toContain("Continue");
    expect(html).not.toContain("<a ");
  });

  it("treats a trailing slash as the same page", () => {
    mocks.pathname = `${BASE}/plan/`;
    expect(render(AWAITING_PAYMENT)).not.toContain("<a ");
  });

  it("keeps the other tones' wording and their links", () => {
    mocks.pathname = `${BASE}/settings`;
    expect(render({ ...AWAITING_PAYMENT, tone: "danger", href: `${BASE}/plan` })).toContain("Renew");
    expect(render({ ...AWAITING_PAYMENT, tone: "info", href: `${BASE}/preview` })).toContain("Open");
    // A notice with no destination renders as text only, as before.
    const plain = render({ ...AWAITING_PAYMENT, tone: "info", href: null });
    expect(plain).toContain(AWAITING_PAYMENT.notice);
    expect(plain).not.toContain("<a ");
  });

  it("stays hidden for an entitled business with nothing to announce", () => {
    expect(render({ ...AWAITING_PAYMENT, notice: null, entitled: true })).toBe("");
  });

  it("falls back to the entitlement reason when there is no notice", () => {
    const html = render({ ...AWAITING_PAYMENT, notice: null });
    expect(html).toContain(AWAITING_PAYMENT.entitlementReason);
    expect(html).toContain(`href="${BASE}/plan"`);
  });
});
