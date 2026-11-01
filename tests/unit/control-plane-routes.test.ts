import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const state: any = {
    grants: [{ id: "grant-a", role: "SUPPORT_ADMIN", permissionKeys: ["businesses.read", "businesses.suspend"], scopeBusinessId: "business-a" }],
    accessFailure: null as null | { status: number; code: string },
  };
  const identity = { session: { userId: "fixture-control-user", email: "control@example.test", role: "CUSTOMER", sessionVersion: 3 }, get grants() { return state.grants; } };
  const tx: any = {
    business: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(async () => [state.grants[0]]),
  };
  const prisma: any = {
    business: { findMany: vi.fn() },
    controlAuditEvent: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(tx)),
  };
  const audit = { createControlAuditEvent: vi.fn(async () => ({ id: "audit-fixture" })) };
  const rate = { rateLimitByIdentity: vi.fn(() => ({ allowed: true, remaining: 4 })) };
  return { state, identity, tx, prisma, audit, rate };
});

vi.mock("@/lib/db", () => ({ default: fixtures.prisma }));
vi.mock("@/lib/control/audit", () => fixtures.audit);
vi.mock("@/lib/rate-limit", () => fixtures.rate);
vi.mock("@/lib/control/security", () => ({
  getCorrelationId: () => "fixture-request-id",
  hasSameOrigin: (request: Request) => request.headers.get("origin") === new URL(request.url).origin,
}));
vi.mock("@/lib/control/access", () => ({
  requireControlPermission: vi.fn(async (permission: string, businessId?: string) => {
    if (fixtures.state.accessFailure) return { ok: false, ...fixtures.state.accessFailure };
    const grant = fixtures.state.grants.find((candidate: any) => candidate.permissionKeys.includes(permission)
      && (businessId === undefined || candidate.scopeBusinessId === null || candidate.scopeBusinessId === businessId));
    if (!grant) return { ok: false, status: 403, code: "CONTROL_ACCESS_REQUIRED" };
    return { ok: true, identity: fixtures.identity };
  }),
  requireAnyControlPermission: vi.fn(async (permissions: string[]) => {
    if (fixtures.state.accessFailure) return { ok: false, ...fixtures.state.accessFailure };
    if (!fixtures.state.grants.some((grant: any) => permissions.some((permission) => grant.permissionKeys.includes(permission)))) return { ok: false, status: 403, code: "CONTROL_ACCESS_REQUIRED" };
    return { ok: true, identity: fixtures.identity };
  }),
  getControlIdentity: vi.fn(async () => fixtures.state.accessFailure ? { ok: false, ...fixtures.state.accessFailure } : { ok: true, identity: fixtures.identity }),
  hasControlPermission: (grants: any[], permission: string, businessId?: string) => grants.some((grant) => grant.permissionKeys.includes(permission) && (businessId === undefined || grant.scopeBusinessId === null || grant.scopeBusinessId === businessId)),
  scopedBusinessIds: (grants: any[], permission: string) => {
    const matching = grants.filter((grant) => grant.permissionKeys.includes(permission));
    return { allowed: matching.length > 0, global: matching.some((grant) => grant.scopeBusinessId === null), ids: [...new Set(matching.map((grant) => grant.scopeBusinessId).filter(Boolean))] };
  },
  controlAccessError: (result: any) => ({ error: result.code }),
  CONTROL_MFA_COOKIE: "jata_control_mfa",
}));

import { GET as getBusinesses, PATCH as changeBusinessStatus } from "@/app/api/control/businesses/route";
import { POST as revokeSessions } from "@/app/api/control/session/revoke/route";
import { GET as getOverview } from "@/app/api/control/overview/route";
import { GET as getAudit } from "@/app/api/control/audit/route";
import ControlPage from "@/app/control/page";

