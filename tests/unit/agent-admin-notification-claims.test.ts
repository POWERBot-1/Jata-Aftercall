import { afterEach, describe, expect, it, vi } from "vitest";
import { claimAdminNotification, finishAdminNotificationClaim, markExpiredAdminNotificationClaimsUnknown } from "@/lib/agents/admin-notification-claims";
const original = process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED;
afterEach(() => { if (original === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED; else process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED = original; });
const claim = { applicationId: "fixture", recipientKey: "a".repeat(64), claimToken: "fixture-token", attempts: 1 };
describe("notification claim primitives", () => {
  it.each([undefined, "false", "TRUE", "1"])("does nothing when flag is %s", async (value) => {
    if (value === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED; else process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED = value;
    const query = vi.fn(); const execute = vi.fn(); const db = { $queryRaw: query, $executeRaw: execute } as never;
    expect(await claimAdminNotification(db)).toBeNull();
    expect(await finishAdminNotificationClaim(db, claim, "UNKNOWN")).toBe(false);
    expect(await markExpiredAdminNotificationClaimsUnknown(db)).toBe(0);
    expect(query).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("rejects unsupported outcomes rather than guessing a retry classification", async () => {
    process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED = "true";
    const execute = vi.fn();
    await expect(finishAdminNotificationClaim({ $executeRaw: execute } as never, claim, "TIMEOUT" as never)).rejects.toThrow("INVALID_NOTIFICATION_OUTCOME");
    expect(execute).not.toHaveBeenCalled();
  });
});
