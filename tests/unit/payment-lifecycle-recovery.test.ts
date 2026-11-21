import { describe, expect, it } from "vitest";
import { buildPaymentLifecycleRecoveryQueue } from "@/lib/payments/payment-lifecycle-recovery";

describe("payment lifecycle recovery queue planner", () => {
  it("creates stable, deduplicated manual-review items", () => {
    const report = {
      findings: [
        { exception: "PAID_PAYMENT_WITHOUT_ENTITLEMENT" as const, paymentId: "pay-1" },
        { exception: "ENTITLEMENT_PAYMENT_IDENTITY_MISMATCH" as const, paymentId: "pay-2", entitlementId: "ent-2", product: "POS" },
        { exception: "PAID_PAYMENT_WITHOUT_ENTITLEMENT" as const, paymentId: "pay-1" },
      ],
    };
    const first = buildPaymentLifecycleRecoveryQueue(report);
    const second = buildPaymentLifecycleRecoveryQueue(report);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      exception: "ENTITLEMENT_PAYMENT_IDENTITY_MISMATCH",
      priority: "CRITICAL",
      status: "REVIEW_REQUIRED",
      permittedAction: "MANUAL_REVIEW_ONLY",
    });
    expect(first[1].idempotencyKey).toContain("payment-recovery:v1:");
  });

  it("does not invent repair actions or mutate its input report", () => {
    const report = {
      findings: [{ exception: "ENTITLEMENT_PAYMENT_NOT_PAID" as const, paymentId: "pay-1", entitlementId: "ent-1" }],
    };
    const before = structuredClone(report);
    const queue = buildPaymentLifecycleRecoveryQueue(report);
    expect(report).toEqual(before);
    expect(queue[0].permittedAction).toBe("MANUAL_REVIEW_ONLY");
    expect(queue[0].status).toBe("REVIEW_REQUIRED");
  });

  it("sorts priorities deterministically regardless of input order", () => {
    const findings = [
      { exception: "DUPLICATE_ENTITLEMENT_FOR_PAYMENT" as const, paymentId: "p3" },
      { exception: "PAID_PAYMENT_WITHOUT_ENTITLEMENT" as const, paymentId: "p2" },
      { exception: "ENTITLEMENT_PAYMENT_NOT_PAID" as const, paymentId: "p1" },
    ];
    const queue = buildPaymentLifecycleRecoveryQueue({ findings });
    expect(queue.map((item) => item.priority)).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
  });
});
