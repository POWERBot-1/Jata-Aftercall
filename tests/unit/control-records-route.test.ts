import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const state: any = { grants: [] as any[] };
  const identity = { session: { userId: "operator-1", sessionVersion: 4 }, get grants() { return state.grants; } };
  const delegate = () => ({ findFirst: vi.fn(), findMany: vi.fn() });
  const tx: any = {
    $queryRaw: vi.fn(async () => state.grants),
    subscription: delegate(), payment: delegate(), agentApplication: delegate(), agentCommissionLedgerEntry: delegate(),
  };
  const prisma: any = { $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(tx)) };
  const audit = { createControlAuditEvent: vi.fn(async () => ({ id: "audit-1" })) };
  return { state, identity, tx, prisma, audit };
});

vi.mock("@/lib/db", () => ({ default: fixtures.prisma }));
vi.mock("@/lib/control/audit", () => fixtures.audit);
vi.mock("@/lib/control/security", () => ({ getCorrelationId: () => "req-123" }));
vi.mock("@/lib/control/access", () => ({
  requireControlPermission: vi.fn(async (permission: string) => {
    if (!fixtures.state.grants.some((grant: any) => grant.permissionKeys.includes(permission))) return { ok: false, status: 403, code: "CONTROL_ACCESS_REQUIRED" };
    return { ok: true, identity: fixtures.identity };
  }),
  controlAccessError: (result: any) => ({ error: result.code }),
  scopedBusinessIds: (grants: any[], permission: string) => {
    const matching = grants.filter((grant) => grant.permissionKeys.includes(permission));
    return { allowed: matching.length > 0, global: matching.some((grant) => grant.scopeBusinessId === null), ids: [...new Set(matching.map((grant) => grant.scopeBusinessId).filter(Boolean))] };
  },
}));

import { GET } from "@/app/api/control/records/route";
import { CONTROL_ROLE_NAMES } from "@/lib/control/permissions";

const grant = (permission: string, scopeBusinessId: string | null = "tenant-a") => ({ id: `g-${permission}`, role: "SUPPORT_ADMIN", permissionKeys: [permission], scopeBusinessId });
const call = (kind: string, extra = "") => GET(new Request(`https://control.example.test/api/control/records?kind=${kind}${extra}`));

beforeEach(() => {
  fixtures.state.grants = [grant("subscriptions.read")];
  vi.clearAllMocks();
  for (const model of [fixtures.tx.subscription, fixtures.tx.payment, fixtures.tx.agentApplication, fixtures.tx.agentCommissionLedgerEntry]) {
    model.findFirst.mockReset();
    model.findMany.mockReset();
  }
  fixtures.tx.$queryRaw.mockReset().mockImplementation(async () => fixtures.state.grants);
  fixtures.prisma.$transaction.mockReset().mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(fixtures.tx));
});

