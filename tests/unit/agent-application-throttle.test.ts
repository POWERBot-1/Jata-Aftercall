import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ query: vi.fn(), cleanup: vi.fn().mockResolvedValue({ count: 0 }) }));
vi.mock("@/lib/db", () => ({ default: { $queryRaw: mock.query, agentRegistrationThrottle: { deleteMany: mock.cleanup } } }));
import { allowAgentApplication } from "@/lib/agent-application-throttle";

const original = process.env.AUTH_SECRET;
const originalNext = process.env.NEXTAUTH_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = original;
  if (originalNext === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = originalNext;
  vi.resetAllMocks();
});

describe("agent application shared throttle", () => {
  it("requires a secret and fails closed", async () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    await expect(allowAgentApplication("account")).rejects.toThrow();
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("only allows a valid returned counter, never an offline fallback or exhausted bucket", async () => {
    process.env.AUTH_SECRET = "test-only-secret";
    mock.query.mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ "?column?": 1 }]);
    expect(await allowAgentApplication("private-account-id")).toBe(true);
    expect(await allowAgentApplication("private-account-id")).toBe(false);
    expect(await allowAgentApplication("private-account-id")).toBe(false);
    const args = mock.query.mock.calls[0];
    expect(args[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(args[1]).not.toContain("private-account-id");
    expect(args[0].join("?")).toContain('ON CONFLICT');
  });
  it("does not hide database errors", async () => {
    process.env.AUTH_SECRET = "test-only-secret";
    mock.query.mockRejectedValue(new Error("offline"));
    await expect(allowAgentApplication("account")).rejects.toThrow("offline");
  });
});