const origin = { origin: "https://control.example.test" };
function request(url: string, body: unknown, headers: Record<string, string> = origin) {
  return new Request(url, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  fixtures.state.grants = [{ id: "grant-a", role: "SUPPORT_ADMIN", permissionKeys: ["businesses.read", "businesses.suspend", "audit.read"], scopeBusinessId: "business-a" }];
  fixtures.state.accessFailure = null;
  vi.clearAllMocks();
  fixtures.tx.business.findUnique.mockReset();
  fixtures.tx.business.updateMany.mockReset();
  fixtures.tx.user.findUnique.mockReset();
  fixtures.tx.user.update.mockReset();
  fixtures.tx.$queryRaw.mockReset().mockImplementation(async () => [fixtures.state.grants[0]]);
  fixtures.prisma.business.findMany.mockReset();
  fixtures.prisma.controlAuditEvent.findMany.mockReset();
  fixtures.prisma.$transaction.mockReset().mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(fixtures.tx));
});

describe("direct control page and business APIs", () => {
  it("does not render the control console for a direct page request without an explicit read grant", async () => {
    fixtures.state.grants = [];
    const page = await ControlPage() as any;
    expect(page.props.title).toBe("Control access not granted");
    expect(page.props.children).toHaveLength(2);
    expect(page.props.children[1].props.children.props.href).toBe("/control/policy");
    expect(fixtures.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("renders the explicit pending-policy state rather than the operational console", async () => {
    fixtures.state.accessFailure = { status: 403, code: "POLICY_PENDING" };
    const page = await ControlPage() as any;
    expect(page.props.title).toBe("Control access disabled by approved all-DENY policy");
    expect(page.props.subtitle).toContain("Policy approval does not enable operational access");
  });

  it("denies direct cross-tenant mutation before touching the database", async () => {
    const response = await changeBusinessStatus(request("https://control.example.test/api/control/businesses", {
      businessId: "business-b", status: "SUSPENDED", confirmation: "SUSPEND", reason: "Owner-reported policy violation",
    }));
    expect(response.status).toBe(403);
    expect(fixtures.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixtures.audit.createControlAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects cross-origin mutation before identity or database checks", async () => {
    const response = await changeBusinessStatus(request("https://control.example.test/api/control/businesses", {
      businessId: "business-a", status: "SUSPENDED", confirmation: "SUSPEND", reason: "Owner-reported policy violation",
    }, { origin: "https://attacker.example.test" }));
    expect(response.status).toBe(403);
    expect(fixtures.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rechecks the database grant under a row lock and denies a concurrently revoked grant", async () => {
    fixtures.tx.business.findUnique.mockResolvedValue({ id: "business-a", name: "Fixture Market", status: "ACTIVE", isPublished: true });
    fixtures.tx.$queryRaw.mockResolvedValue([]);
    const response = await changeBusinessStatus(request("https://control.example.test/api/control/businesses", {
      businessId: "business-a", status: "SUSPENDED", confirmation: "SUSPEND", reason: "Owner-reported policy violation",
    }));
    expect(response.status).toBe(403);
    expect(fixtures.tx.business.updateMany).not.toHaveBeenCalled();
    expect(fixtures.audit.createControlAuditEvent).not.toHaveBeenCalled();
  });

  it("performs a scoped, explicitly confirmed status transition and records an audit row", async () => {
    const before = { id: "business-a", name: "Fixture Market", status: "ACTIVE", isPublished: true };
    const after = { id: "business-a", name: "Fixture Market", status: "SUSPENDED", isPublished: true };
    fixtures.tx.business.findUnique.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    fixtures.tx.business.updateMany.mockResolvedValue({ count: 1 });
    const response = await changeBusinessStatus(request("https://control.example.test/api/control/businesses", {
      businessId: "business-a", status: "SUSPENDED", confirmation: "SUSPEND", reason: "Owner-reported policy violation",
    }));
    expect(response.status).toBe(200);
    expect(fixtures.tx.business.updateMany).toHaveBeenCalledWith({ where: { id: "business-a", status: "ACTIVE" }, data: { status: "SUSPENDED" } });
    expect(fixtures.audit.createControlAuditEvent).toHaveBeenCalledWith(fixtures.tx, expect.objectContaining({
      actorId: "fixture-control-user", action: "BUSINESS_SUSPEND", targetId: "business-a", scopeBusinessId: "business-a", reason: "Owner-reported policy violation", outcome: "SUCCESS",
    }));
    expect(await response.json()).toMatchObject({ business: { id: "business-a", status: "SUSPENDED" }, audit: "recorded" });
  });

  it("does not emit a SUCCESS audit event when the conditional business update changes no row", async () => {
    const before = { id: "business-a", name: "Fixture Market", status: "ACTIVE", isPublished: true };
    fixtures.tx.business.findUnique.mockResolvedValueOnce(before);
    fixtures.tx.business.updateMany.mockResolvedValue({ count: 0 });
    const response = await changeBusinessStatus(request("https://control.example.test/api/control/businesses", {
      businessId: "business-a", status: "SUSPENDED", confirmation: "SUSPEND", reason: "Owner-reported policy violation",
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "The business changed concurrently; reload before retrying." });
    expect(fixtures.audit.createControlAuditEvent).not.toHaveBeenCalled();
  });

  it("prevents an unconfirmed or reasonless change from reaching persistence", async () => {
    const response = await changeBusinessStatus(request("https://control.example.test/api/control/businesses", {
      businessId: "business-a", status: "SUSPENDED", confirmation: "REINSTATE", reason: "short",
    }));
    expect(response.status).toBe(400);
    expect(fixtures.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("filters the list query to only the explicitly granted tenant", async () => {
    fixtures.prisma.business.findMany.mockResolvedValue([]);
    const response = await getBusinesses(new Request("https://control.example.test/api/control/businesses"));
    expect(response.status).toBe(200);
    expect(fixtures.prisma.business.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["business-a"] } } }));
  });

  it("denies a direct overview API request when no read grants exist", async () => {
    fixtures.state.grants = [];
    const response = await getOverview();
    expect(response.status).toBe(403);
    expect(fixtures.prisma.business.findMany).not.toHaveBeenCalled();
    expect(fixtures.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("paginates audit history within the granted tenant scope", async () => {
    fixtures.prisma.controlAuditEvent.findMany.mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({ id: `event-${index}` })));
    const response = await getAudit(new Request("https://control.example.test/api/control/audit"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(fixtures.prisma.controlAuditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeBusinessId: { in: ["business-a"] } }, take: 51 }));
    expect(body.items).toHaveLength(50);
    expect(body.nextCursor).toBe("event-49");
  });
});

describe("session revocation route", () => {
  it("fails closed when the current control session has not satisfied MFA", async () => {
    fixtures.state.accessFailure = { status: 403, code: "MFA_REQUIRED" };
    const response = await revokeSessions(new Request("https://control.example.test/api/control/session/revoke", { method: "POST", headers: { ...origin, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "REVOKE_ALL_MY_SESSIONS" }) }));
    expect(response.status).toBe(403);
    expect(fixtures.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("increments the current account session version and audits all-device revocation", async () => {
    fixtures.tx.user.findUnique.mockResolvedValue({ sessionVersion: 3 });
    fixtures.tx.user.update.mockResolvedValue({ sessionVersion: 4 });
    const response = await revokeSessions(new Request("https://control.example.test/api/control/session/revoke", { method: "POST", headers: { ...origin, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "REVOKE_ALL_MY_SESSIONS" }) }));
    expect(response.status).toBe(200);
    expect(fixtures.tx.user.update).toHaveBeenCalledWith({ where: { id: "fixture-control-user" }, data: { sessionVersion: { increment: 1 } } });
    expect(fixtures.audit.createControlAuditEvent).toHaveBeenCalledWith(fixtures.tx, expect.objectContaining({ action: "CONTROL_SESSIONS_REVOKED", targetId: "fixture-control-user", outcome: "SUCCESS" }));
    expect(response.headers.get("set-cookie")).toContain("jata_session=");
    expect(response.headers.get("set-cookie")).toContain("jata_control_mfa=");
  });
});
