/**
 * Demo-data remediation — the four advertised demo pages were live but empty.
 * `restoreDemoBusinesses` must repair exactly those four slugs, idempotently, without touching
 * unrelated businesses, users/admins, subscriptions, payments or publication state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Row = Record<string, any>;
const h = vi.hoisted(() => {
  const tables: Record<string, Row[]> = { business: [], service: [], offer: [], user: [], payment: [], subscription: [], businessMember: [] };
  let seq = 0;
  const log: string[] = [];
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  const table = (name: string) => ({
    findUnique: async ({ where }: any) => structuredClone(tables[name].find((r) => matches(r, where)) ?? null),
    findFirst: async ({ where }: any) => structuredClone(tables[name].find((r) => matches(r, where ?? {})) ?? null),
    findMany: async ({ where }: any = {}) => structuredClone(tables[name].filter((r) => matches(r, where ?? {}))),
    create: async ({ data }: any) => {
      log.push(`${name}.create`);
      const { members, ...rest } = data;
      const row = { id: `${name}-${++seq}`, ...rest };
      tables[name].push(row);
      if (members?.create) tables.businessMember.push({ id: `bm-${++seq}`, businessId: row.id, ...members.create });
      return structuredClone(row);
    },
    update: async ({ where, data }: any) => {
      log.push(`${name}.update`);
      const row = tables[name].find((r) => matches(r, where))!;
      Object.assign(row, data);
      return structuredClone(row);
    },
    upsert: async ({ where, update, create }: any) => {
      log.push(`${name}.upsert`);
      const row = tables[name].find((r) => matches(r, where));
      if (row) Object.assign(row, update);
      else tables[name].push({ id: `${name}-${++seq}`, ...create });
      return null;
    },
  });
  const db: any = { $transaction: async (work: any) => work(db) };
  for (const name of Object.keys(tables)) db[name] = table(name);
  return { tables, db, log, ai: { entitled: false } };
});

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));
vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findUnique: async ({ where }: any) => {
        const b = h.tables.business.find((r) => r.slug === where.slug);
        if (!b) return null;
        return {
          ...structuredClone(b),
          services: h.tables.service.filter((s) => s.businessId === b.id).sort((a, c) => a.sortOrder - c.sortOrder),
          offer: h.tables.offer.find((o) => o.businessId === b.id) ?? null,
          subscription: h.tables.subscription.find((s) => s.businessId === b.id) ?? null,
          members: h.tables.businessMember.filter((m) => m.businessId === b.id),
        };
      },
    },
    businessExperience: { findUnique: async () => null },
  },
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("@/lib/referral", () => ({ ensureReferralCode: async () => null, referralPath: () => "/r/x" }));
vi.mock("@/lib/ai-entitlement", () => ({ getAIPackageStatus: async () => ({ entitled: h.ai.entitled }) }));

import { DEMO_BUSINESSES, DEMO_SLUGS, restoreDemoBusinesses } from "@/lib/demoData";
import { normalizeKePhone } from "@/lib/phone";
import PublicBusinessPage from "@/app/b/[slug]/page";

const EMPTY = { phone: null, whatsapp: null, location: null, description: null, theme: "clean", aftercallMsg: null, openingHours: null };
const reset = () => {
  for (const k of Object.keys(h.tables)) h.tables[k].length = 0;
  h.log.length = 0;
  h.ai.entitled = false;
};
const seedEmptyDemos = () => {
  h.tables.user.push({ id: "owner-1", email: "owner@example.com", role: "CUSTOMER" });
  for (const [i, slug] of DEMO_SLUGS.entries()) {
    h.tables.business.push({ id: `demo-${i}`, slug, name: slug, category: "Other", ownerId: "owner-1", isPublished: true, status: "ACTIVE", ...EMPTY });
  }
};
const real = () => {
  h.tables.user.push({ id: "cust-1", email: "real@customer.co.ke", role: "CUSTOMER" });
  h.tables.business.push({ id: "real-1", slug: "real-salon", name: "Real Salon", category: "Beauty", ownerId: "cust-1", isPublished: true, status: "ACTIVE", phone: "0711111111", description: "mine", theme: "warm" });
  h.tables.service.push({ id: "svc-real", businessId: "real-1", title: "Braiding", priceLabel: "KES 9,999", sortOrder: 0 });
  h.tables.subscription.push({ id: "sub-1", businessId: "real-1", plan: "ANNUAL" });
  h.tables.payment.push({ id: "pay-1", businessId: "real-1", reference: "PSK_real_123", status: "PAID" });
};
const snapshot = () => JSON.stringify(h.tables);

describe("demo data definitions", () => {
  it("supports exactly the four advertised slugs", () => {
    expect([...DEMO_SLUGS]).toEqual(["nyumbani-kitchen", "marys-beauty-studio", "kamau-auto-care", "john-kamau-properties"]);
  });

  it("uses placeholder contact numbers that are valid, unique and not real-looking", () => {
    const phones = DEMO_BUSINESSES.map((d) => d.phone);
    expect(new Set(phones).size).toBe(4);
    for (const d of DEMO_BUSINESSES) {
      expect(d.phone).toMatch(/^070000000\d$/);
      expect(normalizeKePhone(d.phone)).not.toBeNull();
      expect(d.description).toContain("Example page");
      expect(d.services.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("restoreDemoBusinesses", () => {
  beforeEach(() => { reset(); seedEmptyDemos(); real(); });

  it("dry run writes nothing", async () => {
    const before = snapshot();
    const report = await restoreDemoBusinesses(h.db, { apply: false });
    expect(report.applied).toBe(false);
    expect(snapshot()).toBe(before);
    expect(h.log).toEqual([]);
  });

  it("restores content for the four demos", async () => {
    await restoreDemoBusinesses(h.db, { apply: true });
    for (const demo of DEMO_BUSINESSES) {
      const b = h.tables.business.find((r) => r.slug === demo.slug)!;
      expect(b).toMatchObject({ name: demo.name, category: demo.category, phone: demo.phone, whatsapp: demo.whatsapp, location: demo.location, theme: demo.theme, description: demo.description, aftercallMsg: demo.aftercallMsg });
      expect(JSON.parse(b.openingHours)).toEqual(demo.openingHours);
      const services = h.tables.service.filter((s) => s.businessId === b.id);
      expect(services.map((s) => s.title)).toEqual(demo.services.map((s) => s.title));
      expect(h.tables.offer.find((o) => o.businessId === b.id)).toMatchObject({ title: demo.offer.title });
    }
  });

  it("is idempotent — a second run leaves the data identical", async () => {
    await restoreDemoBusinesses(h.db, { apply: true });
    const after1 = snapshot();
    await restoreDemoBusinesses(h.db, { apply: true });
    expect(snapshot()).toBe(after1);
    expect(h.tables.service.filter((s) => s.businessId.startsWith("demo-"))).toHaveLength(12);
    expect(h.tables.offer).toHaveLength(4);
  });

  it("never modifies a non-demo business, its services, subscription or payments", async () => {
    const protectedBefore = JSON.stringify([
      h.tables.business.find((r) => r.id === "real-1"),
      h.tables.service.filter((s) => s.businessId === "real-1"),
      h.tables.subscription,
      h.tables.payment,
    ]);
    await restoreDemoBusinesses(h.db, { apply: true });
    const protectedAfter = JSON.stringify([
      h.tables.business.find((r) => r.id === "real-1"),
      h.tables.service.filter((s) => s.businessId === "real-1"),
      h.tables.subscription,
      h.tables.payment,
    ]);
    expect(protectedAfter).toBe(protectedBefore);
  });

  it("creates no user or admin, and no subscription or payment", async () => {
    const usersBefore = JSON.stringify(h.tables.user);
    await restoreDemoBusinesses(h.db, { apply: true, ownerEmail: "owner@example.com" });
    expect(JSON.stringify(h.tables.user)).toBe(usersBefore);
    expect(h.tables.user.some((u) => u.role === "ADMIN")).toBe(false);
    expect(h.log.some((l) => l.startsWith("user.") || l.startsWith("subscription.") || l.startsWith("payment."))).toBe(false);
    expect(h.tables.subscription).toHaveLength(1);
    expect(h.tables.payment).toHaveLength(1);
  });

  it("leaves owner, publication and status exactly as they were", async () => {
    h.tables.business.find((r) => r.slug === "kamau-auto-care")!.isPublished = false;
    h.tables.business.find((r) => r.slug === "kamau-auto-care")!.status = "SUSPENDED";
    h.tables.business.find((r) => r.slug === "nyumbani-kitchen")!.ownerId = "someone-else";
    await restoreDemoBusinesses(h.db, { apply: true });
    expect(h.tables.business.find((r) => r.slug === "kamau-auto-care")).toMatchObject({ isPublished: false, status: "SUSPENDED" });
    expect(h.tables.business.find((r) => r.slug === "nyumbani-kitchen")!.ownerId).toBe("someone-else");
    expect(h.tables.business.find((r) => r.slug === "marys-beauty-studio")).toMatchObject({ isPublished: true, status: "ACTIVE", ownerId: "owner-1" });
  });

  it("does not delete extra services a demo already has, and updates matching ones in place", async () => {
    h.tables.service.push({ id: "extra", businessId: "demo-1", title: "Custom extra", priceLabel: "KES 1", sortOrder: 9 });
    h.tables.service.push({ id: "old", businessId: "demo-1", title: "Nails", priceLabel: "KES 1", sortOrder: 5 });
    await restoreDemoBusinesses(h.db, { apply: true });
    const services = h.tables.service.filter((s) => s.businessId === "demo-1");
    expect(services.find((s) => s.id === "extra")).toBeTruthy();
    expect(services.filter((s) => s.title === "Nails")).toHaveLength(1);
    expect(services.find((s) => s.id === "old")!.priceLabel).toBe("From KES 800");
  });

  it("skips a demo slug that carries a real (non-demo) payment", async () => {
    h.tables.payment.push({ id: "pay-x", businessId: "demo-0", reference: "PSK_customer_777", status: "PAID" });
    const report = await restoreDemoBusinesses(h.db, { apply: true });
    expect(report.outcomes.find((o) => o.slug === "nyumbani-kitchen")).toMatchObject({ action: "skipped" });
    expect(h.tables.business.find((r) => r.slug === "nyumbani-kitchen")!.phone).toBeNull();
    expect(h.tables.service.filter((s) => s.businessId === "demo-0")).toHaveLength(0);
    expect(h.tables.business.find((r) => r.slug === "kamau-auto-care")!.phone).toBe("0700000003");
  });

  it("treats the seed's fabricated demo- payments as demo data, not real customer money", async () => {
    h.tables.payment.push({ id: "pay-d", businessId: "demo-0", reference: "demo-nyumbani-kitchen", status: "PAID" });
    const report = await restoreDemoBusinesses(h.db, { apply: true });
    expect(report.outcomes.find((o) => o.slug === "nyumbani-kitchen")!.action).toBe("updated");
  });

  it("does not create missing demos without an existing owner, and never creates a user", async () => {
    reset();
    real();
    const report = await restoreDemoBusinesses(h.db, { apply: true, ownerEmail: "nobody@example.com" });
    expect(report.outcomes.every((o) => o.action === "skipped")).toBe(true);
    expect(h.tables.business).toHaveLength(1);
    expect(h.tables.user).toHaveLength(1);
  });

  it("creates missing demos for an existing owner, published and with no billing rows", async () => {
    reset();
    real();
    await restoreDemoBusinesses(h.db, { apply: true, ownerEmail: "REAL@customer.co.ke" });
    for (const slug of DEMO_SLUGS) {
      const b = h.tables.business.find((r) => r.slug === slug)!;
      expect(b).toMatchObject({ ownerId: "cust-1", isPublished: true, status: "ACTIVE" });
    }
    expect(h.tables.subscription).toHaveLength(1);
    expect(h.tables.payment).toHaveLength(1);
    expect(h.tables.service.filter((s) => s.businessId !== "real-1")).toHaveLength(12);
  });
});

describe("public demo pages after restore", () => {
  beforeEach(() => { reset(); seedEmptyDemos(); });
  const render = async (slug: string) =>
    renderToStaticMarkup(await PublicBusinessPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));

  it("are empty before the restore (the production defect)", async () => {
    const html = await render("kamau-auto-care");
    expect(html).toContain("No services listed yet");
  });

  it.each(DEMO_BUSINESSES.map((d) => [d.slug, d] as const))("%s renders its restored content", async (_slug, demo) => {
    await restoreDemoBusinesses(h.db, { apply: true });
    const html = await render(demo.slug);
    expect(html).toContain(demo.name.replace("'", "&#x27;"));
    for (const s of demo.services) {
      expect(html).toContain(s.title.replace("'", "&#x27;"));
      expect(html).toContain(s.priceLabel);
    }
    expect(html).toContain(demo.location);
    expect(html).toContain(demo.offer.title);
    expect(html).toContain(`tel:+254${demo.phone.slice(1)}`);
    expect(html).toContain(`wa.me/254${demo.whatsapp.slice(1)}`);
    expect(html).not.toContain("No services listed yet");
    expect(html).not.toContain("Contact details coming soon");
    expect(html).not.toContain("real@customer");
  });

  it("keeps the AI link governed by the entitlement check", async () => {
    await restoreDemoBusinesses(h.db, { apply: true });
    expect(await render("nyumbani-kitchen")).not.toContain("Ask AI Front Desk");
    h.ai.entitled = true;
    expect(await render("nyumbani-kitchen")).toContain("/b/nyumbani-kitchen/ai");
  });

  it("does not make an unpublished demo public", async () => {
    h.tables.business.find((r) => r.slug === "kamau-auto-care")!.isPublished = false;
    await restoreDemoBusinesses(h.db, { apply: true });
    await expect(render("kamau-auto-care")).rejects.toThrow("NOT_FOUND");
  });
});
