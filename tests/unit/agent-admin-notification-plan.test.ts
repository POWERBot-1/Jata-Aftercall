import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueApplicationSubmitted } from "@/lib/agents/admin-notification-event";

const env = { ...process.env };
const key = "synthetic-key-only-012345678901234567890123456789";
describe("disabled-by-default admin notification recipient plan", () => {
  beforeEach(() => {
    process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_OUTBOX_PLAN_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,+254700000002";
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY = key;
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION = "fixture-v1";
  });
  afterEach(() => { process.env = { ...env }; });
  it("is disabled independently of the existing event flag", async () => {
    delete process.env.AGENT_ADMIN_NOTIFICATION_OUTBOX_PLAN_ENABLED;
    const execute = vi.fn().mockResolvedValue(1); const query = vi.fn();
    await enqueueApplicationSubmitted({ $executeRaw: execute, $queryRaw: query } as never, "application-1");
    expect(execute).toHaveBeenCalledTimes(1); expect(query).not.toHaveBeenCalled();
    delete process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED; process.env.AGENT_ADMIN_NOTIFICATION_OUTBOX_PLAN_ENABLED = "true";
    await enqueueApplicationSubmitted({ $executeRaw: execute, $queryRaw: query } as never, "application-2");
    expect(execute).toHaveBeenCalledTimes(1); expect(query).not.toHaveBeenCalled();
  });
  it("creates keyed recipient identifiers, not phone numbers, when enabled", async () => {
    const execute = vi.fn().mockResolvedValue(1); const query = vi.fn().mockResolvedValue([{ applicationId: "application-1" }]);
    await enqueueApplicationSubmitted({ $executeRaw: execute, $queryRaw: query } as never, "application-1");
    expect(query).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledTimes(3);
    const expected = ["254700000001", "254700000002"].map((number) => createHmac("sha256", key).update("agent-admin-recipient:v1:").update(number).digest("hex"));
    expect(execute.mock.calls.slice(1).map((call) => call[2])).toEqual(expected);
    expect(JSON.stringify(execute.mock.calls)).not.toContain("0700000001");
    expect(JSON.stringify(execute.mock.calls)).not.toContain("+254700000002");
  });
  it("does not add recipients when a plan already exists", async () => {
    const execute = vi.fn().mockResolvedValue(1); const query = vi.fn().mockResolvedValue([]);
    await enqueueApplicationSubmitted({ $executeRaw: execute, $queryRaw: query } as never, "application-1");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["AGENT_ADMIN_NOTIFICATION_RECIPIENTS", "0700000001,0700000001"],
    ["AGENT_ADMIN_NOTIFICATION_RECIPIENTS", ""],
    ["AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY", "too-short"],
    ["AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION", "../invalid"],
  ])("fails closed on invalid %s", async (name, value) => {
    process.env[name] = value;
    const execute = vi.fn().mockResolvedValue(1); const query = vi.fn();
    await expect(enqueueApplicationSubmitted({ $executeRaw: execute, $queryRaw: query } as never, "application-1")).rejects.toThrow("ADMIN_NOTIFICATION_PLAN_NOT_CONFIGURED");
    expect(query).not.toHaveBeenCalled();
  });
});
