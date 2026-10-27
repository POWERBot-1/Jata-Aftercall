/**
 * JATA Qi seam — server-side configuration resolution.
 *
 * Everything here reads environment variables at call time; no credential is ever baked into a
 * build artifact, logged, or returned to a caller. The default configuration is the failing-closed
 * "none" mode, so a deployment that has not explicitly opted into Qi cannot dispatch work to it.
 */
import { QI_AUTH_MODES, QI_ENVIRONMENTS, type QiAuthMode, type QiEnvironment } from "./types";

export type QiConfig = {
  authMode: QiAuthMode;
  environment: QiEnvironment;
  /** True when a server-side token reference is present. The value itself stays in this process. */
  hasToken: boolean;
  /**
   * The raw credential, held only so error paths can scrub any accidental echo of the exact value.
   * It is NEVER included by redactQiConfig and never sent across the transport seam.
   */
  token?: string;
};

/** Capabilities this tenant may ask Qi to run. Empty by design — grants are explicit per tenant. */
export type QiCapabilityGrants = Readonly<Record<string, readonly string[]>>;

function resolveMode(raw: string | undefined): QiAuthMode {
  const candidate = (raw || "none").trim();
  return (QI_AUTH_MODES as readonly string[]).includes(candidate) ? (candidate as QiAuthMode) : "none";
}

function resolveEnvironment(raw: string | undefined): QiEnvironment {
  const candidate = (raw || "sandbox").trim();
  return (QI_ENVIRONMENTS as readonly string[]).includes(candidate) ? (candidate as QiEnvironment) : "sandbox";
}

export function resolveQiConfig(env: NodeJS.ProcessEnv = process.env): QiConfig {
  const token = typeof env.JATAQI_AUTH_TOKEN === "string" ? env.JATAQI_AUTH_TOKEN.trim() : "";
  return {
    authMode: resolveMode(env.JATAQI_AUTH_MODE),
    environment: resolveEnvironment(env.JATAQI_ENV),
    hasToken: token.length > 0,
    ...(token ? { token } : {}),
  };
}

/**
 * Safe-to-log view of the configuration. The token is deliberately represented as a boolean —
 * callers (error reports, audit metadata, support output) can prove configuration state without
 * ever handling the secret itself.
 */
export function redactQiConfig(config: QiConfig): Record<string, unknown> {
  return { authMode: config.authMode, environment: config.environment, hasToken: config.hasToken };
}

// Catches named assignment/colon leaks ("JATAQI_AUTH_TOKEN=...", "token: ...", "secret=...") and
// HTTP-style bearer headers, including any separator and the value that follows the name.
const TOKEN_PATTERN =
  /jataqi[_-]?auth[_-]?token\s*[:=]\s*["']?[^\s"']+|(?:\b(?:token|secret|credential)\b\s*[:=]\s*["']?)[^\s"']+|bearer\s+[a-z0-9._-]+/gi;

/**
 * Strip anything that looks like the Qi secret from a message before it leaves the process. When
 * the resolved configuration is available its exact token value is removed as well, so a leak in
 * an unexpected shape ("... work token=<value>") is still caught.
 */
export function scrubQiSecret(text: string, knownSecret?: string | null): string {
  let result = text.replace(TOKEN_PATTERN, "[redacted-qi-credential]");
  if (knownSecret && knownSecret.trim()) {
    result = result.split(knownSecret).join("[redacted-qi-credential]");
  }
  return result;
}
