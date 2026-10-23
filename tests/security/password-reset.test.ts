import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => {
  const state: any = {
    user: null as any,
    token: null as any,
    emailConfigured: true,
    failEmail: false,
    sent: [] as Array<{ to: string; token: string }>,
    userLookups: 0,
    audits: [] as any[],
    afterTasks: [] as Array<() => Promise<void>>,
  };
  state.prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        state.userLookups += 1;
        return state.user?.email === where.email ? { id: state.user.id, email: state.user.email } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!state.user || state.user.id !== where.id) return { count: 0 };
        const current = state.user.passwordResetRequestedAt;
        const allowed = where.OR.some((condition: any) =>
          condition.passwordResetRequestedAt === null
            ? current === null
            : current instanceof Date && current <= condition.passwordResetRequestedAt.lte,
        );
        if (!allowed) return { count: 0 };
        Object.assign(state.user, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        if (!state.user || state.user.id !== where.id) throw new Error("user not found");
        state.user.passwordHash = data.passwordHash;
        state.user.sessionVersion += data.sessionVersion.increment;
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
        if (!token || token.id !== where.id && where.id !== undefined) return { count: 0 };
        if (where.userId && token.userId !== where.userId) return { count: 0 };
        if (where.tokenHash && token.tokenHash !== where.tokenHash) return { count: 0 };
        if (where.usedAt === null && token.usedAt !== null) return { count: 0 };
        if (where.expiresAt?.gt && token.expiresAt <= where.expiresAt.gt) return { count: 0 };
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
vi.mock("@/lib/auth", () => ({ hashPassword: vi.fn(async (password: string) => `bcrypt-hash:${password}`) }));
vi.mock("@/lib/password-reset-email", () => ({
  isPasswordResetEmailConfigured: vi.fn(() => mocks.emailConfigured),
  sendPasswordResetEmail: vi.fn(async (to: string, token: string) => {
    mocks.sent.push({ to, token });
    if (mocks.failEmail) throw new Error("SMTP transport details must not escape");
  }),
}));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (event: any) => { mocks.audits.push(event); }),
}));

import { POST as requestReset } from "@/app/api/auth/password-reset/route";
import { POST as completeReset } from "@/app/api/auth/password-reset/complete/route";
import { hashPassword } from "@/lib/auth";
import { PASSWORD_RESET_TTL_MS, validPasswordResetToken, validRecoveryPassword } from "@/lib/password-reset";

const NOW = new Date("2026-10-18T20:00:00.000Z");
let ipSequence = 0;

function request(email: string, ip = `198.51.100.${++ipSequence}`) {
  return requestReset(new Request("https://jata.test/api/auth/password-reset", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email }),
  }));
}

function complete(token: string, password = "new-correct-horse", extra: Record<string, unknown> = {}, ip = `203.0.113.${++ipSequence}`) {
  return completeReset(new Request("https://jata.test/api/auth/password-reset/complete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ token, password, ...extra }),
  }));
}

async function flushAfterTasks() {
  const tasks = mocks.afterTasks.splice(0);
  await Promise.all(tasks.map((task) => task()));
}

