import { describe, expect, it } from "vitest";
import { formatStorageMinor, parseStorageSummary } from "@/components/agents/CommissionStorageSummary";
const response = { scope: "OWN_LEDGER_STORAGE_ONLY", currency: "KES", entryCount: "2", accrualMinor: "9007199254740993", reversalMinor: "-2000", netMinor: "9007199254738993", verification: "NOT_CHECKED", entitlement: "NOT_DETERMINED", payout: "NOT_AVAILABLE" };
describe("commission storage display is never payable earnings", () => {
  it("formats minor units exactly without converting to floating point", () => {
    expect(formatStorageMinor("9007199254740993")).toBe("KES 90,071,992,547,409.93");
    expect(formatStorageMinor("-2000")).toBe("−KES 20.00");
    expect(formatStorageMinor("0")).toBe("KES 0.00");
    expect(formatStorageMinor("1")).toBe("KES 0.01");
  });
  it("requires all safety labels and consistent exact arithmetic", () => {
    expect(parseStorageSummary(response)).toEqual({ entryCount: "2", accrualMinor: "9007199254740993", reversalMinor: "-2000", netMinor: "9007199254738993" });
    for (const bad of [null, {}, { ...response, entitlement: "APPROVED" }, { ...response, verification: "VERIFIED" }, { ...response, payout: "AVAILABLE" }, { ...response, accrualMinor: 1 }, { ...response, netMinor: "9" }, { ...response, reversalMinor: "1" }, { ...response, entryCount: "0" }]) expect(parseStorageSummary(bad)).toBeNull();
  });
});
