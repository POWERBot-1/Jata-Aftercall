/**
 * POS route kit (§5, §38, §56, §75)
 *
 * Every POS API route goes through `handlePosRequest`, so authorization, tenant checks, body
 * parsing and error mapping cannot be forgotten or hand-rolled differently per screen:
 *
 * 1. the tenant is derived from the session and the URL segment — a `businessId` in the body is
 *    compared against it and a mismatch is refused and audited (§5, §75 "forged tenant id");
 * 2. the actor, role and permissions are resolved server-side (§36);
 * 3. any thrown error becomes a plain-language JSON body with no technical detail (§38, §56).
 */

import { NextResponse } from "next/server";
import { SAFE_ERRORS } from "@/lib/safeError";
import { logPosAudit } from "./audit";
import { requirePosAccessFromRequest, posErrorBody, type PosAccessOptions, type PosContext } from "./guard";
import { businessIdMismatch, readJsonBody, type JsonBody } from "./validation";
import type { PosActor } from "./sales";

export type PosRouteInput = {
  businessId: string;
  ctx: PosContext;
  actor: PosActor;
  body: JsonBody;
  url: URL;
};

export type PosHandlerResult = { status?: number; data: unknown };

export function toActor(ctx: PosContext): PosActor {
  return {
    actorId: ctx.session.userId,
    actorName: ctx.staffName ?? ctx.session.name ?? null,
    roleKey: ctx.roleKey,
    permissions: ctx.permissions,
    staffId: ctx.staffId,
    branchId: ctx.branchId,
  };
}

export function posOk(data: unknown, status = 200): PosHandlerResult {
  return { status, data };
}

export function posFail(message: string, status = 400, code?: string): PosHandlerResult {
  return { status, data: { error: message, code } };
}

/**
 * Turns a domain outcome (`{ ok, code, message, warnings }` from `sales.ts`/`operations.ts`)
 * into a response. Refusals keep the plain-language reason the owner should see (§38).
 */
export function fromOutcome(
  outcome: { ok: boolean; code?: string; message?: string; warnings?: string[] },
  payload: Record<string, unknown> = {},
  successStatus = 200,
): PosHandlerResult {
  if (!outcome.ok) {
    return {
      status: outcome.code === "NOT_ALLOWED" ? 403 : 400,
      data: { error: outcome.message ?? SAFE_ERRORS.saveFailed, code: outcome.code, warnings: outcome.warnings ?? [] },
    };
  }
  return {
    status: successStatus,
    data: { ok: true, warnings: outcome.warnings ?? [], ...payload },
  };
}

export async function handlePosRequest(params: {
  businessId: string | null | undefined;
  request?: Request;
  options?: PosAccessOptions;
  /** Fallback message if something unexpected fails (§38). */
  fallback?: string;
  handler: (input: PosRouteInput) => Promise<PosHandlerResult> | PosHandlerResult;
}): Promise<NextResponse> {
  const fallback = params.fallback ?? SAFE_ERRORS.saveFailed;
  const businessId = typeof params.businessId === "string" ? params.businessId.trim() : "";

  try {
    const ctx = await requirePosAccessFromRequest(businessId, params.options ?? {});
    const body = params.request ? await readJsonBody(params.request) : {};
    const url = new URL(params.request?.url ?? "https://jata.internal/");

    // A body that names a different business is a forged tenant id, not a typo (§5, §75).
    if (businessIdMismatch(businessId, body)) {
      await logPosAudit({
        businessId,
        actorId: ctx.session.userId,
        actorName: ctx.staffName,
        action: "POS_ACCESS_DENIED",
        targetType: "BUSINESS",
        targetId: businessId,
        metadata: { reason: "TENANT_ID_MISMATCH" },
      });
      return NextResponse.json({ error: SAFE_ERRORS.noAccess, code: "TENANT_ID_MISMATCH" }, { status: 403 });
    }

    const result = await params.handler({ businessId, ctx, actor: toActor(ctx), body, url });
    return NextResponse.json(result.data, { status: result.status ?? 200 });
  } catch (error) {
    const mapped = posErrorBody(error, fallback);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/**
 * Reads only — a lighter wrapper for GET screens that tolerate a slightly stale entitlement
 * badge in exchange for one fewer database round trip (§34).
 */
export function handlePosRead(params: {
  businessId: string | null | undefined;
  request?: Request;
  options?: Omit<PosAccessOptions, "fast">;
  fallback?: string;
  handler: (input: PosRouteInput) => Promise<PosHandlerResult> | PosHandlerResult;
}): Promise<NextResponse> {
  return handlePosRequest({ ...params, options: { fast: true, ...(params.options ?? {}) } });
}

/** Query-string helpers shared by list and report routes (§35). */
export function queryInt(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  const parsed = Number(raw ?? "");
  return Number.isFinite(parsed) && raw ? parsed : fallback;
}

export function queryString(url: URL, key: string): string | null {
  const raw = url.searchParams.get(key);
  return raw && raw.trim() ? raw.trim().slice(0, 120) : null;
}
