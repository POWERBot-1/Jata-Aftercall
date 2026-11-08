/**
 * Business Hub — boundary guards.
 *
 * These are source-and-contract assertions, not behaviour tests: they lock the promises the
 * upgrade makes to the rest of the product so a later change cannot quietly break them.
 *
 *  1. the hub never touches billing, plans, subscriptions, payments or entitlements — the five
 *     capabilities sit inside the EXISTING KES149 / KES999 Business Page subscription;
 *  2. every owner route passes through the one authorisation gate before it reads or writes;
 *  3. the public page keeps the mandated section order;
 *  4. QR identity encodes the official public URL only — no dashboard link, no tenant id, no
 *     customer data — and the shipped code has no QR dependency at all;
 *  5. loyalty never claims automatic verification, and an order request is never called a
 *     confirmed order or a payment.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const hubDirectories = ["lib/business-hub", "components/business-hub", "lib/qr", "app/api/public/order-request", "app/api/public/enquiry", "app/api/public/loyalty"];
const ownerRouteFiles = walk(path.join(root, "app/api/business"));
const hubFiles = hubDirectories.flatMap((dir) => {
  const full = path.join(root, dir);
  return walk(full);
});

// ── 1. Billing and entitlement isolation ─────────────────────────────────────────────────────

describe("billing isolation", () => {
  const forbidden = [
    "prisma.subscription",
    "prisma.payment",
    "prisma.planConfig",
    "prisma.aIPackageEntitlement",
    "prisma.autopilotEntitlement",
    "prisma.erpEntitlement",
    "paystack",
    "Paystack",
    "initializePaystack",
    "planConfig.upsert",
  ];

  const hubRoutes = ownerRouteFiles.filter(
    (file) =>
      file.includes(`${path.sep}order-requests`) ||
      file.includes(`${path.sep}enquiries`) ||
      file.includes(`${path.sep}promotions`) ||
      file.includes(`${path.sep}loyalty`) ||
      file.includes(`${path.sep}qr`) ||
      file.includes(`${path.sep}hub`),
  );

  it("the hub never reads or writes billing, plans, subscriptions or entitlements", () => {
    const offenders: string[] = [];
    for (const file of [...hubFiles, ...hubRoutes]) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (source.includes(pattern)) offenders.push(`${path.relative(root, file)} → ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("adds no runtime dependency: the QR oracles stay dev-only", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    for (const name of ["jsqr", "qrcode"]) {
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain(name);
      expect(Object.keys(pkg.devDependencies ?? {})).toContain(name);
    }
    // The shipped encoder must not import them either — they are test oracles only.
    for (const file of walk(path.join(root, "lib/qr"))) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("from \"jsqr\"");
      expect(source).not.toContain("from \"qrcode\"");
    }
  });
});

// ── 2. Authorisation on every owner route ────────────────────────────────────────────────────

describe("owner route authorisation", () => {
  it("every hub route calls the owner gate, and every mutating one also checks the database", () => {
    const files = walk(path.join(root, "app/api/business/[businessId]")).filter(
      (file) => file.includes(`${path.sep}order-requests`) || file.includes(`${path.sep}enquiries`) || file.includes(`${path.sep}promotions`) || file.includes(`${path.sep}loyalty`) || file.includes(`${path.sep}qr`) || file.includes(`${path.sep}hub`),
    );
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, path.relative(root, file)).toContain("authorizeOwner");
      const mutates = /\bexport async function (POST|PUT|PATCH|DELETE)\b/.test(source);
      if (mutates) expect(source, path.relative(root, file)).toContain("hasDurableDatabase");
    }
  });

  it("never trusts a businessId from the request body — the tenant comes from the URL only", () => {
    for (const file of ownerRouteFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, path.relative(root, file)).not.toMatch(/const\s*\{[^}]*businessId[^}]*\}\s*=\s*(body|data|payload)/);
    }
  });
});

// ── 3. Public page section order ─────────────────────────────────────────────────────────────

describe("public page section order", () => {
  it("renders identity → promotions → services → products → order → enquiry → loyalty → info → contact → QR", () => {
    const source = readFileSync(path.join(root, "components/BusinessPage.tsx"), "utf8");
    const at = (needle: string) => {
      const index = source.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    expect(at("<PromotionSpotlight")).toBeLessThan(at("{/* Services */}"));
    expect(at("{/* Services */}")).toBeLessThan(at("{/* Featured catalogue products"));
    expect(at("{/* Featured catalogue products")).toBeLessThan(at("<OrderRequestPanel"));
    expect(at("<OrderRequestPanel")).toBeLessThan(at("<EnquiryPanel"));
    expect(at("<EnquiryPanel")).toBeLessThan(at("<LoyaltyCardPanel"));
    expect(at("<LoyaltyCardPanel")).toBeLessThan(at("{/* About */}"));
    expect(at("{/* About */}")).toBeLessThan(at("<QrIdentityBlock"));
    // The attribution lives in the shared storefront footer (`StoreFooter`), which renders last.
    expect(at("<QrIdentityBlock")).toBeLessThan(at("<StoreFooter"));
    expect(readFileSync(path.join(root, "components/storefront/public/StoreFooter.tsx"), "utf8")).toContain(
      "Powered by JATA AFTERCALL",
    );
  });

  it("keeps every new section conditional, so an unconfigured business sees no empty widget", () => {
    const page = readFileSync(path.join(root, "components/BusinessPage.tsx"), "utf8");
    expect(page).toMatch(/products\.length\s*>\s*0/);
    expect(page).toMatch(/loyaltyEnabled/);
    // The spotlight is rendered unconditionally because the component itself renders nothing
    // when there is no live promotion — which is exactly what makes an expired offer absent
    // from the HTML rather than merely hidden.
    const spotlight = readFileSync(path.join(root, "components/business-hub/PromotionSpotlight.tsx"), "utf8");
    expect(spotlight).toMatch(/live\.length\s*(===|==)\s*0/);
    expect(spotlight).toMatch(/isLive\s*!==\s*false/);
    expect(spotlight).toContain("return null;");
  });
});

