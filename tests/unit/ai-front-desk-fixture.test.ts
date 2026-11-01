/**
 * AI Business Front Desk fixture: production exclusion, fail-closed transport, simulated labelling and
 * fixture isolation (no database, no auth, no real AI or messaging service). FICTIONAL data only.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AI_FIXTURE_NOTICE,
  isAiFixtureOutcome,
  simulateAiFixtureApi,
  simulatedReply,
} from "@/lib/ai/fixtures/aiFrontDeskFixture";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FILES = [
  "lib/ai/fixtures/aiFrontDeskFixture.ts",
  "components/ai/fixture/AIFrontDeskFixtureClient.tsx",
  "app/dev/ai-front-desk-fixture/page.tsx",
];

describe("fixture outcomes", () => {
  it("accepts only the known outcomes", () => {
    expect(isAiFixtureOutcome("success")).toBe(true);
    expect(isAiFixtureOutcome("empty")).toBe(true);
    expect(isAiFixtureOutcome("failure")).toBe(true);
    expect(isAiFixtureOutcome("live")).toBe(false);
    expect(isAiFixtureOutcome(undefined)).toBe(false);
  });
});

describe("simulated replies are labelled and grounded", () => {
  it("every reply says it is simulated and not from a live AI service", () => {
    for (const q of ["Do you deliver?", "How much is a braid?", "Are you open Sunday?"]) {
      for (const outcome of ["success", "empty"] as const) {
        const { reply } = simulatedReply(q, outcome);
        expect(reply).toMatch(/^SIMULATED FIXTURE REPLY — not from a live AI service\./);
      }
    }
  });

  it("delivery questions report missing information instead of inventing a zone", () => {
    expect(simulatedReply("Do you deliver to Kitengela?", "success").missing).toEqual(["Delivery zones and fees"]);
  });

  it("prices come only from the fictional catalogue", () => {
    const { reply } = simulatedReply("How much is a braid?", "success");
    expect(reply).toMatch(/KES 1,500/);
    expect(reply).toMatch(/KES 1,200/);
  });
});

describe("simulated transport", () => {
  const body = (o: Record<string, unknown>) => o;

  it("answers only fixture routes and returns null for everything else (caller fails closed)", async () => {
    expect(await simulateAiFixtureApi({ outcome: "success", method: "GET", path: "/api/ai/unknown", body: body({}) })).toBeNull();
    expect(await simulateAiFixtureApi({ outcome: "success", method: "DELETE", path: "/api/business", body: body({}) })).toBeNull();
  });

  it("never reports a save or publish as successful unless the response is marked simulated", async () => {
    const res = await simulateAiFixtureApi({ outcome: "success", method: "POST", path: "/api/ai/publish", body: body({ businessId: "x" }) });
    const data = (await res!.json()) as { published: boolean; simulated: boolean };
    expect(data.published).toBe(false);
    expect(data.simulated).toBe(true);
  });

  it("status changes (LIVE/PAUSED) are never applied", async () => {
    const res = await simulateAiFixtureApi({ outcome: "success", method: "POST", path: "/api/ai/status", body: body({ operationalStatus: "LIVE" }) });
    expect(res!.status).toBe(422);
    expect(((await res!.json()) as { error: string }).error).toMatch(/Nothing was changed/);
  });

  it("failure outcome returns an error and says nothing was sent or saved", async () => {
    const res = await simulateAiFixtureApi({ outcome: "failure", method: "POST", path: "/api/ai/chat", body: body({ message: "hi" }) });
    expect(res!.status).toBe(503);
    expect(((await res!.json()) as { error: string }).error).toMatch(/Nothing was sent/);
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

  it("the AI Front Desk fixture page calls notFound() in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const mod = await import("@/app/dev/ai-front-desk-fixture/page");
    await expect(mod.default({ searchParams: Promise.resolve({ outcome: "success" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("fixture isolation (source guards)", () => {
  it("no fixture file imports the database, auth, storage, providers or a server action", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/db/);
      expect(src, f).not.toMatch(/@prisma\/client/);
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/auth/);
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/(whatsapp|openai|ai\/(?!fixtures))/i);
      expect(src, f).not.toMatch(/["']use server["']/);
    }
  });

  it("the client wrapper renders the real workspace and marks it simulated", () => {
    const src = read("components/ai/fixture/AIFrontDeskFixtureClient.tsx");
    expect(src).toMatch(/import AIFrontDeskWorkspace from "@\/components\/ai\/AIFrontDeskWorkspace"/);
    expect(src).toMatch(/<AIFrontDeskWorkspace\s+simulated/);
    expect(src).toMatch(/status: 404/);
  });

  it("the fixture notice keeps JATA AFTERCALL separate from JATA Qi and TANYA-AI and says replies are simulated", () => {
    expect(AI_FIXTURE_NOTICE).toMatch(/JATA AFTERCALL AI Front Desk/);
    expect(AI_FIXTURE_NOTICE).toMatch(/simulated, not from a live AI service/);
    const header = read("lib/ai/fixtures/aiFrontDeskFixture.ts"); expect(header).toMatch(/NOT JATA Qi/); expect(header).toMatch(/TANYA-AI/);
  });

  it("the workspace success notices are labelled when simulated, and production wording is unchanged", () => {
    const src = read("components/ai/AIFrontDeskWorkspace.tsx");
    expect(src).toMatch(/FICTIONAL FIXTURE — simulated save\. Nothing was saved\./);
    expect(src).toMatch(/Business details saved\. Your front desk will use them immediately\./);
    expect(src).toMatch(/Saved as a draft\. Customers see these answers after you publish\./);
    expect(src).toMatch(/FICTIONAL FIXTURE — simulated publish\. Nothing was published/);
    expect(src).toMatch(/: `Published\. Customers can now reach your front desk/);
  });
});
