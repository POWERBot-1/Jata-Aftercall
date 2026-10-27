/**
 * JATA Qi seam — authenticated work-ingress client (T-03 shape, mocked transport).
 *
 * The client reproduces the security ordering documented in JATA Qi: authenticate at the
 * credential boundary, project a narrow principal, verify the caller's tenant matches it,
 * default-deny unknown capabilities, validate the envelope, then enqueue durably. It never throws
 * for an expected rejection — every outcome is a typed result so callers fail closed without
 * try/catch guesswork, and no error message can carry the credential.
 *
 * There is intentionally NO default live transport: embedding the Qi runtime and/or deploying a
 * loop host is an owner-gated decision (new dependency/deployment approval). Until then even a
 * fully configured static-token setup resolves to `unavailable/transport_failed` rather than
 * pretending work was dispatched.
 */
import { redactQiConfig, resolveQiConfig, scrubQiSecret, type QiCapabilityGrants, type QiConfig } from "./config";
import type {
  QiEnqueueInput,
  QiEnqueueResult,
  QiPrincipal,
  QiTransport,
  QiWorkEnvelope,
} from "./types";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const TENANT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** JSON-safety guard: the work payload must survive a durable queue serialisation round trip. */
function assertJsonSafe(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    throw new Error("payload must be JSON-safe data");
  }
  if (typeof value === "object") {
    if (seen.has(value as object)) throw new Error("payload must not contain circular references");
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) assertJsonSafe(item, seen);
    } else {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (typeof key !== "string") throw new Error("payload keys must be strings");
        assertJsonSafe(item, seen);
      }
    }
  }
}

function reject(code: "tenant_mismatch" | "capability_denied" | "invalid_input", message: string): QiEnqueueResult {
  return { status: "rejected", code, message: scrubQiSecret(message) };
}

function unavailable(
  code: "not_configured" | "transport_failed" | "missing_credential",
  message: string,
  config: QiConfig,
): QiEnqueueResult {
  return {
    status: "unavailable",
    code,
    message: `${scrubQiSecret(message, config.token)} Config=${JSON.stringify(redactQiConfig(config))}.`,
  };
}

export type EnqueueDeps = {
  config?: QiConfig;
  /** Explicit tenant capability grants; default-deny — an unlisted tenant has no capabilities. */
  grants?: QiCapabilityGrants;
  /** The swap point for a future approved Qi runtime. Absent => the seam fails closed. */
  transport?: QiTransport | null;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

export async function enqueueQiWork(input: QiEnqueueInput, deps: EnqueueDeps = {}): Promise<QiEnqueueResult> {
  const config = deps.config ?? resolveQiConfig(deps.env);
  const now = deps.now ?? (() => new Date());

  // 1. Credential boundary. "none" is the default and always fails closed; a token mode without a
  //    server-side token reference is a configuration error, not a reason to dispatch anonymous work.
  if (config.authMode === "none") {
    return unavailable("not_configured", "JATA Qi is not enabled for this deployment.", config);
  }
  if ((config.authMode === "static-token" || config.authMode === "oidc") && !config.hasToken) {
    return unavailable("missing_credential", "JATA Qi credential is missing on the server.", config);
  }

  // 2. Input validation happens before any tenant or capability decision (cheap, no side effects).
  if (!input || typeof input !== "object") {
    return reject("invalid_input", "A work envelope object is required.");
  }
  if (!TENANT_PATTERN.test(input.tenantId || "")) {
    return reject("invalid_input", "tenantId must be 1-64 letters, digits, underscores or hyphens.");
  }
  if (!CAPABILITY_PATTERN.test(input.capability || "")) {
    return reject("invalid_input", "capability must be a lowercase dotted identifier.");
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey || "")) {
    return reject("invalid_input", "idempotencyKey must be 8-100 safe characters (letters, digits, . _ : -).");
  }
  if (input.correlationId !== undefined && !CORRELATION_ID_PATTERN.test(input.correlationId)) {
    return reject("invalid_input", "correlationId must be 1-100 safe characters (letters, digits, . _ : -).");
  }
  try {
    assertJsonSafe(input.payload);
  } catch (error) {
    return reject("invalid_input", error instanceof Error ? error.message : "payload must be JSON-safe data.");
  }

  // 3. Principal projection — narrow, and pinned to a tenant the credential actually serves. The
  //    grants map is this seam's credential boundary: an unlisted tenant has no relationship with
  //    the configured principal and is refused before any capability or dispatch decision.
  const granted = deps.grants?.[input.tenantId];
  if (!granted) {
    return reject("tenant_mismatch", "The Qi principal is not associated with that tenant.");
  }
  const principal: QiPrincipal = {
    tenantId: input.tenantId,
    capabilities: granted,
    authMode: config.authMode,
    environment: config.environment,
  };
  if (!principal.capabilities.includes(input.capability)) {
    return reject("capability_denied", `Capability "${input.capability}" is not granted to this tenant.`);
  }

  // 4. Durable dispatch. No registered transport means the runtime was never approved/embedded:
  //    report honestly rather than pretending the work was accepted.
  const transport = deps.transport === undefined ? null : deps.transport;
  if (!transport) {
    return unavailable("transport_failed", "No JATA Qi runtime is registered in this build.", config);
  }

  const envelope: QiWorkEnvelope = {
    tenantId: principal.tenantId,
    capability: input.capability,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    requestedAt: now().toISOString(),
  };

  try {
    const outcome = await transport.enqueue(principal, envelope);
    if (!outcome || typeof outcome.reference !== "string" || !outcome.reference) {
      return unavailable("transport_failed", "The Qi runtime answered without a durable reference.", config);
    }
    return { status: "enqueued", reference: outcome.reference, durable: outcome.durable !== false, transportId: transport.id };
  } catch (error) {
    return unavailable(
      "transport_failed",
      `Qi dispatch failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      config,
    );
  }
}
