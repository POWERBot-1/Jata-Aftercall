import { describe, expect, it } from "vitest";
import { generatePaymentReference } from "@/lib/paymentReference";

describe("Paystack-safe payment references", () => {
  it("uses only Paystack-supported characters and retains a recognizable prefix", () => {
    const reference = generatePaymentReference();
    expect(reference).toMatch(/^jata-[A-Za-z0-9.=-]+$/);
    expect(reference).not.toContain("_");
    expect(reference.length).toBeLessThanOrEqual(100);
  });

  it("generates unique high-entropy references for independent payments", () => {
    const references = Array.from({ length: 1000 }, () => generatePaymentReference());
    expect(new Set(references).size).toBe(references.length);
  });
});
