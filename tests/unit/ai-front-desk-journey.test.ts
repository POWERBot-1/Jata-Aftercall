/**
 * AI Front Desk journey — UX and regression coverage (P1).
 *
 * These are rendering tests, not screenshots: they pin the promises the guided workflow makes.
 *
 *   • A first-time owner sees one sentence, one primary action and the subscription rule *before*
 *     reaching a publishing barrier.
 *   • The business form is prepopulated from data the tenant already saved, with required and
 *     optional fields distinguished and inline validation messages that explain the fix.
 *   • Draft, private preview, subscription-required and not-live states are never presented as
 *     live, and the subscription-required state links to the existing approved checkout flow.
 *   • The publication button reflects server-derived eligibility and the status only changes after
 *     the server confirms publication (checked at the source level, because the optimistic-update
 *     bug this guards against is a statement in the handler).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AIFrontDeskWorkspace, {
  representativeQuestions,
  type CatalogueSummary,
  type EntitlementSummary,
  type PublicationSummary,
  type ReadinessSummary,
} from "@/components/ai/AIFrontDeskWorkspace";

const root = path.resolve(__dirname, "../..");
const noticeComponent = readFileSync(path.join(root, "components/workspace/WorkspaceUI.tsx"), "utf8");

const profile = {
  name: "Savanna Bakery",
  category: "Bakery",
  description: "Fresh cakes, bread and samosas baked daily in Kitengela.",
  location: "Kitengela, Kajiado",
  phone: "0712345678",
  whatsapp: "0712345678",
  openingHours: "Mon-Sat 8am-6pm",
};

const responses = {
  greetingMessage: "Karibu Savanna Bakery! Ask me about cakes, prices or delivery.",
  fallbackMessage: "I don't have that information yet. Let me connect you with the business.",
  toneOfVoice: "Friendly",
  languageBehavior: "English + Swahili",
  orderingAllowed: true,
  bookingsAllowed: false,
  preordersAllowed: false,
  escalationRules: "Complaints, refunds and custom orders go to the owner on WhatsApp.",
  afterHoursMessage: "We are closed now, but I can take your details and call you back.",
};

const catalogue: CatalogueSummary = {
  products: [{ id: "p1", name: "Black Forest Cake", priceKES: 2500, stockStatus: "IN_STOCK" }],
  services: [{ id: "s1", title: "Wedding cake consultation", priceFrom: 500 }],
  zones: [{ name: "Kitengela", feeKES: 200 }],
  faqCount: 3,
};

const draftPublication: PublicationSummary = {
  state: "DRAFT",
  publiclyOperational: false,
  isPublished: false,
  operationalStatus: "DRAFT",
  entitled: false,
  entitlementStatus: "NONE",
  reason: "Draft — publish after an active AI Business Front Desk subscription is confirmed.",
};

const unpaidEntitlement: EntitlementSummary = {
  status: "NONE",
  entitled: false,
  reason: "Choose the AI Business Front Desk plan (KES 499/month) to activate live AI.",
  priceKES: 499,
  currency: "KES",
  billingCycleDays: 30,
  expiresAt: null,
  graceUntil: null,
};

const paidEntitlement: EntitlementSummary = {
  status: "ACTIVE",
  entitled: true,
  reason: "Active",
  priceKES: 499,
  currency: "KES",
  billingCycleDays: 30,
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  graceUntil: null,
};

const readyReport: ReadinessSummary = {
  ready: true,
  canPublish: true,
  missingItems: [],
  checks: [
    { id: "business_profile", label: "Business profile configured", passed: true, detail: "Savanna Bakery (Bakery)" },
    { id: "fallback_behavior", label: "Fallback behavior configured", passed: true, detail: "Set" },
  ],
};

const incompleteReport: ReadinessSummary = {
  ready: false,
  canPublish: false,
  missingItems: ["Add opening days and hours."],
  checks: [
    { id: "business_profile", label: "Business profile configured", passed: true, detail: "Savanna Bakery (Bakery)" },
    { id: "operating_hours", label: "Operating hours configured", passed: false, detail: "Add opening days and hours." },
  ],
};

function render(
  overrides: Partial<{
    publication: PublicationSummary;
    entitlement: EntitlementSummary;
    readiness: ReadinessSummary;
    profileOverrides: Partial<typeof profile>;
    plan: { name: string; priceKES: number; durationDays: number } | null;
  }> = {},
) {
  const element = React.createElement(AIFrontDeskWorkspace, {
    businessId: "biz_a",
    businessSlug: "savanna-bakery",
    initialProfile: { ...profile, ...(overrides.profileOverrides || {}) },
    initialResponses: responses,
    initialCatalogue: catalogue,
    initialPublication: overrides.publication || draftPublication,
    initialEntitlement: overrides.entitlement || unpaidEntitlement,
    initialReadiness: overrides.readiness || incompleteReport,
    plan: overrides.plan === undefined ? { name: "AI Business Front Desk", priceKES: 499, durationDays: 30 } : overrides.plan,
  });
  return renderToStaticMarkup(element as any);
}

describe("the guided setup journey", () => {
  it("opens with one plain sentence, one primary action and the subscription rule", () => {
    const html = render();
    expect(html).toContain("Your front desk answers customers, every hour, from your own information.");
    expect(html).toContain("Set up AI Front Desk");
    // The subscription requirement is explained before the owner reaches the publish step…
    expect(html).toContain("Before you can publish");
    expect(html).toContain("we only treat it as paid after our server confirms the payment");
    // …and the price comes from the plan row, never a literal in the component.
    expect(html).toContain("KES 499");
    expect(html).not.toMatch(/KES\s*499\s*\/\s*month/);
  });

  it("shows all five steps with plain-language labels", () => {
    const html = render();
    for (const label of ["Welcome", "Business", "Answers", "Preview", "Publish"]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('aria-label="AI Front Desk setup steps"');
    // The stepper scrolls on a narrow screen instead of pushing the page wide.
    expect(html).toContain("overflow-x-auto");
  });

  it("prepopulates the business information the tenant already saved", () => {
    const html = render();
    expect(html).toContain('value="Savanna Bakery"');
    expect(html).toContain('value="Bakery"');
    expect(html).toContain('value="0712345678"');
    expect(html).toContain('value="Kitengela, Kajiado"');
    expect(html).toContain("Fresh cakes, bread and samosas baked daily in Kitengela.");
    expect(html).toContain("Mon-Sat 8am-6pm");
  });

  it("marks required fields and explains inline validation instead of blocking silently", () => {
    const html = render({ profileOverrides: { name: "", phone: "", whatsapp: "", location: "" } });
    expect(html).toContain("Business name");
    expect(html).toContain("required");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Use the name customers know you by");
    expect(html).toContain("so customers can reach you");
  });

  it("reuses the saved answer settings rather than asking for them again", () => {
    const html = render();
    expect(html).toContain("Karibu Savanna Bakery! Ask me about cakes, prices or delivery.");
    expect(html).toContain("Complaints, refunds and custom orders go to the owner on WhatsApp.");
    expect(html).toContain("English + Kiswahili");
  });

  it("builds preview questions from the tenant's own catalogue", () => {
    expect(representativeQuestions(catalogue)).toEqual(
      expect.arrayContaining([
        "How much is Black Forest Cake?",
        "Tell me about Wedding cake consultation",
        "How much is delivery to Kitengela?",
      ]),
    );
    // Nothing is invented for a business with no saved catalogue.
    const empty = representativeQuestions({ products: [], services: [], zones: [], faqCount: 0 });
    expect(empty.some((question) => question.includes("Black Forest"))).toBe(false);
    expect(empty).toContain("I want to speak to someone");
  });
});

describe("status and subscription states", () => {
  it("labels a draft as a draft and never as live", () => {
    const html = render();
    expect(html).toContain("Draft");
    expect(html).not.toMatch(/>Live</);
    expect(html).toContain("No customer can reach the Front Desk yet.");
  });

  it("calls the preview private, with no live or paid claim", () => {
    const html = render();
    expect(html).toContain("Private preview");
    expect(html).toContain("No customer can reach this until the Front Desk is published");
  });

  it("shows a not-live state for a lapsed subscription", () => {
    const html = render({
      publication: {
        ...draftPublication,
        state: "SUSPENDED",
        isPublished: true,
        operationalStatus: "LIVE",
        reason: "Your AI Business Front Desk subscription has expired.",
      },
      entitlement: { ...unpaidEntitlement, status: "EXPIRED", reason: "Your subscription has expired." },
    });
    expect(html).toContain("Not live");
    expect(html).toContain("Not serving customers");
    expect(html).not.toMatch(/>Live</);
  });

  it("offers the existing approved subscription flow when payment is required", () => {
    const html = render();
    expect(html).toContain('href="/dashboard/subscription?businessId=biz_a"');
    expect(html).toContain('href="/checkout?businessId=biz_a"');
    expect(html).toContain("Choose the plan");
    expect(html).toContain("Publication stays disabled until the payment is verified on our server.");
  });

  it("keeps publication disabled while the readiness gate is unmet", () => {
    const html = render({ entitlement: paidEntitlement, readiness: incompleteReport });
    expect(html).toContain("Add opening days and hours.");
    expect(html).toContain("publication refuses rather than publishing an incomplete");
    const publishButton = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?Publish AI Front Desk[\s\S]*?<\/button>/)?.[0] || "";
    expect(publishButton).toContain("disabled");
  });

  it("enables publication only when the server says the business is eligible", () => {
    const html = render({
      entitlement: paidEntitlement,
      readiness: readyReport,
      publication: { ...draftPublication, entitled: true, entitlementStatus: "ACTIVE" },
    });
    expect(html).toContain("Every readiness check passes");
    const publishButton = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?Publish AI Front Desk[\s\S]*?<\/button>/)?.[0] || "";
    expect(publishButton).not.toContain("disabled");
  });

  it("reports the live state with the customer link instead of a bare badge", () => {
    const html = render({
      publication: {
        state: "LIVE",
        publiclyOperational: true,
        isPublished: true,
        operationalStatus: "LIVE",
        entitled: true,
        entitlementStatus: "ACTIVE",
        reason: "Live and covered by an active, server-verified subscription.",
      },
      entitlement: paidEntitlement,
      readiness: readyReport,
    });
    expect(html).toContain("Open customer view");
    expect(html).toContain('href="/b/savanna-bakery/ai"');
    expect(html).toContain("Pause front desk");
  });
});

describe("the eleven required UI states", () => {
  const source = readFileSync(path.join(root, "components/ai/AIFrontDeskWorkspace.tsx"), "utf8");

  function publishButton(html: string) {
    return html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?Publish AI Front Desk[\s\S]*?<\/button>/)?.[0] || "";
  }

  it("1. not configured — says so instead of showing an empty desk as ready", () => {
    const html = render({
      readiness: {
        ready: false,
        canPublish: false,
        missingItems: ["Add your business category."],
        checks: [
          { id: "business_profile", label: "Business profile configured", passed: false, detail: "Add your business category." },
        ],
      },
    });
    expect(html).toContain("Not set up yet");
    expect(html).toContain("Change the highlighted fields, then save again.".slice(0, 10));
    expect(html).not.toMatch(/>Live</);
  });

  it("2. draft saved — a saved draft is labelled a draft, never live", () => {
    const html = render({ readiness: incompleteReport });
    expect(html).toContain("Draft saved");
    expect(html).toContain("Draft");
    expect(html).not.toMatch(/>Live</);
  });

  it("3. private preview ready — preview is named private before and after testing", () => {
    expect(source).toContain("Private preview ready");
    const html = render();
    expect(html).toContain("Private preview");
    expect(html).toContain("Answers below are produced from your saved");
  });

  it("4. subscription required — names the requirement and links to the approved checkout", () => {
    const html = render();
    expect(html).toContain("Subscription: not active");
    expect(html).toContain("Setup and preview stay free.");
    expect(html).toContain('href="/dashboard/subscription?businessId=biz_a"');
    expect(html).toContain('href="/checkout?businessId=biz_a"');
    expect(publishButton(html)).toContain("disabled");
  });

  it("5. payment pending verification — pending is not treated as paid", () => {
    const html = render({
      entitlement: { ...unpaidEntitlement, status: "PENDING", reason: "Awaiting provider confirmation." },
      publication: { ...draftPublication, entitlementStatus: "PENDING" },
    });
    expect(html).toContain("Subscription: payment not confirmed");
    expect(html).toContain("it is not confirmed yet");
    expect(html).toContain("Payment is only treated as paid after the provider confirms it");
    expect(publishButton(html)).toContain("disabled");
  });

  it("6. eligible to publish — the server's eligibility is what enables the button", () => {
    const html = render({
      entitlement: paidEntitlement,
      readiness: readyReport,
      publication: { ...draftPublication, entitled: true, entitlementStatus: "ACTIVE" },
    });
    expect(html).toContain("Ready to publish");
    expect(publishButton(html)).not.toContain("disabled");
  });

  it("7. publication in progress — a real busy state, not a fake success", () => {
    expect(source).toContain("Publishing…");
    expect(source).toContain("aria-busy={publishing}");
    const handler = source.slice(source.indexOf("async function publish()"), source.indexOf("async function switchOperational"));
    // No success notice before the awaited response is inspected.
    expect(handler.indexOf("await res.json()")).toBeLessThan(handler.indexOf("Published. Customers can now reach"));
  });

  it("8. live and entitled — live only with the derived LIVE state plus the share link", () => {
    const html = render({
      publication: {
        state: "LIVE",
        publiclyOperational: true,
        isPublished: true,
        operationalStatus: "LIVE",
        entitled: true,
        entitlementStatus: "ACTIVE",
        reason: "Live and covered by an active, server-verified subscription.",
      },
      entitlement: paidEntitlement,
      readiness: readyReport,
    });
    expect(html).toContain(">Live<");
    expect(html).toContain("Published and covered by an active subscription.");
    expect(html).toContain('href="/b/savanna-bakery/ai"');
  });

  it("9. subscription expired or suspended — states it plainly and offers no live label", () => {
    const html = render({
      publication: {
        ...draftPublication,
        state: "SUSPENDED",
        isPublished: true,
        operationalStatus: "LIVE",
        reason: "Your AI Business Front Desk subscription has expired.",
      },
      entitlement: { ...unpaidEntitlement, status: "SUSPENDED", reason: "Suspended after a refund." },
    });
    expect(html).toContain("Not live");
    expect(html).toContain("Not serving customers");
    expect(html).toContain("Subscription: not active");
    expect(html).not.toMatch(/>Live</);
  });

  it("10. publication failed — the server's reason is shown, and the desk stays unpublished", () => {
    expect(source).toContain("data.error ||");
    // The accessible alert/status mapping lives in the shared WorkspaceNotice; the workspace
    // keeps its error/success tone split and passes the publish notice's tone straight through.
    expect(source).toContain('<WorkspaceNotice tone={publishNotice.tone === "error" ? "error" : "success"}');
    expect(noticeComponent).toContain('role={tone === "error" ? "alert" : "status"}');
    expect(source).toContain("Nothing was changed");
    // A failed publish never rewrites the local publication state to LIVE.
    const handler = source.slice(source.indexOf("async function publish()"), source.indexOf("async function switchOperational"));
    expect(handler).not.toContain("setPublication");
  });

  it("11. billing service unavailable — fail closed, say so, and offer a retry", () => {
    const html = render({
      publication: { ...draftPublication, entitlementStatus: "UNKNOWN", reason: "Billing status could not be verified." },
      entitlement: { ...unpaidEntitlement, status: "UNKNOWN", reason: "Billing lookup failed." },
    });
    expect(html).toContain("We could not confirm your subscription");
    expect(html).toContain("nothing");
    // F4: an unverifiable subscription is a checking problem, and the copy must not read as a
    // payment problem, nor as "subscription not active".
    expect(html).toContain("This is a checking problem, not a payment problem");
    expect(html).toContain("contact JATA support");
    expect(html).toContain("do not pay again");
    expect(html).toContain("Check again");
    expect(html).not.toContain("Subscription: not active");
    expect(publishButton(html)).toContain("disabled");
    expect(html).not.toMatch(/>Live</);
  });

  it("11b. a declined/absent subscription still reads as a subscription problem, not an outage", () => {
    const html = render({
      publication: { ...draftPublication, entitlementStatus: "NONE", reason: "No active subscription." },
      entitlement: unpaidEntitlement,
    });
    expect(html).toContain("Subscription: not active");
    expect(html).toContain("Publishing needs the");
    expect(html).not.toContain("We could not confirm your subscription");
    expect(html).not.toContain("could not be verified");
  });

  it("11c. an UNAVAILABLE verification flag alone is enough to show the outage state", () => {
    const html = render({
      publication: draftPublication,
      entitlement: { ...unpaidEntitlement, verification: "UNAVAILABLE" },
    });
    expect(html).toContain("We could not confirm your subscription");
    expect(html).toContain("Subscription: could not be verified");
    expect(html).not.toContain("Subscription: not active");
    expect(publishButton(html)).toContain("disabled");
  });
});

describe("journey implementation guards", () => {
  const source = readFileSync(path.join(root, "components/ai/AIFrontDeskWorkspace.tsx"), "utf8");
  const cockpit = readFileSync(path.join(root, "components/AIDashboardClient.tsx"), "utf8");

  it("never sets LIVE optimistically from the client", () => {
    expect(source).not.toMatch(/state:\s*"LIVE"/);
    expect(source).not.toContain('setPublication({ ...publication, state: "LIVE"');
    // The publish handler re-reads the derived state from the server after the request.
    const publishHandler = source.slice(source.indexOf("async function publish()"), source.indexOf("async function switchOperational"));
    expect(publishHandler).toContain("await refresh()");
    expect(publishHandler).toContain('setPublishNotice({');
  });

  it("keeps every failure message actionable and every request real", () => {
    expect(source).toContain('<WorkspaceNotice tone={publishNotice.tone === "error" ? "error" : "success"}');
    expect(noticeComponent).toContain('role={tone === "error" ? "alert" : "status"}');
    expect(source).toContain("Publication failed. Nothing was changed");
    expect(source).toContain("Try again when you are back online");
    // No dead ends: the three write paths all hit real API routes.
    for (const endpoint of ['"/api/business"', '"/api/ai/config"', '"/api/ai/publish"', '"/api/ai/chat"']) {
      expect(source, endpoint).toContain(endpoint);
    }
  });

  it("follows the workspace design system instead of a dark template", () => {
    for (const token of ["ws-panel", "ws-kicker", "ws-stack", "jata-btn", "jata-input"]) {
      expect(source, token).toContain(token);
    }
    // The console renders the shared workspace primitives rather than hand-built dark panels.
    for (const token of ["WorkspacePanel", "WorkspaceStat", "WorkspaceSectionHead", "ws-stack", "jata-btn"]) {
      expect(cockpit, token).toContain(token);
    }
    // The old cockpit's dark, generic palette is gone.
    expect(cockpit).not.toContain("bg-slate-950");
    expect(cockpit).not.toContain("ai-cockpit");
    // …and it never seeds a status of its own.
    expect(cockpit).not.toContain('operationalStatus: "LIVE"');
  });

  it("keeps loading, error and retry affordances in the operations console", () => {
    expect(cockpit).toContain('role="status"');
    expect(cockpit).toContain("Try again");
    expect(cockpit).toContain('data-tone="danger"');
  });

  it("stays usable on a narrow screen", () => {
    // Single-column by default, never a fixed width, full-width fields, 44px-class controls.
    expect(source).not.toMatch(/w-\[\d{3,}px\]/);
    expect(source).toContain("grid gap-3 sm:grid-cols-2");
    expect(source).toContain("min-h-11");
    for (const label of ["aria-current", "aria-busy", "aria-invalid", "sr-only"]) {
      expect(source, label).toContain(label);
    }
  });
});