describe("Control operational record views", () => {
  it("filters subscription rows to the live tenant grant, minimizes fields, and audits the read", async () => {
    const record = { id: "sub-1", businessId: "tenant-a", status: "ACTIVE", startAt: null, expiresAt: null, createdAt: new Date("2026-10-01T00:00:00Z"), plan: { key: "starter" } };
    fixtures.tx.subscription.findMany.mockResolvedValue([record]);
    const response = await call("subscriptions");
    expect(response.status).toBe(200);
    const liveGrantSql = fixtures.tx.$queryRaw.mock.calls[0][0].join(" ");
    expect(liveGrantSql).toContain('"expiresAt" > CURRENT_TIMESTAMP');
    const body = await response.json();
    expect(body.items).toEqual([{ ...record, createdAt: "2026-10-01T00:00:00.000Z" }]);
    expect(fixtures.tx.subscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: { in: ["tenant-a"] } },
      select: { id: true, businessId: true, status: true, startAt: true, expiresAt: true, createdAt: true, plan: { select: { key: true } } },
    }));
    expect(fixtures.audit.createControlAuditEvent).toHaveBeenCalledWith(fixtures.tx, expect.objectContaining({
      actorId: "operator-1", grant: fixtures.state.grants[0], action: "CONTROL_RECORDS_READ", targetType: "SUBSCRIPTION_RECORDS",
      targetId: "subscriptions", scopeBusinessId: "tenant-a", outcome: "SUCCESS", correlationId: "req-123",
      metadata: { kind: "subscriptions", recordCount: 1, pageCursorUsed: false },
    }));
  });

  it("rejects a cursor from another tenant without returning records or creating a success audit", async () => {
    fixtures.tx.subscription.findFirst.mockResolvedValue(null);
    const response = await call("subscriptions", "&cursor=foreign-subscription");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "The page cursor is invalid or outside the authorized scope." });
    expect(fixtures.tx.subscription.findMany).not.toHaveBeenCalled();
    expect(fixtures.audit.createControlAuditEvent).not.toHaveBeenCalled();
    expect(fixtures.tx.subscription.findFirst).toHaveBeenCalledWith({ where: { businessId: { in: ["tenant-a"] }, id: "foreign-subscription" }, select: { id: true } });
  });

  it("withholds payment amount, reference and provider identifiers from the operational read", async () => {
    fixtures.state.grants = [grant("payments.read")];
    fixtures.tx.$queryRaw.mockImplementation(async () => fixtures.state.grants);
    fixtures.tx.payment.findMany.mockResolvedValue([{ id: "pay-1", businessId: "tenant-a", status: "PAID", purpose: "SUBSCRIPTION", createdAt: new Date() }]);
    const response = await call("payments");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0]).not.toHaveProperty("amount");
    expect(body.items[0]).not.toHaveProperty("reference");
    expect(body.items[0]).not.toHaveProperty("paystackId");
    expect(fixtures.tx.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, businessId: true, status: true, purpose: true, createdAt: true } }));
  });

  it("requires global scope for agent records and only selects non-contact application state", async () => {
    fixtures.state.grants = [grant("agents.read")];
    const scopedResponse = await call("agents");
    expect(scopedResponse.status).toBe(403);
    expect(fixtures.prisma.$transaction).not.toHaveBeenCalled();

    fixtures.state.grants = [grant("agents.read", null)];
    fixtures.tx.$queryRaw.mockImplementation(async () => fixtures.state.grants);
    fixtures.tx.agentApplication.findMany.mockResolvedValue([]);
    const globalResponse = await call("agents");
    expect(globalResponse.status).toBe(200);
    expect(fixtures.tx.agentApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {}, select: { id: true, status: true, agentStatus: true, createdAt: true, updatedAt: true },
    }));
  });

  it("fails closed when the permission is revoked between request check and row-locked query", async () => {
    fixtures.tx.$queryRaw.mockResolvedValue([]);
    const response = await call("subscriptions");
    expect(response.status).toBe(403);
    expect(fixtures.tx.subscription.findMany).not.toHaveBeenCalled();
    expect(fixtures.audit.createControlAuditEvent).not.toHaveBeenCalled();
  });

  it("applies identical explicit-read and no-grant denial behavior across all six roles", async () => {
    fixtures.tx.subscription.findMany.mockResolvedValue([]);
    for (const role of CONTROL_ROLE_NAMES) {
      const explicit = { ...grant("subscriptions.read"), id: `grant-${role}`, role };
      fixtures.state.grants = [explicit];
      const allowed = await call("subscriptions");
      expect(allowed.status).toBe(200);
      expect(fixtures.audit.createControlAuditEvent).toHaveBeenLastCalledWith(fixtures.tx, expect.objectContaining({ grant: explicit, outcome: "SUCCESS" }));

      fixtures.state.grants = [{ ...explicit, permissionKeys: [] }];
      const denied = await call("subscriptions");
      expect(denied.status).toBe(403);
    }
  });

  it("rejects unsupported record kinds before any database query", async () => {
    const response = await call("users");
    expect(response.status).toBe(400);
    expect(fixtures.prisma.$transaction).not.toHaveBeenCalled();
  });
});
