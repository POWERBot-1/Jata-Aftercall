/**
 * JATA AFTERCALL AI Business Front Desk — DEVELOPMENT FIXTURE data and simulated API transport.
 *
 * Everything here is FICTIONAL. Replies are simulated and are labelled as such: they are not produced by a
 * live AI service, nothing is sent to a customer, and nothing is saved or published. This is NOT JATA Qi and NOT
 * TANYA-AI. Unknown `/api/*` requests fail closed (404); no request ever leaves the browser.
 */
import type {
  CatalogueSummary,
  EntitlementSummary,
  ProfileSummary,
  PublicationSummary,
  ReadinessSummary,
  ResponseSummary,
} from "@/components/ai/AIFrontDeskWorkspace";

export const AI_FIXTURE_NOTICE =
  "FICTIONAL FIXTURE — JATA AFTERCALL AI Front Desk. Replies are simulated, not from a live AI service. Nothing is saved, sent or published.";

/** Fixed latency so loading states are visible and deterministic. */
export const AI_FIXTURE_LATENCY_MS = 900;

export const AI_FIXTURE_OUTCOMES = ["success", "empty", "failure"] as const;
export type AiFixtureOutcome = (typeof AI_FIXTURE_OUTCOMES)[number];
export function isAiFixtureOutcome(value: unknown): value is AiFixtureOutcome {
  return typeof value === "string" && (AI_FIXTURE_OUTCOMES as readonly string[]).includes(value);
}

export const AI_FIXTURE_BUSINESS_ID = "fixture-studio-business";

export const aiFixtureProfile: ProfileSummary = {
  name: "Fixture Salon Studio",
  category: "beauty",
  description: "Fictional braids, nails and grooming for the front desk fixture.",
  location: "Fixture Town",
  phone: "+254700000000",
  whatsapp: "+254700000000",
  openingHours: "Mon–Sat 09:00–18:00 (fictional)",
};

export const aiFixtureResponses: ResponseSummary = {
  greetingMessage: "Hello, this is the fictional Fixture Salon front desk. How can I help?",
  fallbackMessage: "I do not have that detail yet. I will pass your question to the team.",
  toneOfVoice: "Friendly and brief",
  languageBehavior: "English and Swahili",
  orderingAllowed: false,
  bookingsAllowed: true,
  preordersAllowed: false,
  escalationRules: "Refund or complaint: hand over to the owner.",
  afterHoursMessage: "We are closed now. Leave your name and number and we will call in the morning.",
};

export const aiFixtureCatalogue: CatalogueSummary = {
  products: [{ id: "fx-product-1", name: "Fictional braid kit", priceKES: 1200, stockStatus: "in stock" }],
  services: [{ id: "fx-service-1", title: "Fictional braid styling", priceFrom: 1500 }],
  zones: [{ name: "Fixture Town centre", feeKES: 0 }],
  faqCount: 2,
};

export const aiFixturePublication: PublicationSummary = {
  state: "DRAFT",
  publiclyOperational: false,
  isPublished: false,
  operationalStatus: "PAUSED",
  entitled: false,
  entitlementStatus: "NOT_ENTITLED",
  reason: "Fictional fixture: no subscription is active and nothing is published.",
};

export const aiFixtureEntitlement: EntitlementSummary = {
  status: "NOT_ENTITLED",
  entitled: false,
  verification: "VERIFIED",
  reason: "SIMULATED FIXTURE CHECK — no subscription exists in this harness, so the front desk is not entitled to publish.",
};

export const aiFixtureReadiness: ReadinessSummary = {
  ready: false,
  canPublish: false,
  missingItems: ["An active subscription"],
  checks: [
    { id: "profile", label: "Business information", passed: true, detail: "Fictional details are filled in." },
    { id: "answers", label: "Answer settings", passed: true, detail: "Fictional answer settings are saved as a draft." },
    { id: "subscription", label: "Verified subscription", passed: false, detail: "Fictional fixture: not verified." },
  ],
};

export const aiFixturePlan = { name: "Fictional plan", priceKES: 0, durationDays: 0 };

/** The simulated front-desk reply. Grounded only in the fictional catalogue above. */
export function simulatedReply(question: string, outcome: AiFixtureOutcome): { reply: string; missing: string[] } {
  const q = question.toLowerCase();
  if (outcome === "empty" || /deliver|kitengela|nairobi/.test(q)) {
    return {
      reply:
        "SIMULATED FIXTURE REPLY — not from a live AI service. The fictional business information here does not cover delivery yet, so the desk would hand this to the owner.",
      missing: ["Delivery zones and fees"],
    };
  }
  if (/braid|style|price|cost/.test(q)) {
    return {
      reply:
        "SIMULATED FIXTURE REPLY — not from a live AI service. Fictional braid styling starts from KES 1,500 and the fictional braid kit is KES 1,200.",
      missing: [],
    };
  }
  return {
    reply: "SIMULATED FIXTURE REPLY — not from a live AI service. Fictional bookings are open Monday to Saturday.",
    missing: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Simulated `/api/*` transport. Returns null for any route that is not part of the fixture, and the caller
 * must answer those with a fail-closed 404. Saves, publishing and status changes never reach a server.
 */
export async function simulateAiFixtureApi(input: {
  outcome: AiFixtureOutcome;
  method: string;
  path: string;
  body: Record<string, unknown>;
}): Promise<Response | null> {
  const { outcome, method, path, body } = input;
  const fail = (error: string) => json(422, { error: `FICTIONAL FIXTURE: ${error}` });

  if (method === "GET" && path === "/api/ai/status") {
    return json(200, { publication: aiFixturePublication, operationalStatus: aiFixturePublication.operationalStatus });
  }
  if (method === "GET" && path === "/api/ai/readiness") {
    return json(200, {
      ready: aiFixtureReadiness.ready,
      canPublish: aiFixtureReadiness.canPublish,
      missingItems: aiFixtureReadiness.missingItems,
      detailedChecks: aiFixtureReadiness.checks,
    });
  }
  if (method === "GET" && path === "/api/ai/entitlement") {
    return json(200, { entitlement: aiFixtureEntitlement });
  }
  if (method === "POST" && path === "/api/ai/chat") {
    await wait(AI_FIXTURE_LATENCY_MS);
    if (outcome === "failure") {
      return json(503, { error: "FICTIONAL FIXTURE: simulated reply failure. Nothing was sent to a customer." });
    }
    const { reply, missing } = simulatedReply(String(body.message ?? ""), outcome);
    return json(200, { reply, diagnostics: { missingInformation: missing }, simulated: true });
  }
  if (method === "PATCH" && path === "/api/business") {
    await wait(AI_FIXTURE_LATENCY_MS);
    return outcome === "failure" ? fail("simulated save failure. Nothing was saved.") : json(200, { ok: true, simulated: true });
  }
  if (method === "POST" && path === "/api/ai/config") {
    await wait(AI_FIXTURE_LATENCY_MS);
    return outcome === "failure" ? fail("simulated save failure. Nothing was saved.") : json(200, { ok: true, simulated: true });
  }
  if (method === "POST" && path === "/api/ai/publish") {
    await wait(AI_FIXTURE_LATENCY_MS);
    return outcome === "failure"
      ? fail("simulated publish failure. Nothing was published.")
      : json(200, { published: false, simulated: true, sharePath: null });
  }
  if (method === "POST" && path === "/api/ai/status") {
    // Live/paused switches are never applied in the fixture.
    return fail("simulated status change. Nothing was changed and no customer is affected.");
  }
  return null;
}
