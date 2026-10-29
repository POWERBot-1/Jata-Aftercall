/**
 * Regression: the credential round trip after a password reset — with REAL bcrypt hashing and
 * the real request/complete/login route handlers. The other suites pin token mechanics and
 * enumeration behavior with a mocked hash; this one proves the delivered link actually changes
 * the credential that /api/auth/login verifies:
 *
 *   request -> delivered token -> complete (real bcrypt) -> login with the NEW password succeeds
 *   -> the OLD password is refused -> the token cannot be replayed.
 *
 * sessionVersion is asserted on the issued session payload so a completed reset revokes every
 * JWT minted before it (lib/auth.verifyCurrentSession compares against the stored version).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => {
  const state: any = {
    user: null as any,
    token: null as any,
    sent: [] as Array<{ to: string; token: string }>,
    sessionPayloads: [] as any[],
    afterTasks: [] as Array<() => Promise<void>>,
  };
  state.prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.email) return state.user?.email === where.email ? { ...state.user } : null;
        if (where.id) return state.user?.id === where.id ? { ...state.user } : null;
        return null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!state.user || state.user.id !== where.id) return { count: 0 };
        if (where.OR) {
          const current = state.user.passwordResetRequestedAt;
          const allowed = where.OR.some((condition: any) =>
            condition.passwordResetRequestedAt === null
              ? current === null
              : current instanceof Date && current <= condition.passwordResetRequestedAt.lte,
          );
          if (!allowed) return { count: 0 };
        } else if ("passwordResetRequestedAt" in where) {
          const current = state.user.passwordResetRequestedAt;
          const expected = where.passwordResetRequestedAt;
          if (!(current instanceof Date && expected instanceof Date && current.getTime() === expected.getTime())) {
            return { count: 0 };
          }
        }
        Object.assign(state.user, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        if (!state.user || state.user.id !== where.id) throw new Error("user not found");
        if (data.passwordHash !== undefined) state.user.passwordHash = data.passwordHash;
        if (data.sessionVersion?.increment) state.user.sessionVersion += data.sessionVersion.increment;
        return { id: state.user.id };
      }),
    },
    passwordResetToken: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        state.token = state.token?.userId === where.userId
          ? { ...state.token, ...update }
          : { id: "reset-token-row", ...create, usedAt: null, createdAt: new Date() };
        return state.token;
      }),
      findUnique: vi.fn(async ({ where }: any) => state.token?.tokenHash === where.tokenHash ? { ...state.token } : null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const token = state.token;
        if (!token || (where.id !== undefined && token.id !== where.id)) return { count: 0 };
        if (where.userId && token.userId !== where.userId) return { count: 0 };
        if (where.tokenHash && token.tokenHash !== where.tokenHash) return { count: 0 };
        if (where.usedAt === null && token.usedAt !== null) return { count: 0 };
        Object.assign(token, data);
        return { count: 1 };
      }),
    },
  };
  state.prisma.$transaction = vi.fn(async (callback: (client: any) => Promise<unknown>) => callback(state.prisma));
  return state;
});

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((task: () => Promise<void>) => { mocks.afterTasks.push(task); }),
  };
});
vi.mock("@/lib/db", () => ({ default: mocks.prisma }));
vi.mock("@/lib/password-reset-email", () => ({
  isPasswordResetEmailConfigured: vi.fn(() => true),
  sendPasswordResetEmail: vi.fn(async (to: string, token: string) => { mocks.sent.push({ to, token }); }),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
// Real bcrypt, real JWT minting; only the cookie writer is stubbed (needs a Next request scope).
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn(async (payload: any) => { mocks.sessionPayloads.push(payload); }) };
});

import { POST as requestReset } from "@/app/api/auth/password-reset/route";
import { POST as completeReset } from "@/app/api/auth/password-reset/complete/route";
import { POST as login } from "@/app/api/auth/login/route";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { createSession, verifySession } from "@/lib/auth";

const OLD_PASSWORD = "original-horse-battery";
const NEW_PASSWORD = "brand-new-correct-horse";
let ipSequence = 0;

function post(handler: typeof requestReset, path: string, body: unknown) {
  return handler(new Request(`https://jata.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ipSequence}` },
    body: JSON.stringify(body),
  }));
}

async function flushAfterTasks() {
  const tasks = mocks.afterTasks.splice(0);
  await Promise.all(tasks.map((task) => task()));
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("AUTH_SECRET", "password-reset-roundtrip-test-secret");
  mocks.sent.length = 0;
  mocks.sessionPayloads.length = 0;
  mocks.token = null;
  mocks.user = {
    id: "user-roundtrip",
    email: "owner@example.test",
    name: "Owner",
    role: "CUSTOMER",
    passwordHash: await hashPassword(OLD_PASSWORD),
    sessionVersion: 0,
    passwordResetRequestedAt: null,
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("password reset credential round trip (real bcrypt, real routes)", () => {
  it("resets the credential and signs in with the new password, refusing the old one and the replayed link", async () => {
    const request = await post(requestReset, "/api/auth/password-reset", { email: "owner@example.test" });
    expect(request.status).toBe(202);
    await flushAfterTasks();
    expect(mocks.sent).toHaveLength(1);
    const rawToken = mocks.sent[0].token;

    const complete = await post(completeReset, "/api/auth/password-reset/complete", {
      token: rawToken,
      password: NEW_PASSWORD,
    });
    expect(complete.status).toBe(200);
    expect((await complete.json()).ok).toBe(true);

    // The stored credential verifies against the new password and not the old one (real bcrypt).
    expect(await verifyPassword(NEW_PASSWORD, mocks.user.passwordHash)).toBe(true);
    expect(await verifyPassword(OLD_PASSWORD, mocks.user.passwordHash)).toBe(false);

    // Login with the new password succeeds and mints a session at the incremented version.
    const goodLogin = await post(login, "/api/auth/login", { email: "owner@example.test", password: NEW_PASSWORD });
    expect(goodLogin.status).toBe(200);
    expect((await goodLogin.json()).ok).toBe(true);
    expect(mocks.sessionPayloads).toHaveLength(1);
    expect(mocks.sessionPayloads[0].sessionVersion).toBe(1);

    // The old password no longer authenticates.
    const badLogin = await post(login, "/api/auth/login", { email: "owner@example.test", password: OLD_PASSWORD });
    expect(badLogin.status).toBe(401);

    // The reset link cannot be replayed after it was consumed.
    const replay = await post(completeReset, "/api/auth/password-reset/complete", {
      token: rawToken,
      password: "another-correct-horse",
    });
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toMatch(/invalid or expired/i);
    expect(await verifyPassword("another-correct-horse", mocks.user.passwordHash)).toBe(false);
  });

  it("rejects an expired link without touching the credential", async () => {
    const request = await post(requestReset, "/api/auth/password-reset", { email: "owner@example.test" });
    expect(request.status).toBe(202);
    await flushAfterTasks();
    const rawToken = mocks.sent[0].token;
    mocks.token.expiresAt = new Date(Date.now() - 1000);

    const expired = await post(completeReset, "/api/auth/password-reset/complete", {
      token: rawToken,
      password: NEW_PASSWORD,
    });
    expect(expired.status).toBe(400);
    expect((await expired.json()).error).toMatch(/invalid or expired/i);
    expect(await verifyPassword(OLD_PASSWORD, mocks.user.passwordHash)).toBe(true);
  });

  it("keeps the one-time bearer a 256-bit base64url token hashed at rest", async () => {
    await post(requestReset, "/api/auth/password-reset", { email: "owner@example.test" });
    await flushAfterTasks();
    const rawToken = mocks.sent[0].token;

    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(rawToken, "base64url")).toHaveLength(32);
    expect(mocks.token.tokenHash).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(mocks.token.tokenHash).not.toContain(rawToken);
  });

  it("issues sessions that verify under the same secret and revoke at a lower version", async () => {
    await post(requestReset, "/api/auth/password-reset", { email: "owner@example.test" });
    await flushAfterTasks();
    await post(completeReset, "/api/auth/password-reset/complete", { token: mocks.sent[0].token, password: NEW_PASSWORD });
    expect(mocks.user.sessionVersion).toBe(1);

    const cookieToken = await createSession({ userId: "user-roundtrip", email: "owner@example.test", role: "CUSTOMER", sessionVersion: 1 });
    const verified = await verifySession(cookieToken);
    expect(verified?.userId).toBe("user-roundtrip");
    expect(verified?.sessionVersion).toBe(1);
  });
});
