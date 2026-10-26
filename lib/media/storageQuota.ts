/**
 * Application-enforced storage ceilings — the "$0-first" guardrail (owner decision 2026-10-26).
 *
 * Cloudflare R2's free tier (10 GB-month storage, 1M Class A / 10M Class B operations, free
 * egress — developers.cloudflare.com/r2/pricing, re-verified 2026-10-26) is an *allowance*,
 * not a billing hard-cap: usage beyond it is billed at published rates if a payment method is
 * on file. To keep the pilot at $0 in practice, the application refuses new media writes once
 * recorded usage would cross conservative ceilings well inside that allowance:
 *
 *   • per business: 250 MB of stored media
 *   • global:       5 GB across all businesses
 *
 * Usage is the sum of `MediaAsset.bytes` — the durable objects this application stored and
 * recorded. Legacy rows that never recorded bytes (external URL references, pre-durable
 * metadata) do not consume provider storage and are not counted. The check is fail-closed:
 * if usage cannot be read, the write is refused rather than allowed blind. It is also
 * best-effort under concurrency (read-then-write is not atomic), which is acceptable for a
 * cost guardrail and is *not* a substitute for vendor billing alerts.
 */

import prisma from "@/lib/db";

export const PER_BUSINESS_STORAGE_CEILING_BYTES = 250 * 1024 * 1024;
export const GLOBAL_STORAGE_CEILING_BYTES = 5 * 1024 * 1024 * 1024;

export type StorageUsage = { globalBytes: number; businessBytes: number };
export type StorageUsageReader = (businessId: string) => Promise<StorageUsage>;

export type StorageQuotaResult =
  | { ok: true; scope: null; usage: StorageUsage }
  | { ok: false; scope: "business" | "global" | "unavailable"; usage: StorageUsage | null };

/** Recorded durable-media usage, globally and for one business. Null byte counts count as 0. */
export async function readStorageUsage(businessId: string): Promise<StorageUsage> {
  const [global, business] = await Promise.all([
    prisma.mediaAsset.aggregate({ _sum: { bytes: true } }),
    prisma.mediaAsset.aggregate({ where: { businessId }, _sum: { bytes: true } }),
  ]);
  return {
    globalBytes: global._sum.bytes ?? 0,
    businessBytes: business._sum.bytes ?? 0,
  };
}

/**
 * Would storing `incomingBytes` more for `businessId` stay within both ceilings?
 * Per-business is reported first so the owner gets the actionable message.
 */
export async function checkStorageQuota(input: {
  businessId: string;
  incomingBytes: number;
  readUsage?: StorageUsageReader;
}): Promise<StorageQuotaResult> {
  const readUsage = input.readUsage ?? readStorageUsage;
  let usage: StorageUsage;
  try {
    usage = await readUsage(input.businessId);
  } catch {
    return { ok: false, scope: "unavailable", usage: null };
  }
  if (usage.businessBytes + input.incomingBytes > PER_BUSINESS_STORAGE_CEILING_BYTES) {
    return { ok: false, scope: "business", usage };
  }
  if (usage.globalBytes + input.incomingBytes > GLOBAL_STORAGE_CEILING_BYTES) {
    return { ok: false, scope: "global", usage };
  }
  return { ok: true, scope: null, usage };
}

/** Owner-facing explanation for a refused write. Never blames the vendor by name. */
export function storageQuotaMessage(scope: "business" | "global" | "unavailable"): string {
  switch (scope) {
    case "business":
      return "Your business has reached its media storage allowance (250 MB). Delete some saved images, then try again.";
    case "global":
      return "Media storage is full for now. Please try again later — your existing images are safe.";
    default:
      return "We couldn't check your media storage allowance just now. Please try again in a moment.";
  }
}
