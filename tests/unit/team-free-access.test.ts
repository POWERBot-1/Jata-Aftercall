/**
 * Owner directive 2026-10-27 Phase 5 — JATA_TEAM_FREE_ACCESS security contract.
 *
 * Uses an in-memory audit log behind the real `lib/team-access` implementation, so the full
 * admin-start → member-verify → entitlement → profile-edit → revocation chain is exercised.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  session: null as any,
  user: { phone: "0724317010" } as any,
  business: { ownerId: "user-1" } as any,
  events: [] as any[],
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/db", () => ({
  default: {
    user: { findUnique: vi.fn(async () => mocks.user) },
    business: { findUnique: vi.fn(async () => mocks.business) },
    auditEvent: {
      findMany: vi.fn(async () => [...mocks.events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    },
  },
}));
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return {
    ...actual,
    writeAuditEvent: vi.fn(async ({ action, targetType, targetId, metadata }: any) => {
      mocks.events.push({ action, targetType, targetId, metadata: JSON.stringify(metadata ?? {}), createdAt: new Date() });
      return true;
    }),
  };
});

import {
  AUTHORIZED_TEAM_PHONES,
  TEAM_FREE_ACCESS_LABEL,
  TEAM_FREE_ACCESS_KEY,
  TEAM_AUDIT_ACTIONS,
  deriveTeamFreeAccess,
  getTeamAccessStatus,
  hasTeamFreeAccessForBusiness,
  isAuthorizedTeamPhone,
  normalizeTeamPhone,
  revokeTeamAccess,
  startTeamPhoneVerification,
  teamPhoneFingerprint,
  verifyTeamPhoneCode,
} from "@/lib/team-access";
import { hasVerifiedPublicationRight, canSetPublished } from "@/lib/publication";
import { getInteractiveEntitlement } from "@/lib/experience/entitlement";
import { getAIPackageStatus } from "@/lib/ai-entitlement";
import { getPosEntitlement } from "@/lib/pos/entitlement";
import { getAutopilotEntitlement } from "@/lib/autopilot/entitlement";
import { nextActionFor } from "@/lib/nextAction";
import { resolveOnboardingRedirect } from "@/lib/subscriptionFlow";
import { POST as adminPost } from "@/app/api/admin/team-access/route";
import { GET as accountGet, POST as accountPost } from "@/app/api/account/team-access/route";

const SECRET = "unit-test-team-secret";
const fp = (phone: string) => teamPhoneFingerprint(normalizeTeamPhone(phone)!, SECRET);

function request(method: string, url: string, body?: unknown) {
  return new Request(`https://jata-aftercall.vercel.app${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
  mocks.session = null;
  mocks.user = { phone: "0724317010" };
  mocks.business = { ownerId: "user-1" };
  mocks.events = [];
  vi.clearAllMocks();
});

describe("Kenyan number normalisation and allowlist", () => {
  it("normalises 07, 254 and +254 forms to exactly one identity", () => {
    expect(normalizeTeamPhone("0724317010")).toBe("254724317010");
    expect(normalizeTeamPhone("254724317010")).toBe("254724317010");
    expect(normalizeTeamPhone("+254 724 317 010")).toBe("254724317010");
    expect(normalizeTeamPhone("724317010")).toBe("254724317010");
    expect(normalizeTeamPhone("2540724317010")).toBe("254724317010");
  });

  it("grants only the three authorised numbers and rejects unverifiable values", () => {
    expect(AUTHORIZED_TEAM_PHONES).toEqual(["254724317010", "254721359955", "254727935449"]);
    for (const phone of ["0724317010", "254721359955", "+254 727 935 449"]) expect(isAuthorizedTeamPhone(phone)).toBe(true);
    for (const phone of ["0712345678", null, "", "not-a-phone", "+1 555 0100"]) expect(isAuthorizedTeamPhone(phone)).toBe(false);
  });

  it("binds the fingerprint to both the phone and the server secret", () => {
    expect(fp("0724317010")).toBe(fp("+254724317010"));
    expect(fp("0724317010")).not.toBe(fp("0721359955"));
    expect(fp("0724317010")).not.toBe(teamPhoneFingerprint("254724317010", "another-secret"));
  });
});

describe("pure decision function", () => {
  const base = { phone: "0724317010", fingerprint: fp("0724317010") };
  const verified = {
    action: TEAM_AUDIT_ACTIONS.PHONE_VERIFIED,
    createdAt: new Date("2026-10-27T09:00:00Z"),
    metadata: { challengeId: "c1", phoneFingerprint: base.fingerprint },
  };
  const granted = {
    action: TEAM_AUDIT_ACTIONS.ACCESS_GRANTED,
    createdAt: new Date("2026-10-27T09:00:01Z"),
    metadata: { challengeId: "c1", phoneFingerprint: base.fingerprint },
  };

  it("requires a verified grant with a matching fingerprint", () => {
    expect(deriveTeamFreeAccess({ ...base, events: [verified, granted] }).entitled).toBe(true);
    expect(deriveTeamFreeAccess({ ...base, events: [granted] }).reason).toBe("UNVERIFIED");
    expect(deriveTeamFreeAccess({ ...base, events: [verified, { ...granted, metadata: { phoneFingerprint: "other" } }] }).reason).toBe("PHONE_CHANGED");
    expect(deriveTeamFreeAccess({ ...base, events: [] }).reason).toBe("NO_GRANT");
  });

  it("never honours a grant alone, a URL-style flag or an unverified signup number", () => {
    expect(deriveTeamFreeAccess({ phone: "0712345678", fingerprint: fp("0712345678"), events: [verified, granted] }).reason).toBe("NOT_ALLOWLISTED");
    expect(deriveTeamFreeAccess({ ...base, events: [{ action: "SOME_OTHER_EVENT", createdAt: new Date(), metadata: { teamFreeAccess: true } }] }).entitled).toBe(false);
  });

  it("revocation wins regardless of event ordering passed by a caller", () => {
    const revoked = { action: TEAM_AUDIT_ACTIONS.ACCESS_REVOKED, createdAt: new Date("2026-10-27T10:00:00Z"), metadata: {} };
    expect(deriveTeamFreeAccess({ ...base, events: [verified, granted, revoked] }).reason).toBe("REVOKED");
    expect(deriveTeamFreeAccess({ ...base, events: [revoked, granted, verified] }).reason).toBe("REVOKED");
  });
});

describe("trusted server-side verification chain", () => {
  it("stores only a hash of the code and never a plaintext number or privilege flag", async () => {
    const start = await startTeamPhoneVerification("admin-1", "user-1");
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const metadata = JSON.stringify(mocks.events[0].metadata);
    expect(metadata).not.toContain(start.code);
    expect(metadata).not.toContain("254724317010");
    expect(metadata).toContain("codeHash");
    expect(start.maskedPhone).toContain("•••••");
  });

  it("rejects a wrong code, then grants on the correct code", async () => {
    const start = await startTeamPhoneVerification("admin-1", "user-1");
    if (!start.ok) throw new Error("start failed");
    expect((await verifyTeamPhoneCode("user-1", "000000")).ok).toBe(false);
    expect((await getTeamAccessStatus("user-1")).entitled).toBe(false);
    expect((await verifyTeamPhoneCode("user-1", start.code)).ok).toBe(true);
    const status = await getTeamAccessStatus("user-1");
    expect(status.entitled).toBe(true);
    expect(status.label).toBe(TEAM_FREE_ACCESS_LABEL);
  });

  it("editing a profile number cannot grant, transfer or keep access", async () => {
    const start = await startTeamPhoneVerification("admin-1", "user-1");
    if (!start.ok) throw new Error("start failed");
    await verifyTeamPhoneCode("user-1", start.code);
    mocks.user = { phone: "0721359955" }; // another allowlisted number, unverified for this account
    expect((await getTeamAccessStatus("user-1")).reason).toBe("PHONE_CHANGED");
    expect((await getTeamAccessStatus("user-1")).entitled).toBe(false);
  });

  it("an unverified allowlisted number and an ordinary customer both get no entitlement", async () => {
    expect((await getTeamAccessStatus("user-1")).reason).toBe("NO_GRANT");
    mocks.user = { phone: "0712345678" };
    expect((await getTeamAccessStatus("user-1")).entitled).toBe(false);
    expect((await startTeamPhoneVerification("admin-1", "user-1")).ok).toBe(false);
    expect((await verifyTeamPhoneCode("user-1", "123456")).ok).toBe(false);
  });

  it("revocation removes access, keeps history and leaves ordinary subscription rules intact", async () => {
    const start = await startTeamPhoneVerification("admin-1", "user-1");
    if (!start.ok) throw new Error("start failed");
    await verifyTeamPhoneCode("user-1", start.code);
    const before = mocks.events.length;
    expect((await revokeTeamAccess("admin-1", "user-1")).ok).toBe(true);
    expect(mocks.events.length).toBe(before + 1); // append-only
    expect((await getTeamAccessStatus("user-1")).reason).toBe("REVOKED");
    expect(hasVerifiedPublicationRight({ paidPayment: null, subscription: null })).toBe(false);
    expect(canSetPublished(true, { verifiedPayment: false })).toBe(false);
  });

  it("fails closed when the audit store cannot be read", async () => {
    const start = await startTeamPhoneVerification("admin-1", "user-1");
    if (!start.ok) throw new Error("start failed");
    await verifyTeamPhoneCode("user-1", start.code);
    vi.mocked((await import("@/lib/db")).default.auditEvent.findMany).mockRejectedValueOnce(new Error("db down"));
    expect((await getTeamAccessStatus("user-1")).entitled).toBe(false);
  });
});

describe("entitlements across every eligible product", () => {
  async function grant() {
    const start = await startTeamPhoneVerification("admin-1", "user-1");
    if (!start.ok) throw new Error("start failed");
    await verifyTeamPhoneCode("user-1", start.code);
  }

  it("returns entitled states for Business Page, AI Front Desk, Website Studio, POS and Autopilot", async () => {
    await grant();
    expect(await hasTeamFreeAccessForBusiness("biz-1")).toBe(true);
    expect((await getInteractiveEntitlement("biz-1")).entitled).toBe(true);
    expect((await getAIPackageStatus("biz-1")).entitled).toBe(true);
    expect((await getPosEntitlement("biz-1")).entitled).toBe(true);
    expect((await getAutopilotEntitlement("biz-1")).entitled).toBe(true);
    expect(hasVerifiedPublicationRight({ paidPayment: null, subscription: null }, new Date(), { teamFreeAccess: true })).toBe(true);
    expect(canSetPublished(true, { teamFreeAccess: true })).toBe(true);
    expect(nextActionFor({ isPublished: false, hasContact: true, hasLocation: true, servicesCount: 0, subscriptionStatus: null, teamFreeAccess: true }).key).not.toBe("subscribe");
    expect(resolveOnboardingRedirect({ ownedBusinessCount: 1, businesses: [{ id: "biz-1", hasActiveSubscription: false }], teamFreeAccess: true })).toBe("/dashboard");
  });

  it("does not create fake payments, invoices or subscriptions", async () => {
    await grant();
    const state = await getAIPackageStatus("biz-1");
    expect(state.verification).toBe("VERIFIED");
    expect(state.reason).toBe(TEAM_FREE_ACCESS_LABEL);
    expect(mocks.events.every((event) => !/PAYMENT|SUBSCRIPTION|INVOICE/.test(event.action))).toBe(true);
  });

  it("ordinary customers keep unchanged payment and publishing enforcement", async () => {
    mocks.user = { phone: "0712345678" };
    expect(await hasTeamFreeAccessForBusiness("biz-1")).toBe(false);
    expect(hasVerifiedPublicationRight({ paidPayment: null, subscription: null })).toBe(false);
    expect(canSetPublished(true, { verifiedPayment: false })).toBe(false);
    const paymentEvidence = {
      paidPayment: { status: "PAID" },
      subscription: { status: "ACTIVE", expiresAt: new Date(Date.now() + 86_400_000) },
    };
    expect(hasVerifiedPublicationRight(paymentEvidence)).toBe(true);
    expect(canSetPublished(true, { verifiedPayment: true })).toBe(true);
  });
});

describe("API authorization boundaries", () => {
  it("admin endpoints reject anonymous and non-admin sessions", async () => {
    expect((await adminPost(request("POST", "/api/admin/team-access", { action: "lookup", email: "x@y.com" }))).status).toBe(401);
    mocks.session = { userId: "user-1", email: "x@y.com", role: "CUSTOMER" };
    expect((await adminPost(request("POST", "/api/admin/team-access", { action: "revoke", userId: "user-2" }))).status).toBe(403);
    expect(mocks.events.length).toBe(0);
  });

  it("account endpoints require authentication and never accept a phone, role or entitlement flag", async () => {
    expect((await accountGet()).status).toBe(401);
    mocks.session = { userId: "user-1", email: "x@y.com", role: "CUSTOMER" };
    const response = await accountPost(request("POST", "/api/account/team-access", {
      code: "123456", phone: "0724317010", userId: "admin-1", role: "ADMIN", teamFreeAccess: true,
    }));
    expect(response.status).toBe(400); // no active challenge, extra fields ignored
    expect((await getTeamAccessStatus("user-1")).entitled).toBe(false);
    const body = await (await accountGet()).json();
    expect(body.entitled).toBe(false);
    expect(JSON.stringify(body)).not.toContain("254724317010");
  });

  it("a team entitlement never grants the ADMIN role or admin API access", async () => {
    const start = await startTeamPhoneVerification("admin-1", "user-1");
    if (!start.ok) throw new Error("start failed");
    await verifyTeamPhoneCode("user-1", start.code);
    mocks.session = { userId: "user-1", email: "team@jata.link", role: "CUSTOMER" };
    expect((await adminPost(request("POST", "/api/admin/team-access", { action: "revoke", userId: "user-2" }))).status).toBe(403);
  });
});

describe("server/browser bundle boundary", () => {
  it("replaces the server entitlement module with a fail-closed stub in the CLIENT build only", () => {
    const config = readFileSync("next.config.js", "utf8");
    expect(config).toContain("class ServerOnlyTeamAccessPlugin");
    expect(config).toContain("webpack(config, { isServer })");
    expect(config).toContain("if (!isServer) config.plugins.push(new ServerOnlyTeamAccessPlugin())");
    expect(config).toContain("lib/teamAccessStub.ts");
    const stub = readFileSync("lib/teamAccessStub.ts", "utf8");
    for (const number of AUTHORIZED_TEAM_PHONES) expect(stub).not.toContain(number);
    expect(stub).not.toContain("node:crypto");
    expect(stub).toContain("return false");
  });

  it("keeps every append-only audit action string identical in the server module and lib/audit", async () => {
    const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
    // All five names must stay in lockstep: a drifted string would silently hide a grant or a
    // revocation from the decision function while the admin console still wrote the other name.
    expect(TEAM_AUDIT_ACTIONS.VERIFICATION_STARTED).toBe(actual.AUDIT_ACTIONS.TEAM_VERIFICATION_STARTED);
    expect(TEAM_AUDIT_ACTIONS.VERIFICATION_FAILED).toBe(actual.AUDIT_ACTIONS.TEAM_VERIFICATION_FAILED);
    expect(TEAM_AUDIT_ACTIONS.PHONE_VERIFIED).toBe(actual.AUDIT_ACTIONS.TEAM_PHONE_VERIFIED);
    expect(TEAM_AUDIT_ACTIONS.ACCESS_GRANTED).toBe(actual.AUDIT_ACTIONS.TEAM_ACCESS_GRANTED);
    expect(TEAM_AUDIT_ACTIONS.ACCESS_REVOKED).toBe(actual.AUDIT_ACTIONS.TEAM_ACCESS_REVOKED);
  });

  it("keeps the real allowlist exclusively in the server module, not in any browser stub", () => {
    const server = readFileSync("lib/team-access.ts", "utf8");
    const stub = readFileSync("lib/teamAccessStub.ts", "utf8");
    for (const number of AUTHORIZED_TEAM_PHONES) {
      expect(server, number).toContain(number);
      expect(stub, number).not.toContain(number);
    }
    expect(server).toContain('from "node:crypto"');
    expect(stub).not.toContain("from \"node:crypto\"");
  });
});

describe("allowlist is server-side only", () => {
  it("never imports the entitlement module from a client component", () => {
    const roots = ["components", "app"];
    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx|ts)$/.test(full)) files.push(full);
      }
    }
    roots.forEach(walk);
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.startsWith('"use client"') && /lib\/team-access|team-access"/.test(source) && /AUTHORIZED_TEAM_PHONES|lib\/team-access/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("does not publish the raw allowlist through any public API response", () => {
    const adminSource = readFileSync("app/api/admin/team-access/route.ts", "utf8");
    const accountSource = readFileSync("app/api/account/team-access/route.ts", "utf8");
    expect(adminSource).not.toContain("AUTHORIZED_TEAM_PHONES");
    expect(accountSource).not.toContain("AUTHORIZED_TEAM_PHONES");
    expect(TEAM_FREE_ACCESS_KEY).toBe("JATA_TEAM_FREE_ACCESS");
  });
});