function storedToken(rawToken: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "reset-token-row",
    userId: "user-a",
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(NOW.getTime() + PASSWORD_RESET_TTL_MS),
    usedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.user = { id: "user-a", email: "owner@example.test", passwordHash: "old-hash", sessionVersion: 0, passwordResetRequestedAt: null };
  mocks.token = null;
  mocks.emailConfigured = true;
  mocks.failEmail = false;
  mocks.sent = [];
  mocks.userLookups = 0;
  mocks.audits = [];
  mocks.afterTasks = [];
  ipSequence = 0;
  vi.stubEnv("VERCEL", "1");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("password-reset request", () => {
  it("refuses every request when delivery is not configured, before looking up an account", async () => {
    mocks.emailConfigured = false;
    const known = await request("owner@example.test", "198.51.100.10");
    const unknown = await request("nobody@example.test", "198.51.100.11");

    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(await known.json()).toEqual(await unknown.json());
    expect(mocks.userLookups).toBe(0);
  });

  it("returns a generic response before account lookup, then stores only a digest", async () => {
    const known = await request("OWNER@example.test", "198.51.100.20");
    const unknown = await request("nobody@example.test", "198.51.100.21");
    const knownBody = await known.json();

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(knownBody).toEqual(await unknown.json());
    expect(knownBody.message).toMatch(/If an account exists/);
    expect(knownBody.message).not.toContain("owner@example.test");
    expect(mocks.userLookups).toBe(0);
    expect(mocks.sent).toHaveLength(0);

    await flushAfterTasks();
    expect(mocks.sent).toHaveLength(1);
    expect(mocks.sent[0].to).toBe("owner@example.test");
    expect(mocks.token.tokenHash).toBe(createHash("sha256").update(mocks.sent[0].token).digest("hex"));
    expect(mocks.token.tokenHash).not.toBe(mocks.sent[0].token);
    expect(mocks.token.expiresAt.getTime()).toBe(NOW.getTime() + PASSWORD_RESET_TTL_MS);
    expect(JSON.stringify(knownBody)).not.toContain(mocks.sent[0].token);
  });

  it("enforces the persistent per-account cooldown without sending a second email", async () => {
    const first = await request("owner@example.test", "198.51.100.30");
    expect(first.status).toBe(202);
    await flushAfterTasks();
    const originalHash = mocks.token.tokenHash;
    const second = await request("owner@example.test", "198.51.100.31");
    await flushAfterTasks();

    expect(second.status).toBe(202);
    expect(mocks.sent).toHaveLength(1);
    expect(mocks.token.tokenHash).toBe(originalHash);
  });

  it("invalidates a newly created token if SMTP delivery fails, without exposing delivery details", async () => {
    mocks.failEmail = true;
    const response = await request("owner@example.test", "198.51.100.40");
    const body = await response.json();
    await flushAfterTasks();

    expect(response.status).toBe(202);
    expect(body.message).toMatch(/If an account exists/);
    expect(body.message).not.toContain("SMTP");
    expect(mocks.token.usedAt).toEqual(NOW);
  });

  it("applies an IP abuse limit before account lookup", async () => {
    mocks.user = null;
    const responses = await Promise.all(Array.from({ length: 6 }, () => request("nobody@example.test", "198.51.100.50")));
    await flushAfterTasks();

    expect(responses.slice(0, 5).every((response) => response.status === 202)).toBe(true);
    expect(responses[5].status).toBe(429);
    expect(mocks.userLookups).toBe(5);
  });

  it("rejects malformed email input without querying the user table", async () => {
    const response = await request("not-an-email", "198.51.100.60");
    expect(response.status).toBe(400);
    expect(mocks.userLookups).toBe(0);
  });
});

describe("password-reset completion", () => {
  const rawToken = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it("accepts only a 256-bit base64url bearer token and bounds the bcrypt password input", () => {
    expect(validPasswordResetToken(rawToken)).toBe(true);
    expect(validPasswordResetToken(`${rawToken}x`)).toBe(false);
    expect(validPasswordResetToken("not-a-token")).toBe(false);
    expect(validRecoveryPassword("12345678")).toBe(true);
    expect(validRecoveryPassword("short")).toBe(false);
    expect(validRecoveryPassword("é".repeat(37))).toBe(false);
  });

  it("rejects an expired link without changing credentials or consuming a different user token", async () => {
    mocks.token = storedToken(rawToken, { userId: "user-b", expiresAt: new Date(NOW.getTime() - 1) });
    const response = await complete(rawToken);

    expect(response.status).toBe(400);
    expect(mocks.user.passwordHash).toBe("old-hash");
    expect(mocks.user.sessionVersion).toBe(0);
    expect(mocks.token.usedAt).toBeNull();
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("rejects unknown/replayed tokens and never accepts a caller-supplied user id", async () => {
    const unknown = await complete(rawToken, "new-correct-horse", { userId: "user-a" });
    expect(unknown.status).toBe(400);
    expect(mocks.user.passwordHash).toBe("old-hash");

    mocks.token = storedToken(rawToken, { usedAt: new Date(NOW.getTime() - 1000) });
    const replay = await complete(rawToken, "new-correct-horse", { userId: "user-a" });
    expect(replay.status).toBe(400);
    expect(mocks.user.passwordHash).toBe("old-hash");
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("updates the credential, consumes the token, and increments the session version exactly once", async () => {
    mocks.token = storedToken(rawToken);
    const response = await complete(rawToken, "new-correct-horse", { userId: "user-b" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(mocks.user.passwordHash).toBe("bcrypt-hash:new-correct-horse");
    expect(mocks.user.sessionVersion).toBe(1);
    expect(mocks.token.usedAt).toEqual(NOW);
    expect(mocks.prisma.user.update).toHaveBeenCalledTimes(1);
    expect(mocks.audits).toHaveLength(1);
  });

  it("allows only one winner when the same token is submitted concurrently", async () => {
    mocks.token = storedToken(rawToken);
    const responses = await Promise.all([
      complete(rawToken, "first-correct-horse"),
      complete(rawToken, "second-correct-horse"),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(mocks.prisma.user.update).toHaveBeenCalledTimes(1);
    expect(mocks.user.sessionVersion).toBe(1);
    expect(["bcrypt-hash:first-correct-horse", "bcrypt-hash:second-correct-horse"]).toContain(mocks.user.passwordHash);
  });

  it("returns 429 for excessive redemption guesses before database access", async () => {
    mocks.token = null;
    const responses = await Promise.all(Array.from({ length: 11 }, (_, index) => complete(rawToken, "new-correct-horse", {}, "203.0.113.70")));

    expect(responses.slice(0, 10).every((response) => response.status === 400)).toBe(true);
    expect(responses[10].status).toBe(429);
  });

  it("rejects overlong password byte sequences before database access", async () => {
    const response = await complete(rawToken, "é".repeat(37));
    expect(response.status).toBe(400);
    expect(mocks.prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});
