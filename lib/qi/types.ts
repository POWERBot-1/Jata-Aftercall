/**
 * JATA Qi integration seam — contract types (owner directive 2026-10-27, Phase 4).
 *
 * STATUS: mocked seam only. The JATA Qi repository (POWERBot-1/JATA-Qi) ships a library/CLI with
 * no HTTP surface, its `@jataqi/*` packages are not published to the public npm registry (E404),
 * and this project has a standing no-new-dependency rule. No Qi runtime is embedded or deployed,
 * no credentials exist in this project, and nothing in this directory is wired into a live request
 * path. Activation is an explicit, approval-gated owner decision. These types pin the documented
 * T-03 authenticated work-ingress contract so that decision, when made, is a transport swap —
 * not a redesign.
 *
 * Contract source: JATA Qi T-03 ingress (verified by repository inspection, 2026-10-27):
 *  - credential -> principal boundary -> AuthenticatedPrincipal -> projectToActor (narrow only)
 *  - auth modes: static-token | oidc | test-only | none; "none" fails closed
 *  - token supplied by environment only (JATAQI_AUTH_TOKEN); credential values never travel in work
 *  - caller tenantId must equal the principal's tenant
 *  - every enqueue supports idempotencyKey and correlationId
 *  - capability registration is capability-bound and fails closed (default-deny)
 */

export const QI_AUTH_MODES = ["static-token", "oidc", "test-only", "none"] as const;
export type QiAuthMode = (typeof QI_AUTH_MODES)[number];

export const QI_ENVIRONMENTS = ["sandbox", "production"] as const;
export type QiEnvironment = (typeof QI_ENVIRONMENTS)[number];

/** Authenticated principal as resolved at the credential boundary, before any actor projection. */
export type QiPrincipal = {
  tenantId: string;
  capabilities: readonly string[];
  authMode: QiAuthMode;
  environment: QiEnvironment;
};

/** One durable unit of work a tenant asks Qi to run. Payload must be JSON-safe. */
export type QiWorkEnvelope = {
  tenantId: string;
  capability: string;
  payload: unknown;
  idempotencyKey: string;
  correlationId?: string;
  requestedAt: string;
};

/** A transport is the swap point for the future in-process Qi runtime or approved deployment. */
export interface QiTransport {
  readonly id: string;
  enqueue(principal: QiPrincipal, envelope: QiWorkEnvelope): Promise<{ reference: string; durable: boolean }>;
}

export type QiRejectCode =
  | "not_configured"
  | "missing_credential"
  | "tenant_mismatch"
  | "capability_denied"
  | "invalid_input"
  | "transport_failed";

export type QiEnqueueResult =
  | { status: "enqueued"; reference: string; durable: boolean; transportId: string }
  | { status: "rejected"; code: Exclude<QiRejectCode, "not_configured" | "transport_failed" | "missing_credential">; message: string }
  | { status: "unavailable"; code: "not_configured" | "transport_failed" | "missing_credential"; message: string };

export type QiEnqueueInput = {
  tenantId: string;
  capability: string;
  payload: unknown;
  idempotencyKey: string;
  correlationId?: string;
};
