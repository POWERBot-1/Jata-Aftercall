import { describe, expect, it } from "vitest";
import { providerSettlementEvidenceFields } from "@/lib/payments/provider-settlement-evidence";

describe("providerSettlementEvidenceFields", () => {
  it("persists only the provider-confirmed paid_at and the matched local reference", () => {
    const fields = providerSettlementEvidenceFields({
      reference: "jata_ref_123",
      providerConfirmedAt: "2026-11-21T10:15:30.000Z",
    });
    expect(fields.providerSettledAt?.toISOString()).toBe("2026-11-21T10:15:30.000Z");
    expect(fields.providerSettlementReference).toBe("jata_ref_123");
  });

  it.each([undefined, null, "", "   ", "not-a-date", "x".repeat(65)])(
    "omits settlement timestamp for absent or invalid provider time: %s",
    (providerConfirmedAt) => {
      expect(providerSettlementEvidenceFields({
        reference: "jata_ref_123",
        providerConfirmedAt,
      })).toEqual({});
    },
  );

  it("fails closed when the local reference is invalid", () => {
    expect(providerSettlementEvidenceFields({
      reference: "",
      providerConfirmedAt: "2026-11-21T10:15:30.000Z",
    })).toEqual({});
  });
});
