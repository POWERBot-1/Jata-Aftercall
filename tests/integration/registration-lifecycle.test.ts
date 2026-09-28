import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {} }),
}));

vi.mock("@/lib/db", () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

import { registerOwner, validateRegisterInput } from "@/lib/registration";
import { SAFE_ERRORS, responseHasTechnicalDetail } from "@/lib/safeError";

type Row = Record<string, any>;

function memoryDb() {
  const users: Row[] = [];
  const businesses: Row[] = [];
  const members: Row[] = [];
  const tx = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => users.find((u) => u.email === where.email) || null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `user-${users.length + 1}`, ...data };
        users.push(row);
        return row;
      },
    },
    business: {
      findUnique: async ({ where }: { where: { slug: string } }) => businesses.find((b) => b.slug === where.slug) || null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `biz-${businesses.length + 1}`, ...data };
        businesses.push(row);
        return row;
      },
    },
    businessMember: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `mem-${members.length + 1}`, ...data };
        members.push(row);
        return row;
      },
    },
  };
  return {
    users,
    businesses,
    members,
    tx,
    transaction: async <T,>(fn: (client: typeof tx) => Promise<T>) => {
      const snapshot = {
        users: users.map((row) => ({ ...row })),
        businesses: businesses.map((row) => ({ ...row })),
        members: members.map((row) => ({ ...row })),
      };
      try {
        return await fn(tx);
      } catch (error) {
        users.splice(0, users.length, ...snapshot.users);
        businesses.splice(0, businesses.length, ...snapshot.businesses);
        members.splice(0, members.length, ...snapshot.members);
        throw error;
      }
    },
  };
}

const valid = {
  name: "Mary Wanjiku",
  email: "Mary@Example.com",
  phone: "0722123456",
  password: "correct-horse",
  businessName: "Mary Beauty",
};

describe("registration lifecycle", () => {
  let db: ReturnType<typeof memoryDb>;
  let sessions: any[];
  let audits: any[];
  let auditShouldThrow: boolean;

  beforeEach(() => {
    db = memoryDb();
    sessions = [];
    audits = [];
    auditShouldThrow = false;
  });

  function deps(overrides: Record<string, unknown> = {}): any {
    return {
      hashPassword: (password: string) => bcrypt.hash(password, 4),
      transaction: db.transaction,
      logAudit: async (params: any) => {
        if (auditShouldThrow) throw new Error("audit store unavailable: prisma.auditEvent.create");
        audits.push(params);
      },
      issueSession: async (payload: any) => {
        sessions.push(payload);
      },
      adminEmails: [],
      ...overrides,
    };
  }

  it("creates user, business, and OWNER member in one transaction and issues a session", async () => {
    const result = await registerOwner(valid, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.users).toHaveLength(1);
    expect(db.businesses).toHaveLength(1);
    expect(db.members).toHaveLength(1);
    expect(db.members[0].role).toBe("OWNER");
    expect(db.members[0].userId).toBe(db.users[0].id);
    expect(db.members[0].businessId).toBe(db.businesses[0].id);
    expect(db.businesses[0].ownerId).toBe(db.users[0].id);
    expect(db.businesses[0].isPublished).toBe(false);
    expect(db.users[0].email).toBe("mary@example.com");
    expect(sessions).toEqual([
      expect.objectContaining({ userId: db.users[0].id, email: "mary@example.com", role: "CUSTOMER" }),
    ]);
  });

  it("stores a bcrypt hash, not the plaintext password", async () => {
    await registerOwner(valid, deps());
    expect(db.users[0].passwordHash).not.toBe(valid.password);
    expect(db.users[0].passwordHash.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare(valid.password, db.users[0].passwordHash)).toBe(true);
  });

  it("returns a plain duplicate-email error and does not create a second business", async () => {
    await registerOwner(valid, deps());
    const again = await registerOwner(valid, deps());
    expect(again).toEqual({ ok: false, status: 409, error: SAFE_ERRORS.registerDuplicate });
    expect(db.users).toHaveLength(1);
    expect(db.businesses).toHaveLength(1);
    expect(sessions).toHaveLength(1);
  });

  it("returns plain-language validation errors", () => {
    expect(validateRegisterInput({ ...valid, email: "not-an-email" })).toEqual({
      ok: false,
      status: 400,
      error: SAFE_ERRORS.registerEmail,
    });
    expect(validateRegisterInput({ ...valid, phone: "12" }).ok).toBe(false);
    expect(validateRegisterInput({ ...valid, password: "short" }).ok).toBe(false);
    expect(validateRegisterInput({ ...valid, name: "A" }).ok).toBe(false);
  });

  it("hides unexpected errors and rolls back so no orphan business remains", async () => {
    db.tx.businessMember.create = async () => {
      throw new Error("insert into BusinessMember failed: connection reset ECONNREFUSED prisma");
    };
    const result = await registerOwner(valid, deps());
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.status).toBe(500);
    expect(result.error).toBe(SAFE_ERRORS.registerUnexpected);
    expect(responseHasTechnicalDetail(result.error)).toBe(false);
    expect(result.error).not.toContain("ECONNREFUSED");
    expect(result.error).not.toContain("prisma");
    expect(db.users).toHaveLength(0);
    expect(db.businesses).toHaveLength(0);
    expect(db.members).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });

  it("does not fail registration when the audit write throws", async () => {
    auditShouldThrow = true;
    const result = await registerOwner(valid, deps());
    expect(result.ok).toBe(true);
    expect(db.users).toHaveLength(1);
    expect(db.businesses).toHaveLength(1);
    expect(sessions).toHaveLength(1);
  });
});
