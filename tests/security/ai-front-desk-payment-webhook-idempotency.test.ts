/**
 * Payment webhook idempotency (P0 requirement: duplicate webhooks must be idempotent).
 *
 * The AI Front Desk entitlement is written by the same settlement path that activates every other
 * JATA subscription, so a replayed `charge.success` must not grant a second entitlement window —
 * and a webhook must never be able to write publication state at all. Publication stays derived
 * (published + activated + entitled); the webhook only records money.
 *
 * The route itself is unchanged by this remediation. This test pins its contract so a future
 * refactor cannot turn a duplicate delivery into a second activation or an implicit publish.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  processed: new Set<string>(),
  activations: [] as Array<{ paymentId: string; eventId: string }>,
  businessWrites: [] as any[],
  signatureValid: true,
}));

vi.mock("@/lib/db", () => ({
  default: {
    payment: {
      findUnique: vi.fn(async () => ({
        id: "pay_ai_1",
        reference: "JATA-AI-499-biz_a",
        businessId: "biz_a",
        userId: "user_owner",
        purpose: "SUBSCRIPTION",
        status: "PENDING",
        amount: 49900,
        currency: "KES",
        orderId: null,
        bookingId: null,
      })),
    },
    processedWebhook: {
      upsert: vi.fn(async ({ where }: any) => {
        hoisted.processed.add(where.id);
        return { id: where.id };
      }),
    },
    business: {
      update: vi.fn(async (args: any) => {
        hoisted.businessWrites.push(args);
        return { id: args?.where?.id };
      }),
    },
    $transaction: vi.fn(async (work: any) =>
      work({
        processedWebhook: { create: vi.fn(async () => ({ id: "evt" })) },
        payment: { updateMany: vi.fn(async () => ({ count: 1 })) },
      }),
    ),
  },
}));

vi.mock("@/lib/paystack", () => ({
  verifyWebhookSignature: vi.fn(() => hoisted.signatureValid),
  isWebhookProcessed: vi.fn(async (eventId: string) => hoisted.processed.has(eventId)),
  verifyTransaction: vi.fn(async (reference: string) => ({
    status: "success",
    id: 9001,
    reference,
    amount: 49900,
    currency: "KES",
    paid_at: new Date().toISOString(),
  })),
  activateSubscriptionForPayment: vi.fn(async (paymentId: string, eventId: string) => {
    hoisted.activations.push({ paymentId, eventId });
    hoisted.processed.add(eventId);
    return { alreadySettled: false, subscription: { id: "sub_ai" } };
  }),
}));

vi.mock("@/lib/paymentVerification", () => ({
  validatePaymentEvidence: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => ({ id: "audit" })),
}));

vi.mock("@/lib/experience/payments", () => ({
  settleOrderPayment: vi.fn(async () => ({ alreadySettled: false })),
  failOrderPayment: vi.fn(async () => ({})),
}));

vi.mock("@/lib/pos/entitlement", () => ({ POS_PLAN_KEY: "POS" }));
vi.mock("@/lib/autopilot/entitlement", () => ({ isAutopilotPlanKey: () => false }));

import { POST } from "@/app/api/paystack/webhook/route";

const payload = {
  id: "evt_ai_1",
  event: "charge.success",
  data: { id: 9001, reference: "JATA-AI-499-biz_a", amount: 49900, currency: "KES" },
};

function request(body: unknown = payload, signature: string | null = "signature") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature) headers["x-paystack-signature"] = signature;
  return new Request("https://jata.test/api/paystack/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.processed = new Set<string>();
  hoisted.activations = [];
  hoisted.businessWrites = [];
  hoisted.signatureValid = true;
});

describe("the AI Front Desk entitlement is activated exactly once per payment", () => {
  it("settles the first delivery", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "processed" });
    expect(hoisted.activations).toEqual([{ paymentId: "pay_ai_1", eventId: "evt_ai_1" }]);
  });

  it("acknowledges a duplicate delivery without activating again", async () => {
    await POST(request());
    const duplicate = await POST(request());
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ status: "already_processed" });
    expect(hoisted.activations).toHaveLength(1);
  });

  it("stays idempotent across a run of repeated deliveries", async () => {
    // Sequential replays are what a retrying provider actually sends. Simultaneous duplicates are
    // serialised by the settlement transaction's ProcessedWebhook primary-key lock inside
    // `activateSubscriptionForPayment` (see tests/integration/paystack-webhook-route.test.ts,
    // which models the P2002 collision), not by this route-level pre-check.
    const bodies: any[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      bodies.push(await (await POST(request())).json());
    }
    expect(hoisted.activations).toHaveLength(1);
    expect(bodies.filter((body) => body.status === "processed")).toHaveLength(1);
    expect(bodies.filter((body) => body.status === "already_processed")).toHaveLength(2);
  });

  it("refuses an unauthenticated webhook before touching a payment", async () => {
    hoisted.signatureValid = false;
    const res = await POST(request(payload, null));
    expect(res.status).toBe(401);
    expect(hoisted.activations).toHaveLength(0);
  });

  it("never writes publication state — publication is not a payment side effect", async () => {
    await POST(request());
    const publicationWrites = hoisted.businessWrites.filter(
      (write) => write?.data?.isPublished !== undefined,
    );
    expect(publicationWrites).toHaveLength(0);
  });
});
