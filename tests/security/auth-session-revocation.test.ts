import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

const mocks = vi.hoisted(() => ({
  sessionVersion: 0,
  userExists: true,
  databaseFails: false,
  findUnique: vi.fn(async () => {
    if (mocks.databaseFails) throw new Error("database must not escape");
    return mocks.userExists ? { sessionVersion: mocks.sessionVersion } : null;
  }),
}));

vi.mock("@/lib/db", () => ({ default: { user: { findUnique: mocks.findUnique } } }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { createSession, getSessionFromToken } from "@/lib/auth";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "session-revocation-test-secret-with-more-than-32-characters");
  mocks.sessionVersion = 0;
  mocks.userExists = true;
  mocks.databaseFails = false;
  vi.clearAllMocks();
});

afterEach(() => vi.unstubAllEnvs());

describe("credential-reset session revocation", () => {
  it("accepts an active version and revokes the same JWT after the account version changes", async () => {
    const token = await createSession({ userId: "user-a", email: "owner@example.test", role: "CUSTOMER", sessionVersion: 4 });
    mocks.sessionVersion = 4;
    await expect(getSessionFromToken(token)).resolves.toMatchObject({ userId: "user-a", sessionVersion: 4 });

    mocks.sessionVersion = 5;
    await expect(getSessionFromToken(token)).resolves.toBeNull();
  });

  it("keeps pre-feature sessions at the legacy default version zero until a reset occurs", async () => {
    const token = await new SignJWT({ userId: "user-a", email: "owner@example.test", role: "CUSTOMER" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

    await expect(getSessionFromToken(token)).resolves.toMatchObject({ userId: "user-a", sessionVersion: 0 });
    mocks.sessionVersion = 1;
    await expect(getSessionFromToken(token)).resolves.toBeNull();
  });

  it("fails closed for deleted accounts and database errors", async () => {
    const token = await createSession({ userId: "user-a", email: "owner@example.test", role: "CUSTOMER" });
    mocks.userExists = false;
    await expect(getSessionFromToken(token)).resolves.toBeNull();
    mocks.userExists = true;
    mocks.databaseFails = true;
    await expect(getSessionFromToken(token)).resolves.toBeNull();
  });
});
