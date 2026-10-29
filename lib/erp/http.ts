/**
 * ERP API route kit
 *
 * One wrapper for the JSON API surface: authenticate, resolve the tenant from the URL, compare any
 * body `businessId` against it, check the permission, enforce a per-actor rate limit on writes,
 * then run the handler. Errors become plain-language JSON — never a stack, SQL fragment, provider
 * payload or secret.
 */

import { NextResponse } from "next/server";
import { getSession } from "../auth";
import { requireErpAccess, ErpAccessError, type ErpContext, type ErpPermission } from "./access";
import { logErpAudit } from "./audit";
import { rateLimit } from "../rate-limit";

export type ErpRouteResult = { status?: number; data: unknown; headers?: Record<string, string> };

export function erpJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function erpFail(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code: code ?? null }, { status, headers: { "cache-control": "no-store" } });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === "GET" || request.method === "HEAD") return {};
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const parsed = await request.json();
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      throw Object.assign(new Error("That request body wasn't valid JSON."), { status: 400 });
    }
  }
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData();
    const body: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) body[key] = typeof value === "string" ? value : value.name;
    return body;
  }
  return {};
}

export async function handleErpRequest(params: {
  businessId: string;
  request: Request;
  permission?: ErpPermission;
  requireEntitled?: boolean;
  /** Writes are rate limited per actor; reads are not. */
  rateLimit?: { key: string; max: number; windowMs: number };
  fallback: string;
  handler: (input: { ctx: ErpContext; body: Record<string, unknown>; url: URL; session: NonNullable<Awaited<ReturnType<typeof getSession>>> }) => Promise<ErpRouteResult>;
}) {
  const session = await getSession();
  if (!session) return erpFail("Please sign in to continue.", 401, "UNAUTHENTICATED");
  try {
    const ctx = await requireErpAccess(params.businessId, session, {
      permission: params.permission,
      requireEntitled: params.requireEntitled,
    });
    const body = await readBody(params.request);
    const bodyBusiness = typeof body.businessId === "string" ? body.businessId : null;
    if (bodyBusiness && bodyBusiness !== params.businessId) {
      await logErpAudit({
        businessId: params.businessId,
        actorId: session.userId,
        action: "ERP_TENANT_MISMATCH",
        targetType: "API",
        targetId: new URL(params.request.url).pathname,
        outcome: "DENIED",
        reason: "Body businessId did not match the route tenant.",
      });
      return erpFail("We couldn't match that request to your business.", 403, "TENANT_MISMATCH");
    }
    if (params.rateLimit) {
      const limiter = rateLimit(params.request, params.rateLimit);
      if (!limiter.allowed) return erpFail("That's a lot of requests at once. Wait a moment and try again.", 429, "RATE_LIMITED");
    }
    const result = await params.handler({ ctx, body, url: new URL(params.request.url), session });
    return NextResponse.json(result.data, { status: result.status ?? 200, headers: { "cache-control": "no-store", ...(result.headers ?? {}) } });
  } catch (error) {
    if (error instanceof ErpAccessError) return erpFail(error.message, error.status, error.code);
    const status = typeof (error as { status?: unknown })?.status === "number" ? Number((error as { status: number }).status) : 500;
    const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : status >= 500 ? "SERVER_ERROR" : "BAD_REQUEST";
    if (status >= 400 && status < 500) {
      // Domain errors carry messages written for the customer; unknown ones do not.
      const message = error instanceof Error && error.message && !/prisma|sql|ECONN|stack/i.test(error.message) ? error.message : params.fallback;
      return erpFail(message, status, code);
    }
    console.error("[erp-api]", error instanceof Error ? error.message : "unknown error");
    return erpFail(params.fallback, 500, "SERVER_ERROR");
  }
}

export function intParam(url: URL, key: string, fallback: number, max = 1000): number {
  const raw = url.searchParams.get(key);
  const value = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), max);
}

export function strParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key);
  return value && value.trim() ? value.trim() : null;
}
