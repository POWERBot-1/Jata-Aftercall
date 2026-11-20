import { describe, expect, it, vi } from "vitest";
import { settlePosPayment } from "@/lib/pos/settlement";

describe("POS settlement payment identity", () => {
  it("does not treat an active subscription paid by a different payment as this payment's settlement", async () => {
    const tx = {
      posSubscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: "pos-subscription",
          businessId: "business-1",
          status: "ACTIVE",
          paymentId: "previous-payment",
        }),
      },
    };

    await expect(settlePosPayment(tx as any, {
      payment: {
        id: "new-payment",
        reference: "new-payment-reference",
        businessId: "business-1",
        userId: "owner-1",
        planId: "pos-plan",
        amount: 49900,
        currency: "KES",
        status: "PAID",
      },
      plan: { id: "pos-plan", key: "BUSINESS_POS", priceKES: 499, durationDays: 30 },
    })).rejects.toThrow("PAYMENT_EVIDENCE_REQUIRED");

    expect(tx.posSubscription.findUnique).toHaveBeenCalledOnce();
  });

  it("recognizes the same active subscription payment as an idempotent replay", async () => {
    const tx = {
      posSubscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: "pos-subscription",
          businessId: "business-1",
          status: "ACTIVE",
          paymentId: "same-payment",
        }),
      },
    };

    await expect(settlePosPayment(tx as any, {
      payment: {
        id: "same-payment",
        reference: "same-payment-reference",
        businessId: "business-1",
        userId: "owner-1",
        planId: "pos-plan",
        amount: 49900,
        currency: "KES",
        status: "PAID",
      },
      plan: { id: "pos-plan", key: "BUSINESS_POS", priceKES: 499, durationDays: 30 },
    })).resolves.toMatchObject({ alreadySettled: true, posSubscription: true });
  });
});
