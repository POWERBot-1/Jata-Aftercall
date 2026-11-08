import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/experience/ensure-default-website");

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({
  get default() { return holder.client; },
  get prisma() { return holder.client; },
}));

import { ensureDefaultStudioWebsite } from "@/lib/experience/ensure-default-website";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `studio-tenant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let client: any;
const ids: Record<string, string> = {};

function session(userId: string) {
  return { userId, email: `${userId}@example.test`, role: "CUSTOMER", name: "Studio test" };
}

async function makeUser(label: string) {
  return client.user.create({
    data: { email: `studio-${label}-${stamp}@example.test`, name: label, passwordHash: "not-a-real-login" },
  });
}

describe.skipIf(!enabled)("Website Studio workspace and website tenant isolation on PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    holder.client = client;
    const ownerA = await makeUser("owner-a");
    const ownerB = await makeUser("owner-b");
    const managerA = await makeUser("manager-a");
    const viewerA = await makeUser("viewer-a");
    const unlinkedA = await makeUser("unlinked-a");
    ids.ownerA = ownerA.id;
    ids.ownerB = ownerB.id;
    ids.managerA = managerA.id;
    ids.viewerA = viewerA.id;
    ids.unlinkedA = unlinkedA.id;

    const businessA = await client.business.create({
      data: { ownerId: ownerA.id, slug: `studio-a-${stamp}`, name: "Studio Tenant A", category: "retail" },
    });
    const businessB = await client.business.create({
      data: { ownerId: ownerB.id, slug: `studio-b-${stamp}`, name: "Studio Tenant B", category: "retail" },
    });
    ids.businessA = businessA.id;
    ids.businessB = businessB.id;

    await client.businessMember.createMany({
      data: [
        { userId: managerA.id, businessId: businessA.id, role: "MANAGER" },
        { userId: viewerA.id, businessId: businessA.id, role: "VIEWER" },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      await client.business.deleteMany({ where: { id: { in: [ids.businessA, ids.businessB].filter(Boolean) } } });
      await client.studioWorkspace.deleteMany({ where: { ownerUserId: { in: [ids.ownerA, ids.ownerB].filter(Boolean) } } });
      await client.user.deleteMany({ where: { id: { in: Object.values(ids).filter((id) => id && !id.startsWith("biz")) } } });
    } finally {
      await client.$disconnect().catch(() => {});
    }
  }, 60_000);

  it("provisions an independent default site without creating or changing a commerce entitlement", async () => {
    const site = await ensureDefaultStudioWebsite(ids.businessA, session(ids.ownerA));
    expect(site?.websiteId).toBeTruthy();
    const [mapping, website, entitlement, subscription] = await Promise.all([
      client.studioWorkspaceBusiness.findUnique({ where: { businessId: ids.businessA } }),
      client.studioWebsite.findUnique({ where: { id: site!.websiteId } }),
      client.interactiveBusinessEntitlement.findUnique({ where: { businessId: ids.businessA } }),
      client.subscription.findUnique({ where: { businessId: ids.businessA } }),
    ]);
    expect(mapping?.workspaceId).toBe(site?.workspaceId);
    expect(website?.isDefault).toBe(true);
    expect(website?.businessId).toBe(ids.businessA);
    expect(entitlement).toBeNull();
    expect(subscription).toBeNull();
  });

  it("allows a business manager to edit only when workspace and website roles also allow it", async () => {
    const site = await ensureDefaultStudioWebsite(ids.businessA, session(ids.ownerA));
    const access = await assertStudioWebsiteAccess(site!.websiteId, session(ids.managerA), "edit");
    expect(access.businessId).toBe(ids.businessA);
    expect(access.websiteRole).toBe("EDITOR");
    await expect(assertStudioWebsiteAccess(site!.websiteId, session(ids.managerA), "publish")).rejects.toThrow();
  });

  it("denies a viewer publishing and denies an unlinked business member even if added to the workspace", async () => {
    const site = await ensureDefaultStudioWebsite(ids.businessA, session(ids.ownerA));
    await expect(assertStudioWebsiteAccess(site!.websiteId, session(ids.viewerA), "edit")).rejects.toThrow();
    await client.studioWorkspaceMember.create({
      data: { workspaceId: site!.workspaceId, userId: ids.unlinkedA, role: "OWNER", status: "ACTIVE" },
    });
    await client.studioWebsiteMember.create({
      data: { websiteId: site!.websiteId, userId: ids.unlinkedA, role: "OWNER", status: "ACTIVE" },
    });
    await expect(assertStudioWebsiteAccess(site!.websiteId, session(ids.unlinkedA), "read")).rejects.toThrow();
  });

  it("denies a foreign tenant and rejects a site whose business does not match its workspace", async () => {
    const site = await ensureDefaultStudioWebsite(ids.businessA, session(ids.ownerA));
    await expect(assertStudioWebsiteAccess(site!.websiteId, session(ids.ownerB), "read")).rejects.toThrow();
    await expect(client.studioWebsite.create({
      data: {
        workspaceId: site!.workspaceId,
        businessId: ids.businessB,
        slug: "cross-tenant",
        name: "Cross tenant attempt",
      },
    })).rejects.toThrow();
  });

  it("does not reactivate a workspace or site member suspended by an owner", async () => {
    const site = await ensureDefaultStudioWebsite(ids.businessA, session(ids.ownerA));
    await client.studioWorkspaceMember.update({
      where: { workspaceId_userId: { workspaceId: site!.workspaceId, userId: ids.managerA } },
      data: { status: "SUSPENDED" },
    });
    await client.studioWebsiteMember.update({
      where: { websiteId_userId: { websiteId: site!.websiteId, userId: ids.managerA } },
      data: { status: "SUSPENDED" },
    });
    await ensureDefaultStudioWebsite(ids.businessA, session(ids.ownerA));
    const member = await client.studioWorkspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: site!.workspaceId, userId: ids.managerA } },
      select: { status: true },
    });
    const websiteMember = await client.studioWebsiteMember.findUnique({
      where: { websiteId_userId: { websiteId: site!.websiteId, userId: ids.managerA } },
      select: { status: true },
    });
    expect(member?.status).toBe("SUSPENDED");
    expect(websiteMember?.status).toBe("SUSPENDED");
    await expect(assertStudioWebsiteAccess(site!.websiteId, session(ids.managerA), "read")).rejects.toThrow();
  });
});
