/**
 * Website Studio fixture harness: state/outcome parsing, simulated responses, production exclusion and
 * no-I/O guarantees. All data is FICTIONAL. Nothing here reads or writes a business, uploads an image,
 * publishes a website or calls a provider.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FIXTURE_NOTICE,
  isFixtureOutcome,
  isFixtureState,
  simulateCreate,
  simulateDraftWrite,
  simulatePublish,
} from "@/lib/studio/fixtures/studioFixture";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FIXTURE_FILES = [
  "lib/studio/fixtures/studioFixture.ts",
  "components/studio/fixture/StudioFixtureClient.tsx",
  "app/dev/studio-fixture/page.tsx",
  "app/dev/studio-fixture/site/page.tsx",
];

describe("fixture parsing", () => {
  it("accepts only the known states and outcomes", () => {
    for (const s of ["dashboard", "category", "editor", "image", "publish", "preview"]) expect(isFixtureState(s)).toBe(true);
    for (const s of ["", "live", "Dashboard", undefined, null]) expect(isFixtureState(s)).toBe(false);
    expect(isFixtureOutcome("success")).toBe(true);
    expect(isFixtureOutcome("failure")).toBe(true);
    expect(isFixtureOutcome("published")).toBe(false);
  });
});

describe("simulated responses", () => {
  it("draft save: success is simulated and advances only the in-memory version; failure says nothing was saved", async () => {
    const ok = simulateDraftWrite("success", { expectedDraftVersion: 4 });
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody).toEqual({ experience: { draftVersion: 5 }, simulated: true });
    const bad = simulateDraftWrite("failure", { expectedDraftVersion: 4 });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/FICTIONAL FIXTURE: simulated save failure\. Nothing was saved/);
  });

  it("publish: never reports a real publish; success is labelled simulated and points at the fixture site", async () => {
    const ok = simulatePublish("success");
    const body = await ok.json();
    expect(body.published).toBe(true);
    expect(body.simulated).toBe(true);
    expect(body.message).toMatch(/^FICTIONAL FIXTURE: simulated publish\. No customer website was changed\./);
    expect(body.url).toMatch(/^\/dev\/studio-fixture\/site/);
    const bad = simulatePublish("failure");
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/FICTIONAL FIXTURE: simulated publish failure\. The live site is unchanged\./);
  });

  it("category set-up: success is simulated and stores nothing; failure says nothing was created", async () => {
    expect((await simulateCreate("success").json())).toEqual({ ok: true, simulated: true });
    expect((await simulateCreate("failure").json()).error).toMatch(/Nothing was created/);
  });

  it("every fixture notice says the data is fictional", () => {
    expect(FIXTURE_NOTICE).toMatch(/^FICTIONAL FIXTURE/);
    expect(FIXTURE_NOTICE).toMatch(/no website is changed, saved, uploaded or published/);
  });
});

describe("production exclusion", () => {
  const original = process.env.NODE_ENV;
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
    }));
  });
  afterEach(() => {
    (process.env as Record<string, string>).NODE_ENV = original as string;
    vi.doUnmock("next/navigation");
  });

  it("the Studio fixture page calls notFound() in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const mod = await import("@/app/dev/studio-fixture/page");
    await expect(mod.default({ searchParams: Promise.resolve({ state: "editor" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the fixture storefront preview calls notFound() in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const mod = await import("@/app/dev/studio-fixture/site/page");
    await expect(mod.default()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("fixture isolation (source guards)", () => {
  it("no fixture file imports the database, auth, storage, payments or a server action", () => {
    for (const f of FIXTURE_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/db/);
      expect(src, f).not.toMatch(/@prisma\/client/);
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/auth/);
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/(storage|blob|upload|paystack|payments?)/i);
      expect(src, f).not.toMatch(/["']use server["']/);
    }
  });

  it("the fixture client makes no network request of its own (transports are injected)", () => {
    const src = read("components/studio/fixture/StudioFixtureClient.tsx");
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/XMLHttpRequest/);
  });

  it("the picker in the fixture is marked simulated so it never says 'saved'", () => {
    const src = read("components/studio/fixture/StudioFixtureClient.tsx");
    expect(src).toMatch(/<CategoryImagePicker\s+simulated/);
    expect(read("components/media/CategoryImagePicker.tsx")).toMatch(/simulated \? "Simulated in this fixture — nothing was saved\."/);
    expect(read("components/media/CategoryImagePicker.tsx")).toMatch(/simulated \? "Simulated — not saved" : "Image saved"/);
  });

  it("the fixture renders the real Studio canvas, not a copy", () => {
    const src = read("components/studio/fixture/StudioFixtureClient.tsx");
    expect(src).toMatch(/from\s+["']@\/components\/studio\/canvas\/StudioCanvas["']/);
    expect(src).toMatch(/from\s+["']@\/components\/dashboard\/PublishPanel["']/);
    expect(src).toMatch(/from\s+["']@\/components\/dashboard\/CreateExperienceForm["']/);
  });

  it("production publish and create paths still refresh and do not use the fixture transports", () => {
    expect(read("components/dashboard/CreateExperienceForm.tsx")).toMatch(/if \(submitCreate\) setFixtureDone\(true\);\s*else router\.refresh\(\);/);
    expect(read("components/dashboard/PublishPanel.tsx")).toMatch(/refresh/);
  });
});
