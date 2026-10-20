import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "user-a", email: "owner@example.test", name: "Owner", role: "CUSTOMER", passwordHash: "hash", sessionVersion: 7 },
  setSessionCookie: vi.fn(async (_payload: any) => undefined),
  findUnique: vi.fn(async () => mocks.user),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ default: { user: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/auth", () => ({
  verifyPassword: vi.fn(async () => true),
  setSessionCookie: mocks.setSessionCookie,
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { POST } from "@/app/api/auth/login/route";

beforeEach(() => {
  mocks.user.sessionVersion = 7;
  vi.stubEnv("VERCEL", "1");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("login session version", () => {
  it("places the current database version in every new session after a password reset", async () => {
    const response = await POST(new Request("https://jata.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.90" },
      body: JSON.stringify({ email: "owner@example.test", password: "correct-horse" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setSessionCookie).toHaveBeenCalledWith({
      userId: "user-a",
      email: "owner@example.test",
      role: "CUSTOMER",
      name: "Owner",
      sessionVersion: 7,
    });
  });
});
