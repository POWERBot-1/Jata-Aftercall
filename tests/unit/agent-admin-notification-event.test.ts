import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueApplicationSubmitted } from "@/lib/agents/admin-notification-event";

const old = process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED;
afterEach(() => { if (old === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED; else process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = old; });

describe("application notification event gating", () => {
  it.each([undefined, "false", "TRUE", "1"])("does not enqueue for flag %s", async (value) => {
    if (value === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED;
    else process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = value;
    const execute = vi.fn();
    await enqueueApplicationSubmitted({ $executeRaw: execute } as never, "fixture");
    expect(execute).not.toHaveBeenCalled();
  });
  it("writes only a parameterized event when explicitly enabled and propagates storage failure", async () => {
    process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = "true";
    const execute = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("storage failed"));
    const tx = { $executeRaw: execute } as never;
    await enqueueApplicationSubmitted(tx, "synthetic-application-id");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][1]).toBe("synthetic-application-id");
    await expect(enqueueApplicationSubmitted(tx, "synthetic-application-id")).rejects.toThrow("storage failed");
  });
});
