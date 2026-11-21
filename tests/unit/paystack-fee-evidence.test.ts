import { describe, expect, it } from "vitest";
import { readPaystackFeeMinor } from "@/lib/payments/providers/paystack";

describe("readPaystackFeeMinor", () => {
  it("accepts an explicit zero fee as provider evidence", () => {
    expect(readPaystackFeeMinor(0)).toBe(0);
  });

  it("accepts a non-negative safe integer in minor units", () => {
    expect(readPaystackFeeMinor(1250)).toBe(1250);
  });

  it.each([undefined, null, "", "0", -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "keeps absent or malformed fee values unknown: %s",
    (value) => {
      expect(readPaystackFeeMinor(value)).toBeNull();
    },
  );
});
