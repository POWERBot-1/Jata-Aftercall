/**
 * $0-first storage ceilings (owner decision 2026-10-26): 250 MB per business, 5 GB global.
 *
 * The R2 free allowance is not a billing hard-cap, so the application refuses writes that
 * would cross these ceilings — before any byte is accepted, and fail-closed when usage
 * cannot be read. Reader is injected here; database wiring is covered by the media
 * integration suites.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { mediaAsset: { aggregate: vi.fn(async () => ({ _sum: { bytes: 0 } })) } } }));

import {
  checkStorageQuota,
  GLOBAL_STORAGE_CEILING_BYTES,
  PER_BUSINESS_STORAGE_CEILING_BYTES,
  storageQuotaMessage,
} from "@/lib/media/storageQuota";

const MB = 1024 * 1024;

describe("checkStorageQuota", () => {
  it("allows writes comfortably inside both ceilings", async () => {
    const result = await checkStorageQuota({
      businessId: "business-a",
      incomingBytes: 1 * MB,
      readUsage: async () => ({ globalBytes: 100 * MB, businessBytes: 10 * MB }),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a write that would cross the per-business ceiling, with business scope", async () => {
    const result = await checkStorageQuota({
      businessId: "business-a",
      incomingBytes: 2 * MB,
      readUsage: async () => ({ globalBytes: 300 * MB, businessBytes: PER_BUSINESS_STORAGE_CEILING_BYTES - 1 * MB }),
    });
    expect(result).toMatchObject({ ok: false, scope: "business" });
  });

  it("refuses a write that would cross the global ceiling even for a small tenant", async () => {
    const result = await checkStorageQuota({
      businessId: "business-small",
      incomingBytes: 2 * MB,
      readUsage: async () => ({ globalBytes: GLOBAL_STORAGE_CEILING_BYTES - 1 * MB, businessBytes: 1 * MB }),
    });
    expect(result).toMatchObject({ ok: false, scope: "global" });
  });

  it("allows landing exactly on a ceiling and refuses one byte beyond it", async () => {
    const atCeiling = await checkStorageQuota({
      businessId: "business-a",
      incomingBytes: 1 * MB,
      readUsage: async () => ({ globalBytes: 0, businessBytes: PER_BUSINESS_STORAGE_CEILING_BYTES - 1 * MB }),
    });
    expect(atCeiling.ok).toBe(true);

    const beyond = await checkStorageQuota({
      businessId: "business-a",
      incomingBytes: 1 * MB + 1,
      readUsage: async () => ({ globalBytes: 0, businessBytes: PER_BUSINESS_STORAGE_CEILING_BYTES - 1 * MB }),
    });
    expect(beyond).toMatchObject({ ok: false, scope: "business" });
  });

  it("fails closed when usage cannot be read", async () => {
    const result = await checkStorageQuota({
      businessId: "business-a",
      incomingBytes: 1,
      readUsage: async () => {
        throw new Error("db down");
      },
    });
    expect(result).toMatchObject({ ok: false, scope: "unavailable", usage: null });
  });

  it("has an actionable, vendor-neutral message for every refusal scope", () => {
    expect(storageQuotaMessage("business")).toContain("250 MB");
    expect(storageQuotaMessage("global")).toContain("full");
    expect(storageQuotaMessage("unavailable")).toContain("try again");
    for (const scope of ["business", "global", "unavailable"] as const) {
      expect(storageQuotaMessage(scope)).not.toMatch(/cloudflare|r2|vercel/i);
    }
  });
});
