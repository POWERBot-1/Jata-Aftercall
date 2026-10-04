/**
 * AI safety, providers and cost control (§10, §17, §42, §51, §55, §56)
 *
 * The rules these tests defend:
 *   - a generated sentence never asserts a credential, award, guarantee, delivery promise, price
 *     or statistic the owner did not supply ("enhance presentation, never fabricate facts");
 *   - provider selection is configuration, not code, and a deployment with no keys still works;
 *   - keys and models never reach the browser;
 *   - every generation is metered, rate-limited and retried at most once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GROUNDING_SYSTEM_RULES,
  detectClaims,
  filterGroundedTexts,
  validateGroundedText,
} from "@/lib/ai/grounding";
import { ProviderError, providerErrorMessage, withRetry } from "@/lib/ai/provider";
import { providerStatus, resolveImageEditor, resolveProvider } from "@/lib/ai/registry";
import {
  INTERACTIVE_AI_QUOTA,
  PREVIEW_AI_QUOTA,
  checkQuota,
  quotaForPlan,
  quotaSummaryLine,
  quotaUsage,
} from "@/lib/ai/quota";
import { buildAltTextPrompt, buildCopyPrompt, buildEnhancePrompt, buildImagePrompt, presetFor } from "@/lib/ai/promptBuilder";
import { buildDesignContext } from "@/lib/ai/designContext";
import { localProvider } from "@/lib/ai/providers/local";

const FACTS = [
  "Business name: Mama Njeri's Kitchen",
  "Business type: Food & Restaurant",
  "Location: Kilimani, Nairobi",
  "Phone: 0722 000 000",
  "Sells: Chicken stew KES 850, Chapati KES 40",
];

const DESIGN = buildDesignContext({
  businessName: "Mama Njeri's Kitchen",
  categoryKey: "food",
  brand: { primaryColor: "#8B1E1E", accentColor: "#F2B544" },
  photographyStyle: "warm",
});

const AI_ENV_KEYS = ["JATA_AI_IMAGE_PROVIDER", "JATA_AI_TEXT_PROVIDER", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of AI_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of AI_ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

describe("content truth: nothing is claimed that the owner did not say", () => {
  it("rejects invented experience, awards, credentials, guarantees and delivery promises", () => {
    const fabricated = [
      "With 15 years of experience, we cook the best food in Nairobi.",
      "Award-winning chefs serving you daily.",
      "KEBS certified kitchen you can trust.",
      "We guarantee same-day delivery across Kenya.",
      "Our prices include a money-back guarantee.",
      "Over 500 happy customers every week.",
    ];
    for (const text of fabricated) {
      const verdict = validateGroundedText(text, FACTS);
      expect(verdict.ok, text).toBe(false);
      expect(verdict.violations.length).toBeGreaterThan(0);
      expect(verdict.reason).toContain("JATA won't claim");
    }
  });

  it("accepts copy that only restates the facts the owner supplied", () => {
    const grounded = [
      "Home-style Kenyan cooking in Kilimani, Nairobi.",
      "Chicken stew and fresh chapati, made the way your family likes it.",
      "Call 0722 000 000 to order.",
    ];
    for (const text of grounded) {
      expect(validateGroundedText(text, FACTS).ok, text).toBe(true);
    }
  });

  it("allows a claim when the owner really did supply it", () => {
    const facts = [...FACTS, "Certified by KEBS in 2021"];
    expect(validateGroundedText("A KEBS certified kitchen.", facts).ok).toBe(true);
  });

  it("drops only the ungrounded sentences when a provider returns several", () => {
    const { accepted, rejected } = filterGroundedTexts(
      ["Fresh chapati every morning.", "Voted the best restaurant in Kenya.", "Order on WhatsApp."],
      FACTS,
    );
    expect(accepted).toEqual(["Fresh chapati every morning.", "Order on WhatsApp."]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].violations.length).toBeGreaterThan(0);
  });

  it("never returns an empty string as valid copy", () => {
    expect(validateGroundedText("   ", FACTS).ok).toBe(false);
    expect(validateGroundedText("", FACTS).violations).toContain("empty");
  });

  it("names the claim families it can detect, so the Studio can warn about the owner's own draft", () => {
    expect(detectClaims("Award-winning and certified, with a 10 year warranty")).toEqual(
      expect.arrayContaining(["award", "credential", "guarantee"]),
    );
    expect(detectClaims("Fresh bread daily")).toEqual([]);
  });

  it("hands every text provider the same written rules", () => {
    expect(GROUNDING_SYSTEM_RULES).toContain("Never invent prices");
    expect(GROUNDING_SYSTEM_RULES).toContain("Return plain text only");
  });
});

describe("prompts are business-aware, and never ask a model to invent facts", () => {
  const design = DESIGN;

  it("builds an image prompt from the business's own palette, category and style", () => {
    const prompt = buildImagePrompt({
      design,
      composition: presetFor("product-photo").composition,
      placement: "product",
      subjectName: "Chicken stew",
      subjectDescription: "Served in a black bowl with chapati",
      ownerNotes: "no cutlery",
    });
    expect(prompt).toContain("Mama Njeri's Kitchen");
    expect(prompt.toUpperCase()).toContain("#8B1E1E");
    expect(prompt).toContain("Chicken stew");
    expect(prompt).toContain("no cutlery");
    expect(prompt).toMatch(/do not include any text/i);
    expect(prompt).toMatch(/never depict a different product/i);
  });

  it("tells an editing provider to keep the real product identical", () => {
    const prompt = buildEnhancePrompt({ design, preserveIdentity: true });
    const lower = prompt.toLowerCase();
    expect(lower).toContain("identity");
    expect(lower).toContain("do not");
    for (const word of ["shape", "colour", "label"]) {
      expect(lower).toContain(word);
    }
  });

  it("asks for copy under the tenant's facts and never asks for a price", () => {
    const built = buildCopyPrompt({ kind: "item-description", design, facts: FACTS, subjectName: "Chicken stew", tone: "Warm" });
    expect(built.system).toContain("ONLY the facts");
    expect(built.system.toLowerCase()).toContain("never invent prices");
    expect(built.prompt).toContain("Chicken stew");
    expect(built.maxChars).toBeGreaterThan(40);
  });

  it("keeps alt text short, descriptive and free of invented marketing", () => {
    const built = buildAltTextPrompt({ design, subjectName: "Chicken stew", placement: "product" });
    expect(built.maxChars).toBeLessThanOrEqual(140);
    expect(built.system.toLowerCase()).toContain("screen reader");
    expect(built.prompt.toLowerCase()).toContain("chicken stew");
  });

  it("falls back to a real preset for an unknown key instead of failing", () => {
    expect(presetFor("does-not-exist").key).toBeTruthy();
    expect(presetFor(null).key).toBeTruthy();
  });
});

describe("provider registry: configuration decides, and no key ever reaches the client", () => {
  it("works out of the box with the built-in provider and says so honestly", () => {
    const provider = resolveProvider("image");
    expect(provider.key).toBe("jata-local");
    const status = providerStatus();
    expect(status.image.photorealistic).toBe(false);
    expect(status.note).toContain("branded artwork");
    expect(JSON.stringify(status)).not.toMatch(/sk-|api[_-]?key/i);
  });

  it("prefers a configured vendor for auto, and falls back when the named vendor has no key", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    expect(resolveProvider("image").key).toBe("openai");
    expect(resolveProvider("text").key).toBe("openai");
    expect(resolveImageEditor()?.key).toBe("openai");
    expect(providerStatus().image.photorealistic).toBe(true);

    process.env.JATA_AI_IMAGE_PROVIDER = "gemini";
    expect(resolveProvider("image").key).toBe("jata-local");

    process.env.GEMINI_API_KEY = "gemini-test-key";
    expect(resolveProvider("image").key).toBe("gemini");

    process.env.JATA_AI_IMAGE_PROVIDER = "jata-local";
    expect(resolveProvider("image").key).toBe("jata-local");
    expect(resolveImageEditor()).toBeNull();
  });

  it("does not expose secrets in the provider catalogue", () => {
    process.env.OPENAI_API_KEY = "sk-super-secret";
    const status = providerStatus();
    expect(JSON.stringify(status)).not.toContain("sk-super-secret");
    process.env.GEMINI_API_KEY = "gemini-super-secret";
    expect(JSON.stringify(providerStatus())).not.toContain("gemini-super-secret");
  });

  it("has a built-in provider that generates real image bytes without any network call", async () => {
    const images = await localProvider.generateImage(
      {
        prompt: "studio photo",
        placement: "product",
        width: 1024,
        height: 1024,
        count: 1,
        seed: "112",
        design: DESIGN,
      },
      { businessId: "business-a", generationId: "gen-test", timeoutMs: 5000 },
    );
    expect(images).toHaveLength(1);
    expect(images[0].dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(images[0].representative).toBe(true);
    expect(images[0].dataUrl.length).toBeGreaterThan(2000);
  });
});

describe("failures are explained to the owner, and retried at most once", () => {
  it("maps provider failures to plain language with a retry hint", () => {
    expect(providerErrorMessage(new ProviderError("not_configured", "no key"))).toMatchObject({ code: "not_configured", retryable: false });
    expect(providerErrorMessage(new ProviderError("rate_limited", "429"))).toMatchObject({ retryable: true });
    expect(providerErrorMessage(new ProviderError("blocked", "policy"))).toMatchObject({ retryable: false });
    const unknown = providerErrorMessage(new Error("ECONNRESET"));
    expect(unknown.message).not.toContain("ECONNRESET");
    expect(unknown.message).toContain("safe");
  });

  it("retries a dropped connection and succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket hang up");
      return "ok";
    }, { timeoutMs: 50 });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("never retries a non-retryable provider decision", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new ProviderError("blocked", "policy", { retryable: false });
      }, { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
  });

  it("gives up after two attempts instead of looping", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new ProviderError("remote", "still failing");
      }, { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(2);
  });

  it("turns a hung provider into a timeout sentence an owner understands", async () => {
    await expect(
      withRetry(async (signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 2000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
        return "never";
      }, { timeoutMs: 1000, attempts: 1 }),
    ).rejects.toMatchObject({ code: "timeout" });
  }, 10_000);
});

describe("AI cost control: quotas derived from real usage", () => {
  const now = new Date("2026-03-15T09:00:00.000Z");

  it("keeps a small preview allowance before payment and a full allowance after", () => {
    expect(quotaForPlan({ entitled: false })).toEqual(PREVIEW_AI_QUOTA);
    expect(quotaForPlan({ entitled: true })).toEqual(INTERACTIVE_AI_QUOTA);
    expect(PREVIEW_AI_QUOTA.imagesPerMonth).toBeLessThan(INTERACTIVE_AI_QUOTA.imagesPerMonth);
  });

  it("counts only successful generations in the current month", () => {
    const usage = quotaUsage({
      quota: INTERACTIVE_AI_QUOTA,
      now,
      records: [
        { kind: "IMAGE", status: "SUCCEEDED", createdAt: new Date("2026-02-28T10:00:00.000Z") },
        { kind: "IMAGE", status: "SUCCEEDED", createdAt: new Date("2026-03-02T10:00:00.000Z") },
        { kind: "IMAGE", status: "FAILED", createdAt: new Date("2026-03-03T10:00:00.000Z") },
        { kind: "ENHANCE", status: "SUCCEEDED", createdAt: new Date("2026-03-04T10:00:00.000Z") },
        { kind: "COPY", status: "SUCCEEDED", createdAt: new Date("2026-03-05T10:00:00.000Z") },
      ],
    });
    expect(usage.used.images).toBe(1);
    expect(usage.used.enhances).toBe(1);
    expect(usage.used.copy).toBe(1);
    expect(usage.remaining.images).toBe(INTERACTIVE_AI_QUOTA.imagesPerMonth - 1);
    expect(usage.periodStart.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("blocks a request that would exceed the allowance, and says when it resets", () => {
    const usage = quotaUsage({
      quota: PREVIEW_AI_QUOTA,
      now,
      records: Array.from({ length: PREVIEW_AI_QUOTA.imagesPerMonth }, () => ({
        kind: "IMAGE",
        status: "SUCCEEDED",
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
      })),
    });
    const decision = checkQuota({ capability: "IMAGE", usage, requested: 1, now });
    expect(decision.status).toBe("blocked");
    if (decision.status !== "blocked") return;
    expect(decision.code).toBe("quota_exhausted");
    expect(decision.message).toContain("1st");
    expect(decision.message).not.toMatch(/error|429|quota_exceeded/);
  });

  it("stops double-tapping a Create button from spending two generations", () => {
    const usage = quotaUsage({ quota: INTERACTIVE_AI_QUOTA, now, records: [] });
    const decision = checkQuota({ capability: "IMAGE", usage, requested: 1, lastGenerationAt: new Date(now.getTime() - 1000), now });
    expect(decision.status).toBe("blocked");
    if (decision.status !== "blocked") return;
    expect(decision.code).toBe("too_soon");
    expect(decision.retryAfterMs).toBeGreaterThan(0);
  });

  it("accounts copy and alt-text separately from images", () => {
    const usage = quotaUsage({
      quota: INTERACTIVE_AI_QUOTA,
      now,
      records: [{ kind: "COPY", status: "SUCCEEDED", createdAt: new Date("2026-03-02T10:00:00.000Z") }],
    });
    expect(checkQuota({ capability: "COPY", usage, requested: 1, now }).status).toBe("ok");
    expect(checkQuota({ capability: "ALT_TEXT", usage, requested: 1, now }).status).toBe("ok");
  });

  it("writes a quota line an owner can read", () => {
    const usage = quotaUsage({ quota: INTERACTIVE_AI_QUOTA, now, records: [] });
    expect(quotaSummaryLine(usage)).toBe(`40 of 40 AI images left this month.`);
    const exhausted = quotaUsage({
      quota: INTERACTIVE_AI_QUOTA,
      now,
      records: Array.from({ length: 40 }, () => ({ kind: "IMAGE", status: "SUCCEEDED", createdAt: new Date("2026-03-02T10:00:00.000Z") })),
    });
    expect(quotaSummaryLine(exhausted)).toContain("Resets on the 1st");
  });
});
