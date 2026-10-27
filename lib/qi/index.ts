/**
 * JATA Qi seam — public surface.
 *
 * Mocked/fail-closed integration scaffold per owner directive Phase 4 (2026-10-27). Importing from
 * here never performs network I/O and never reads a credential value; see ./types.ts for status.
 */
export { enqueueQiWork, type EnqueueDeps } from "./client";
export { redactQiConfig, resolveQiConfig, scrubQiSecret, type QiCapabilityGrants, type QiConfig } from "./config";
export {
  QI_AUTH_MODES,
  QI_ENVIRONMENTS,
  type QiAuthMode,
  type QiEnqueueInput,
  type QiEnqueueResult,
  type QiEnvironment,
  type QiPrincipal,
  type QiRejectCode,
  type QiTransport,
  type QiWorkEnvelope,
} from "./types";
