/**
 * R-TI-03 — a write is never authorized by membership alone.
 *
 * `canAccessBusiness` / `assertBusinessOwnership` admit every member of a business, including a
 * read-only VIEWER. `guardTenantMutation` used to default to the "read" level, so write handlers that
 * omitted the level let a VIEWER rename the business, redirect its phone and WhatsApp numbers, create
 * products, edit the website draft and post MJENGO journals. The two-tenant PostgreSQL sweep
 * (tests/prisma/tenant-isolation-matrix-postgres.test.ts, phase 3) found it by row fingerprint.
 *
 * This file pins the fix two ways:
 *   1. statically: every POST/PUT/PATCH/DELETE route handler that checks membership also checks a
 *      role, unless it is on the short, justified allowlist below;
 *   2. behaviourally: the real lib/tenant guards refuse VIEWER and STAFF for settings and
 *      configuration, and allow OWNER and MANAGER.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const memberships = vi.hoisted(() => ({ rows: [] as Array<{ userId: string; businessId: string; role: string }>, ownerOf: {} as Record<string, string> }));
vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findFirst: async ({ where }: any) => (memberships.ownerOf[where.id] === where.ownerId ? { id: where.id } : null),
      findUnique: async ({ where }: any) => (memberships.ownerOf[where.id] ? { id: where.id, ownerId: memberships.ownerOf[where.id] } : null),
      findMany: async ({ where }: any) => Object.entries(memberships.ownerOf).filter(([, owner]) => owner === where?.ownerId).map(([id]) => ({ id })),
    },
    businessMember: {
      findMany: async ({ where }: any) => memberships.rows.filter((m) => m.userId === where.userId),
    },
  },
}));

import { canMemberPerform, guardTenantMutation } from "@/lib/tenant";

const MEMBERSHIP_CHECKS = ["canAccessBusiness", "assertBusinessOwnership", "loadBusinessForTenant"];
const ROLE_CHECKS = [
  "guardTenantMutation", "canMemberPerform", "assertBusinessRole", "canBusinessRolePerform", "getBusinessRoleForUser",
  "authorizeOwner", "guardStudioWebsiteMutation", "assertStudioWebsiteAccess", "handlePosRequest", "handleErpRequest",
];
/** Membership-only writes that are deliberate. Each needs a reason a reviewer can check. */
const ALLOWED_MEMBERSHIP_ONLY: Record<string, string> = {
  "app/api/ai/chat/route.ts POST": "A member chatting with their own AI Front Desk is a preview conversation (a read); customers use the same route unauthenticated against a published desk.",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === "route.ts" ? [full] : [];
  });
}

function writeHandlers(source: string): Array<{ method: string; body: string }> {
  const out: Array<{ method: string; body: string }> = [];
  const re = /export async function (POST|PUT|PATCH|DELETE)\b([\s\S]*?)(?=\nexport async function|\nexport const|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push({ method: m[1], body: m[2] });
  return out;
}

describe("no write handler is authorized by membership alone (R-TI-03)", () => {
  it("every POST/PUT/PATCH/DELETE that checks membership also checks a role", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of routeFiles("app/api")) {
      const rel = file.split(path.sep).join("/");
      for (const { method, body } of writeHandlers(readFileSync(file, "utf8"))) {
        if (MEMBERSHIP_CHECKS.some((k) => body.includes(k)) || ROLE_CHECKS.some((k) => body.includes(k))) scanned += 1;
        if (!MEMBERSHIP_CHECKS.some((k) => body.includes(k))) continue;
        if (ROLE_CHECKS.some((k) => body.includes(k))) continue;
        if (ALLOWED_MEMBERSHIP_ONLY[`${rel} ${method}`]) continue;
        offenders.push(`${rel} ${method}`);
      }
    }
    expect(scanned).toBeGreaterThan(30); // the scan really covers the tenant write handlers
    expect(offenders).toEqual([]);
  });

  it("guardTenantMutation has no default level (every caller states it)", () => {
    const tenant = readFileSync("lib/tenant.ts", "utf8");
    expect(tenant).toMatch(/requiredAction: RolePermissionLevel,\n\)/);
    expect(tenant).not.toMatch(/requiredAction: RolePermissionLevel = "read"/);
    expect(readFileSync("lib/business-hub/guard.ts", "utf8")).not.toMatch(/action: RolePermissionLevel = "read"/);
  });

  it("the handlers the PostgreSQL sweep caught now ask for the right level", () => {
    expect(readFileSync("app/api/business/route.ts", "utf8")).toContain('body.isPublished !== undefined ? "publish" : "manage_settings"');
    expect(readFileSync("app/api/products/route.ts", "utf8")).toContain('guardTenantMutation(session, businessId, "configure")');
    expect(readFileSync("app/api/experience/route.ts", "utf8")).toContain('guardTenantMutation(session, businessId, "configure")');
    expect(readFileSync("app/api/mjengo/branding/route.ts", "utf8")).toContain('guardTenantMutation(session, businessId, "manage_settings")');
    expect(readFileSync("app/api/mjengo/journal/route.ts", "utf8")).toContain('guardTenantMutation(session, businessId, "high_risk")');
  });
});

describe("real lib/tenant role guards (R-TI-03)", () => {
  memberships.ownerOf = { bizA: "owner" };
  memberships.rows = [
    { userId: "manager", businessId: "bizA", role: "MANAGER" },
    { userId: "staff", businessId: "bizA", role: "STAFF" },
    { userId: "viewer", businessId: "bizA", role: "VIEWER" },
    { userId: "odd", businessId: "bizA", role: "SUPERVISOR" },
  ];
  const session = (userId: string) => ({ userId, role: "CUSTOMER", email: `${userId}@test.invalid` }) as any;

  it.each([
    ["owner", "manage_settings", true], ["manager", "manage_settings", true], ["staff", "manage_settings", false], ["viewer", "manage_settings", false],
    ["owner", "configure", true], ["manager", "configure", true], ["staff", "configure", false], ["viewer", "configure", false],
    ["staff", "manage_orders", true], ["viewer", "manage_orders", false], ["viewer", "operate", false], ["viewer", "read", true],
    ["odd", "read", true], ["odd", "operate", false], ["stranger", "read", false],
  ] as const)("%s → %s: %s", async (user, action, allowed) => {
    const guard = await guardTenantMutation(session(user), "bizA", action);
    expect(guard.ok).toBe(allowed);
    if (user !== "stranger" && action !== "read") expect(await canMemberPerform(user, "bizA", "CUSTOMER", action)).toBe(allowed);
  });
});
