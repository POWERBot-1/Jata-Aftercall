import { randomUUID } from "node:crypto";
import { redactAuditMetadata } from "@/lib/audit";
import type { ControlGrant } from "./access";

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const requestUrl = new URL(request.url);
    return parsed.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function getCorrelationId(headers: Headers): string {
  const candidate = headers.get("x-request-id") || headers.get("x-vercel-id") || "";
  return /^[a-zA-Z0-9._:/-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

export function sanitizeAuditState(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || value instanceof Date) return value instanceof Date ? value.toISOString() : value;
  if (Array.isArray(value)) return value.map(sanitizeAuditState);
  return redactAuditMetadata(value as Record<string, unknown>);
}

export function grantActor(grants: ControlGrant[], permission: string, businessId?: string): ControlGrant | null {
  return grants.find((grant) => grant.permissionKeys.includes(permission)
    && (businessId === undefined || grant.scopeBusinessId === null || grant.scopeBusinessId === businessId)) ?? null;
}
