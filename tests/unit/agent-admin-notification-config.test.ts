import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { agentAdminNotificationReadiness } from "@/lib/agents/admin-notification-config";

const original = process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS;
afterEach(() => {
  if (original === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS;
  else process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = original;
});

describe("private admin notification recipient readiness", () => {
  it("is not configured by default", () => {
    delete process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS;
    expect(agentAdminNotificationReadiness()).toBe("NOT_CONFIGURED");
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "   ";
    expect(agentAdminNotificationReadiness()).toBe("NOT_CONFIGURED");
  });
  it("validates distinct Kenyan numbers without returning them", () => {
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700 000 001,+254-700-000-002";
    expect(agentAdminNotificationReadiness()).toBe("CONFIGURED");
  });
  it.each(["0700000001,", "0700000001,abc", "0700000001,+254700000001", "+2540700000001", "+254700000001ext2", "0700000001\n0700000002", "x".repeat(501), Array(11).fill("0700000001").join(",")])("fails closed on malformed, duplicate or excessive configuration", (value) => {
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = value;
    expect(agentAdminNotificationReadiness()).toBe("INVALID");
  });
});
