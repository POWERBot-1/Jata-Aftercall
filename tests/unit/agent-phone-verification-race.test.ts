// Regression for the PostgreSQL CI failure on ed3d561 (tests/prisma/agent-applications-postgres.test.ts:231):
// two concurrent confirmations returned ["invalid","verified"] instead of ["already","verified"].
// Root cause: under READ COMMITTED the losing transaction read the application before the winner
// committed, then read the challenge after it committed (consumedAt set) and classified it "invalid"
// without re-reading committed application state. This deterministic fake reproduces that interleaving.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  app: { id: "app-1", status: "PENDING", phoneE164: "+254712345678", phoneVerifiedAt: null as Date | null, verifiedPhoneE164: null as string | null },
  challenge: { id: "ch-1", applicationId: "app-1", phoneE164: "+254712345678", sentAt: new Date(), consumedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 60_000), attempts: 0, codeDigest: "digest", nonce: "n" },
}));

const tx = {
  agentApplication: { findUnique: vi.fn(async () => ({ ...state.app })) },
  agentPhoneChallenge: { findUnique: vi.fn(async () => ({ ...state.challenge })), updateMany: vi.fn() },
  auditEvent: { create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ default: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }));
import { confirmPhoneChallenge } from "@/lib/agents/phone-verification";

describe("confirmPhoneChallenge concurrent-success classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.app.phoneVerifiedAt = null; state.app.verifiedPhoneE164 = null; state.challenge.consumedAt = null;
  });

  it("reports 'already' when the challenge was consumed by a concurrent winner after the application read", async () => {
    // First application read happens before the winner commits; the winner commits before the challenge read.
    tx.agentApplication.findUnique.mockImplementationOnce(async () => {
      const snapshot = { ...state.app };
      const at = new Date();
      state.app.phoneVerifiedAt = at; state.app.verifiedPhoneE164 = state.app.phoneE164; state.challenge.consumedAt = at;
      return snapshot;
    });
    await expect(confirmPhoneChallenge("u1", "123456", "x".repeat(40))).resolves.toBe("already");
    expect(tx.agentPhoneChallenge.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("still reports 'invalid' for a consumed challenge when the application is not verified", async () => {
    state.challenge.consumedAt = new Date();
    await expect(confirmPhoneChallenge("u1", "123456", "x".repeat(40))).resolves.toBe("invalid");
  });

  it("still reports 'invalid' for an expired challenge", async () => {
    const original = state.challenge.expiresAt; state.challenge.expiresAt = new Date(0);
    try { await expect(confirmPhoneChallenge("u1", "123456", "x".repeat(40))).resolves.toBe("invalid"); }
    finally { state.challenge.expiresAt = original; }
  });

  it("reports 'already' when the locking update loses to a concurrent winner", async () => {
    tx.agentPhoneChallenge.updateMany.mockImplementationOnce(async () => {
      state.app.phoneVerifiedAt = new Date(); state.app.verifiedPhoneE164 = state.app.phoneE164;
      return { count: 0 };
    });
    await expect(confirmPhoneChallenge("u1", "123456", "x".repeat(40))).resolves.toBe("already");
  });
});
