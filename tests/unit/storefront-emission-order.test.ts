/**
 * M11 / hydration #418 — emission-order fix regression tests.
 *
 * Root cause (docs/WEBSITE_STUDIO_HYDRATION_INVESTIGATION.md): when a route's
 * `generateMetadata` and page body each ran their own DB loads, the SSR root segment
 * was still pending at Fizz's first flush and the `script#_R_` + Flight bootstrap
 * scripts were emitted BEFORE the content divs. React's body-level hydration walk
 * cannot skip leading scripts (non-root context) and throws #418 against the first
 * expected `div` (proven deterministically by the race harness synthetic arms).
 *
 * The fix shares ONE request-scoped load between metadata and body
 * (`lib/request-cache.ts`), so the root segment completes with the metadata and the
 * bootstrap scripts always land after the content. These tests pin:
 *   1. requestCache really dedups by primitive cache keys (metadata + body pattern);
 *   2. loadStorefront normalises its options object to primitive cache keys;
 *   3. every storefront/studio route wires `generateMetadata` to the same shared load
 *      the body uses (the metadata gate is what closes the flush race).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("react", () => {
  const cache = (fn: (...args: unknown[]) => unknown) => {
    const store = new Map<string, unknown>();
    const wrapped = (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (!store.has(key)) store.set(key, fn(...args));
      return store.get(key);
    };
    return wrapped;
  };
  return { cache };
});

vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => null) },
    businessExperience: { findUnique: vi.fn(async () => null) },
    product: { findMany: vi.fn(async () => []) },
    service: { findMany: vi.fn(async () => []) },
    offer: { findUnique: vi.fn(async () => null) },
  },
}));

const repoRoot = join(__dirname, "..", "..");

describe("M11 #418 request-scoped dedup (metadata + body share one load)", () => {
  it("collapses duplicate loads with equal cache keys", async () => {
    const { requestCache } = await import("@/lib/request-cache");
    let calls = 0;
    const load = requestCache(async (slug: string, allowDraft: boolean) => {
      calls += 1;
      return `${slug}:${allowDraft}`;
    });
    const [first, second] = await Promise.all([load("qa", true), load("qa", true)]);
    await load("qa", true);
    expect(calls).toBe(1);
    expect(first).toBe("qa:true");
    expect(second).toBe("qa:true");
  });

  it("keeps distinct cache keys separate", async () => {
    const { requestCache } = await import("@/lib/request-cache");
    let calls = 0;
    const load = requestCache(async (slug: string, allowDraft: boolean) => {
      calls += 1;
      return `${slug}:${allowDraft}`;
    });
    await Promise.all([load("qa", true), load("qa", false), load("qb", true)]);
    expect(calls).toBe(3);
  });

  it("loadStorefront normalises option objects to primitive keys so metadata and body share one query", async () => {
    const prisma = (await import("@/lib/db")).default as unknown as {
      business: { findUnique: ReturnType<typeof vi.fn> };
    };
    const { loadStorefront } = await import("@/lib/experience/storefront");
    // Distinct option objects with equal values must land on one cache entry.
    const [a, b] = await Promise.all([
      loadStorefront("qa-slug", { allowDraft: true }),
      loadStorefront("qa-slug", { allowDraft: true }),
    ]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(prisma.business.findUnique).toHaveBeenCalledTimes(1);
    // A different option value is a different cache entry.
    await loadStorefront("qa-slug", { allowDraft: true, preferDraft: true });
    expect(prisma.business.findUnique).toHaveBeenCalledTimes(2);
    // A different slug is a different cache entry.
    await loadStorefront("other-slug", { allowDraft: true });
    expect(prisma.business.findUnique).toHaveBeenCalledTimes(3);
    (prisma.business.findUnique as ReturnType<typeof vi.fn>).mockClear();
  });

  it("requestCache falls back to identity when React exports no cache", async () => {
    vi.resetModules();
    vi.doMock("react", () => ({ cache: undefined }));
    const { requestCache } = await import("@/lib/request-cache");
    const fn = async (value: string) => value;
    expect(requestCache(fn)).toBe(fn);
    vi.doUnmock("react");
    vi.resetModules();
  });
});

describe("M11 #418 metadata gate: generateMetadata shares the body's data load", () => {
  const pageFiles: Array<[string, string]> = [
    ["app/b/[slug]/page.tsx", "loadStorefront"],
    ["app/b/[slug]/shop/page.tsx", "loadStorefront"],
    ["app/b/[slug]/item/[id]/page.tsx", "loadStorefront"],
    ["app/b/[slug]/book/page.tsx", "loadStorefront"],
    ["app/b/[slug]/enquire/page.tsx", "loadStorefront"],
    ["app/b/[slug]/checkout/page.tsx", "loadStorefront"],
    ["app/b/[slug]/ai/page.tsx", "loadAIPageData"],
    ["app/dashboard/businesses/[id]/page.tsx", "loadWorkspace"],
    ["app/dashboard/businesses/[id]/preview/page.tsx", "loadWorkspace"],
  ];

  it.each(pageFiles)("%s generates metadata from the shared %s load", (relative, loader) => {
    const source = readFileSync(join(repoRoot, relative), "utf8");
    expect(source, `${relative} must export generateMetadata (the head gate that closes the flush race)`).toMatch(
      /export async function generateMetadata/,
    );
    const start = source.search(/export async function generateMetadata/);
    const end = source.indexOf("export default", start);
    const metadataBlock = source.slice(start, end === -1 ? start + 2000 : end);
    expect(
      metadataBlock,
      `${relative}: generateMetadata must await the same ${loader} the page body uses`,
    ).toContain(`${loader}(`);
  });

  it("every module that defines a data loader wraps it in the request cache", () => {
    const loaderModules = [
      "lib/experience/storefront.ts",
      "lib/experience/workspace.ts",
      "app/b/[slug]/page.tsx",
      "app/b/[slug]/shop/page.tsx",
      "app/b/[slug]/item/[id]/page.tsx",
      "app/b/[slug]/book/page.tsx",
      "app/b/[slug]/enquire/page.tsx",
      "app/b/[slug]/checkout/page.tsx",
      "app/b/[slug]/ai/page.tsx",
    ];
    for (const relative of loaderModules) {
      const source = readFileSync(join(repoRoot, relative), "utf8");
      expect(source, `${relative} must wrap its data loader in lib/request-cache.ts`).toMatch(/requestCache/);
    }
  });
});
