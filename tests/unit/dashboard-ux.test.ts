import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextActionFor } from "@/lib/nextAction";
import { businessStatusLabel, paymentStatusLabel, subscriptionStatusLabel } from "@/lib/statusLabels";

const base = { isPublished: true, hasContact: true, hasLocation: true, servicesCount: 2, subscriptionStatus: "ACTIVE", expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() };

describe("dashboard next action", () => {
  it("always gives exactly one clear next step, in priority order", () => {
    expect(nextActionFor({ ...base, hasContact: false }).key).toBe("add-contact");
    expect(nextActionFor({ ...base, subscriptionStatus: "EXPIRED" }).key).toBe("renew");
    expect(nextActionFor({ ...base, expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() }).key).toBe("renew");
    expect(nextActionFor({ ...base, isPublished: false }).key).toBe("publish");
    expect(nextActionFor({ ...base, servicesCount: 0 }).key).toBe("add-services");
    expect(nextActionFor({ ...base, subscriptionStatus: null }).key).toBe("subscribe");
    expect(nextActionFor({ ...base, hasLocation: false }).key).toBe("add-location");
    expect(nextActionFor(base).key).toBe("share");
  });
});

describe("human-readable status labels (no raw status codes)", () => {
  it("covers every enum value in the schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const enumValues = (name: string) => {
      const m = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(schema);
      expect(m, name).not.toBeNull();
      return m![1].split(/\s+/).filter(Boolean);
    };
    for (const v of enumValues("SubscriptionStatus")) expect(subscriptionStatusLabel(v).label, v).not.toBe("Unknown");
    for (const v of enumValues("PaymentStatus")) expect(paymentStatusLabel(v).label, v).not.toBe("Unknown");
    for (const v of enumValues("BusinessStatus")) expect(businessStatusLabel(v).label, v).not.toBe("Unknown");
    expect(enumValues("PaymentStatus")).toContain("PENDING");
  });

  it("shows a pending payment as processing, not as failed", () => {
    expect(paymentStatusLabel("PENDING")).toMatchObject({ label: "Processing", tone: "warning" });
    expect(subscriptionStatusLabel(null).label).toBe("No subscription");
    for (const v of ["PENDING", "ACTIVE", "EXPIRED"]) expect(subscriptionStatusLabel(v).label).not.toBe(v);
  });
});

describe("dashboard, subscription and shell source guards", () => {
  const dashboard = readFileSync("components/DashboardClient.tsx", "utf8");
  const subscription = readFileSync("app/dashboard/subscription/page.tsx", "utf8");
  it("no alert() dialogs or full-page reloads in the owner dashboard", () => {
    expect(dashboard).not.toMatch(/\balert\(/);
    expect(dashboard).not.toContain("location.reload");
    expect(dashboard).toContain("router.refresh()");
    expect(readFileSync("components/BusinessPage.tsx", "utf8")).not.toMatch(/\balert\(/);
  });
  it("one plan button per business, not two duplicate links", () => {
    expect(dashboard).not.toContain("View plans and pay");
  });
  it("subscription page renders labels, not raw status codes, and no clipped payment table", () => {
    expect(subscription).toContain("paymentStatusLabel(payment.status)");
    expect(subscription).not.toContain("<td>{payment.status}</td>");
    expect(subscription).not.toContain("<table");
  });
  it("app pages expose a <main> landmark and unique titles", () => {
    expect(readFileSync("components/ui/PageShell.tsx", "utf8")).toContain('<main id="main"');
    expect(readFileSync("app/dashboard/layout.tsx", "utf8")).toContain('<main id="main"');
    expect(readFileSync("app/page.tsx", "utf8")).toContain('<main id="main">');
    const titles = ["app/login/page.tsx", "app/register/page.tsx", "app/onboarding/page.tsx", "app/dashboard/page.tsx", "app/dashboard/subscription/page.tsx", "app/checkout/page.tsx", "app/checkout/callback/layout.tsx"]
      .map((f) => /title: "([^"]+)"/.exec(readFileSync(f, "utf8"))?.[1]);
    expect(titles.every(Boolean)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });
  it("landing footer no longer shows internal jargon to customers", () => {
    const landing = readFileSync("app/page.tsx", "utf8");
    for (const jargon of ["Zero-cost MVP", "No VPS", "merchant 2006074", "configurable by admin", 'href="/health"']) expect(landing).not.toContain(jargon);
  });
});
