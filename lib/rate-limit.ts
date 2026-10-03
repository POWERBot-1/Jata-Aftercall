import { NextResponse } from "next/server";

type BucketEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, BucketEntry>();

export function rateLimit(
  req: Request,
  options: { key: string; max?: number; windowMs?: number },
): { allowed: boolean; remaining: number; response?: NextResponse } {
  const max = options.max ?? 30;
  const windowMs = options.windowMs ?? 60_000;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  const bucketKey = `${options.key}:${ip}`;
  const now = Date.now();
  const existing = buckets.get(bucketKey);

  if (!existing || now > existing.resetAt) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1 };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      response: NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment and try again." },
        { status: 429 },
      ),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: max - existing.count };
}