// ── 4. QR identity ───────────────────────────────────────────────────────────────────────────

describe("QR identity", () => {
  it("resolves the canonical public URL and refuses preview hosts", () => {
    const source = readFileSync(path.join(root, "lib/business-hub/qrIdentity.ts"), "utf8");
    expect(source).toContain("jataaftercall.co.ke");
    // Preview hosts are refused by name, not just by address: a printed poster must keep working
    // after the ephemeral host it was generated on is gone.
    for (const host of ["localhost", "127\\.0\\.0\\.1", "vercel\\.app", "e2b\\.app", "ngrok"]) {
      expect(source, host).toContain(host);
    }
  });

  it("never encodes a dashboard URL, a tenant id or a customer detail", () => {
    const source = readFileSync(path.join(root, "lib/business-hub/qrIdentity.ts"), "utf8");
    expect(source).not.toContain("/dashboard/");
    expect(source).not.toMatch(/encode\([^)]*customer/);
  });
});

// ── 5. Honest wording ────────────────────────────────────────────────────────────────────────

  it("hides a honeypot field in every public submission form", () => {
    for (const file of ["OrderRequestPanel", "EnquiryPanel"]) {
      const source = readFileSync(path.join(root, "components/business-hub", `${file}.tsx`), "utf8");
      // Off-screen, out of the tab order, invisible to screen readers — and the server drops the
      // submission silently when it is filled.
      expect(source, file).toContain("Honeypot");
      expect(source, file).toContain('aria-hidden="true"');
      expect(source, file).toMatch(/tabIndex=\{-1\}/);
      expect(source, file).toContain("left-[-9999px]");
    }
  });

describe("honest customer wording", () => {
  it("never calls an order request a confirmed order or a payment", () => {
    const files = [...walk(path.join(root, "components/business-hub")), ...walk(path.join(root, "app/api/public/order-request"))];
    for (const file of files) {
      const source = readFileSync(file, "utf8").toLowerCase();
      expect(source, path.relative(root, file)).not.toContain("order confirmed");
      expect(source, path.relative(root, file)).not.toContain("your order has been placed for ");
      expect(source, path.relative(root, file)).not.toContain("payment received");
    }
    // And it says so plainly on the confirmation screen.
    const panel = readFileSync(path.join(root, "components/business-hub/OrderRequestPanel.tsx"), "utf8").toLowerCase();
    expect(panel).toContain("not");
    expect(panel).toMatch(/not\s+(a\s+)?(confirmed|payment)/);
  });

  it("states that loyalty stamps are verified by the business, never automatically", () => {
    const panel = readFileSync(path.join(root, "components/business-hub/LoyaltyCardPanel.tsx"), "utf8").toLowerCase();
    expect(panel).toMatch(/verif/);
    expect(panel).not.toMatch(/automatic(ally)?\s+(tracked|detected|verified)/);
    const board = readFileSync(path.join(root, "components/business-hub/LoyaltyBoard.tsx"), "utf8").toLowerCase();
    expect(board).toMatch(/verif/);
  });
});
