import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

type BucketEntry = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = { key: string; max?: number; windowMs?: number };

const buckets = new Map<string, BucketEntry>();
const SWEEP_INTERVAL = 128;
const MAX_TRACKED_BUCKETS = 50_000;
let requestsSinceSweep = 0;

/**
 * Next's Request does not expose the socket peer address. Only trust X-Forwarded-For when the
 * request is running inside Vercel, the configured hosting platform. The leftmost value is
 * accepted only if it is a literal IP; X-Real-IP and arbitrary headers are never fallbacks.
 * Deployment acceptance must still verify that the Vercel ingress overwrites this header.
 */
export function trustedClientIp(headers: Headers): string | null {
  if (process.env.VERCEL !== "1") return null;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return isIP(forwarded) ? forwarded.toLowerCase() : null;
}

function sweepExpired(now: number): void {
  for (const [key, entry] of buckets) {
    if (now >= entry.resetAt) buckets.delete(key);
  }
}

function limitedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Rate limit exceeded. Please wait a moment and try again." },
    { status: 429 },
  );
}

/** Shared process-local limiter for callers that already resolved an identity at the boundary. */
export function rateLimitByIdentity(
  identity: string | null | undefined,
  options: RateLimitOptions,
): { allowed: boolean; remaining: number; response?: NextResponse } {
  const max = Math.max(1, Math.floor(options.max ?? 30));
  const windowMs = Math.max(1, Math.floor(options.windowMs ?? 60_000));
  const now = Date.now();

  requestsSinceSweep += 1;
  if (requestsSinceSweep >= SWEEP_INTERVAL || buckets.size >= MAX_TRACKED_BUCKETS) {
    sweepExpired(now);
    requestsSinceSweep = 0;
  }

  // Hash the identity so raw IP values are not retained in the limiter's in-memory keys.
  const identityHash = createHash("sha256").update(String(identity || "unknown")).digest("hex");
  const bucketKey = `${options.key}:${identityHash}`;
  const existing = buckets.get(bucketKey);

  if (!existing || now >= existing.resetAt) {
    if (!existing && buckets.size >= MAX_TRACKED_BUCKETS) {
      // Keep memory bounded and fail closed for new keys under a high-cardinality flood. Existing
      // callers retain their current buckets; expired entries are reclaimed on the next sweep.
      return { allowed: false, remaining: 0, response: limitedResponse() };
    }
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1 };
  }

  if (existing.count >= max) {
    return { allowed: false, remaining: 0, response: limitedResponse() };
  }

  existing.count += 1;
  return { allowed: true, remaining: max - existing.count };
}

/** Request-facing limiter: forwarded identity is used only on the configured Vercel runtime. */
export function rateLimit(req: Request, options: RateLimitOptions) {
  return rateLimitByIdentity(trustedClientIp(req.headers) ?? "untrusted-proxy", options);
}
