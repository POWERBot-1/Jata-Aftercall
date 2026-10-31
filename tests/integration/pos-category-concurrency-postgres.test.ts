import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any, actorId: "" }));
vi.mock("@/lib/db", () => ({ get default() { return holder.client; } }));
// Only authentication/HTTP transport is replaced. The route, transactions, audit writes and
// queries are real. Tenant/permission authorization is covered by the route security suite.
vi.mock("@/lib/pos/http", async (original) => {
  const actual = await original<typeof import("@/lib/pos/http")>();
  return { ...actual, handlePosRequest: async (p: any) => p.handler({ body: await p.request.json(), actor: { actorId: holder.actorId, actorName: "Owner" } }) };
});
vi.mock("@prisma/client", async (original) => {
  const harness = process.env.PRISMA_WASM_HARNESS_DIR;
  if (!harness) return original();
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)(`${harness}/generated/wasm.js`);
});
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";
import { POST } from "@/app/api/pos/[businessId]/categories/route";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let db: any, ownerId: string, businessId: string;

describe.skipIf(!realPrismaConfigured)("category audit concurrency on PostgreSQL", () => {
  beforeAll(async () => {
    db = makeRealPrisma();
    ownerId = (await db.user.create({ data: { email: `category-race-${stamp}@example.test`, name: "Owner", passwordHash: "test-only" } })).id;
    businessId = (await db.business.create({ data: { ownerId, slug: `category-race-${stamp}`, name: "Business", category: "retail" } })).id;
    holder.actorId = ownerId;
  });
  afterAll(async () => {
    holder.client = db;
    if (businessId) await db.business.delete({ where: { id: businessId } });
    if (ownerId) await db.user.delete({ where: { id: ownerId } });
    if (db) await db.$disconnect();
  });

  async function compete(actions: object[]) {
    let seen = 0, release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // Pause both transactions AFTER the real read to deterministically expose a stale-write race.
    holder.client = new Proxy(db, { get(target, key) {
      if (key === "$transaction") return (fn: any) => target.$transaction((tx: any) => fn(new Proxy(tx, { get(t, k) {
        if (k === "posCategory") return new Proxy(t.posCategory, { get(model, method) {
          if (method === "findFirst") return async (...args: any[]) => {
            const result = await model.findFirst(...args);
            if (++seen === 2) release();
            await gate;
            return result;
          };
          const value = Reflect.get(model, method, model);
          return typeof value === "function" ? value.bind(model) : value;
        } });
        const value = Reflect.get(t, k, t);
        return typeof value === "function" ? value.bind(t) : value;
      } })), { timeout: 15000 });
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const call = (body: object) => POST(new Request("https://jata.test", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ businessId }) }) as any;
    try { return await Promise.all(actions.map(call)); } finally { holder.client = db; }
  }

  it("permits only one of two concurrent identical deactivations, with one audit", async () => {
    const category = await db.posCategory.create({ data: { businessId, name: `active-${stamp}` } });
    const results = await compete([{ action: "deactivate", id: category.id }, { action: "deactivate", id: category.id }]);
    expect(results.map((r: any) => r.status ?? 200).sort()).toEqual([200, 409]);
    expect(results.find((r: any) => r.status === 409).data.code).toBe("CATEGORY_CONFLICT");
    expect((await db.posCategory.findUnique({ where: { id: category.id } })).isActive).toBe(false);
    expect(await db.posAuditEvent.count({ where: { businessId, targetId: category.id, action: "POS_CATEGORY_DEACTIVATE" } })).toBe(1);
    const again = await POST(new Request("https://jata.test", { method: "POST", body: JSON.stringify({ action: "deactivate", id: category.id }) }), { params: Promise.resolve({ businessId }) }) as any;
    expect(again).toMatchObject({ status: 409, data: { code: "CATEGORY_UNCHANGED" } });
    expect(await db.posAuditEvent.count({ where: { businessId, targetId: category.id, action: "POS_CATEGORY_DEACTIVATE" } })).toBe(1);
  });

  it("never audits a stale rename or delete when both read the same category", async () => {
    const category = await db.posCategory.create({ data: { businessId, name: `delete-${stamp}` } });
    const results = await compete([{ action: "delete", id: category.id }, { action: "rename", id: category.id, name: `renamed-${stamp}` }]);
    expect(results.map((r: any) => r.status ?? 200).sort()).toEqual([200, 409]);
    expect(results.find((r: any) => r.status === 409).data.code).toBe("CATEGORY_CONFLICT");
    const audits = await db.posAuditEvent.findMany({ where: { businessId, targetId: category.id } });
    expect(audits).toHaveLength(1);
    const remaining = await db.posCategory.findUnique({ where: { id: category.id } });
    if (remaining) { expect(remaining.name).toBe(`renamed-${stamp}`); expect(audits[0].action).toBe("POS_CATEGORY_RENAME"); }
    else expect(audits[0].action).toBe("POS_CATEGORY_DELETE");
  });
});
