import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  loadProductExpiryGraceObservation,
  type LifecycleInventoryCursors,
} from "@/lib/admin/product-expiry-grace-observation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });

function decodeCursors(value: string | null): LifecycleInventoryCursors | null {
  if (!value) return {};
  if (value.length > 2048) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const allowed = new Set(["core", "pos", "autopilot", "mjengo", "erpPro"]);
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([key, cursor]) => !allowed.has(key) || typeof cursor !== "string" || cursor.length < 1 || cursor.length > 128)) return null;
    return Object.fromEntries(entries) as LifecycleInventoryCursors;
  } catch {
    return null;
  }
}

/** Disabled-by-default, read-only observer. It never executes expiry transitions. */
export async function GET(req: Request) {
  if (process.env.PRODUCT_LIFECYCLE_OBSERVER_ENABLED !== "true") return error("Observer unavailable.", 503);
  const secret = process.env.PRODUCT_LIFECYCLE_OBSERVER_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 512) return error("Observer unavailable.", 503);

  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(req.headers.get("authorization") || "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return error("Access denied.", 401);

  const url = new URL(req.url);
  const limitValue = url.searchParams.get("limit");
  const limit = limitValue === null ? 50 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error("Invalid request.", 400);
  const cursors = decodeCursors(url.searchParams.get("cursor"));
  if (!cursors) return error("Invalid request.", 400);

  try {
    const result = await loadProductExpiryGraceObservation({ limit, cursors });
    const cursor = Object.keys(result.nextCursors).length
      ? Buffer.from(JSON.stringify(result.nextCursors)).toString("base64url")
      : null;
    return NextResponse.json({
      observedAt: result.observedAt, total: result.total, counts: result.counts,
      complete: result.complete, pageSizePerProductTable: result.pageSizePerProductTable,
      nextCursor: cursor, execution: "READ_ONLY_OBSERVATION", accessChanges: "NONE",
    }, { headers });
  } catch {
    return error("Observer unavailable.", 503);
  }
}
