/**
 * Provider readiness (§2, §12, §58, §73, §129).
 *
 * JATA's central connector credentials live in the server environment. This module is the only
 * place that reads them, the only place that decides whether a provider is *actually* connected
 * in this deployment, and it never returns a secret — only whether the connector is ready and
 * which names are still missing or unacceptable (for internal administration, never for a
 * browser response).
 *
 * Honesty rule (§129): if the credentials for a provider are absent, JATA says so plainly and
 * keeps the merchant-facing capability at "payment instructions". It never pretends a provider
 * is live because the code for it exists.
 *
 * M-PESA fails closed. There is no default environment and no silent fallback between Daraja's
 * sandbox and production: `MPESA_ENV` must say which one, every value the implemented Daraja
 * products need must be present *and* well-formed, and a configuration that mixes environments
 * (a production connector on a Vercel Preview, Safaricom's public sandbox shortcode in
 * production) is refused rather than guessed at. Diagnostics name the variable and the rule that
 * failed — never the value.
 */

export type MpesaEnvironment = "sandbox" | "production";

/** The only two Daraja hosts this connector will ever talk to (official Safaricom hosts). */
export const MPESA_HOSTS: Record<MpesaEnvironment, string> = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
};

/**
 * Safaricom's public Daraja sandbox shortcode (it appears in Safaricom's own documentation and
 * is shared by every developer). It is never JATA ATLAS's production shortcode and is refused
 * when `MPESA_ENV=production`.
 */
export const MPESA_SANDBOX_SHORTCODE = "174379";

/** The largest single M-PESA transaction, in whole shillings. */
export const MPESA_MAX_TRANSACTION_KES = 250_000;

/**
 * The neutral callback path family JATA registers by default.
 *
 * Integration guides that reproduce Safaricom's Daraja guidance say URLs containing "mpesa",
 * "m-pesa" or "safaricom" are filtered and blocked. The legacy `/api/payments/webhooks/mpesa/*`
 * routes remain served and authenticated by the same handler, but nothing JATA hands to Safaricom
 * by default contains those words.
 */
export const MPESA_CALLBACK_PATH_PREFIX = "/api/payments/webhooks/daraja";

export type MpesaConfig = {
  /** `null` when `MPESA_ENV` is missing or not exactly `sandbox`/`production` — never a default. */
  env: MpesaEnvironment | null;
  /** The official Daraja host for `env`; empty when `env` is null. */
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** JATA's own paying shortcode used to raise the STK prompt. */
  shortcode: string;
  passkey: string;
  /** JATA's central callback for STK prompts — never a merchant URL (§14). Empty when unbuildable. */
  stkCallbackUrl: string;
  /** JATA's central C2B confirmation endpoint registered with Safaricom (§34). */
  c2bConfirmationUrl: string;
  c2bValidationUrl: string;
  /** Path token JATA registers inside its callback URLs, so a bare URL guess cannot post. */
  callbackToken: string;
  /** Optional exact-IP allowlist for provider callbacks (§35). Empty = not enforced. */
  allowedIps: string[];
  /** Collection (STK Push / STK Query / callbacks) is fully and correctly configured. */
  ready: boolean;
  /** Variables that are absent. */
  missing: string[];
  /** Variables that are present but unacceptable — a rule per entry, never a value. */
  invalid: string[];
  /** Coherent-but-suspicious configuration (not blocking). */
  warnings: string[];
  /** Initiator-authenticated operations (reversals) — separate from collection readiness. */
  initiatorName: string;
  securityCredential: string;
  reversalReady: boolean;
  reversalMissing: string[];
  reversalInvalid: string[];
};

function envValue(name: string): string {
  return String(process.env[name] ?? "").trim();
}

export function publicBaseUrl(): string {
  return (envValue("PUBLIC_BASE_URL") || envValue("NEXTAUTH_URL") || "http://localhost:3000").replace(/\/$/, "");
}

/** Which Vercel deployment type this process runs in, or "" off Vercel. */
function vercelEnvironment(): string {
  return envValue("VERCEL_ENV").toLowerCase();
}

function parseMpesaEnvironment(raw: string): MpesaEnvironment | null {
  const value = raw.trim().toLowerCase();
  return value === "sandbox" || value === "production" ? value : null;
}

const PRINTABLE_SECRET = /^[\x21-\x7e]{8,512}$/;
const CALLBACK_TOKEN = /^[A-Za-z0-9_-]{24,128}$/;
const SHORTCODE = /^\d{5,7}$/;
const INITIATOR_NAME = /^[A-Za-z0-9_.@-]{3,64}$/;
const SECURITY_CREDENTIAL = /^[A-Za-z0-9+/]{16,2048}={0,2}$/;

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6 literals are never a Daraja callback host
  if (!host.includes(".")) return true; // single-label hosts are not publicly resolvable
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/** A URL Daraja can actually reach: https, a public host, and no embedded credentials. */
function checkPublicHttpsUrl(value: string): { ok: boolean; url: URL | null; reason: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, url: null, reason: "is not an absolute URL" };
  }
  if (url.protocol !== "https:") return { ok: false, url: null, reason: "must use https" };
  if (url.username || url.password) return { ok: false, url: null, reason: "must not embed credentials" };
  if (isPrivateOrLocalHost(url.hostname)) {
    return { ok: false, url: null, reason: "must be a publicly reachable host, not localhost or a private address" };
  }
  return { ok: true, url, reason: "" };
}

function isIpAddress(value: string): boolean {
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(value)) {
    return value.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return /^[0-9a-fA-F:]+$/.test(value) && value.includes(":");
}

/** The public origin Daraja callbacks point at. No localhost default: unset means unbuildable. */
function callbackBase(): { base: string | null; problem: string | null } {
  const raw = envValue("PUBLIC_BASE_URL") || envValue("NEXTAUTH_URL");
  if (!raw) return { base: null, problem: "PUBLIC_BASE_URL (or NEXTAUTH_URL) is not set — Daraja callbacks need JATA's public https origin" };
  const checked = checkPublicHttpsUrl(raw);
  if (!checked.ok) return { base: null, problem: `PUBLIC_BASE_URL (or NEXTAUTH_URL) ${checked.reason}` };
  return { base: raw.replace(/\/+$/, ""), problem: null };
}

type OverrideCheck = { name: string; value: string; suffix: string };

export function readMpesaConfig(): MpesaConfig {
  const rawEnv = envValue("MPESA_ENV");
  const env = parseMpesaEnvironment(rawEnv);
  const consumerKey = envValue("MPESA_CONSUMER_KEY");
  const consumerSecret = envValue("MPESA_CONSUMER_SECRET");
  const shortcode = envValue("MPESA_SHORTCODE");
  const passkey = envValue("MPESA_PASSKEY");
  const callbackToken = envValue("MPESA_CALLBACK_TOKEN");
  const initiatorName = envValue("MPESA_INITIATOR_NAME");
  const securityCredential = envValue("MPESA_SECURITY_CREDENTIAL");
  const allowedIps = envValue("MPESA_ALLOWED_IPS").split(",").map((ip) => ip.trim()).filter(Boolean);

  const missing: string[] = [];
  const invalid: string[] = [];
  const warnings: string[] = [];

  // ── Environment: explicit, never defaulted ───────────────────────────────
  if (!rawEnv) missing.push("MPESA_ENV");
  else if (!env) invalid.push('MPESA_ENV must be exactly "sandbox" or "production"');

  // ── Collection credentials: present and well-formed ──────────────────────
  if (!consumerKey) missing.push("MPESA_CONSUMER_KEY");
  else if (!PRINTABLE_SECRET.test(consumerKey)) invalid.push("MPESA_CONSUMER_KEY must be 8–512 printable characters without spaces");
  if (!consumerSecret) missing.push("MPESA_CONSUMER_SECRET");
  else if (!PRINTABLE_SECRET.test(consumerSecret)) invalid.push("MPESA_CONSUMER_SECRET must be 8–512 printable characters without spaces");
  if (!shortcode) missing.push("MPESA_SHORTCODE");
  else if (!SHORTCODE.test(shortcode)) invalid.push("MPESA_SHORTCODE must be a 5–7 digit number");
  else if (env === "production" && shortcode === MPESA_SANDBOX_SHORTCODE) {
    invalid.push("MPESA_SHORTCODE is Safaricom's public sandbox shortcode and cannot be used with MPESA_ENV=production");
  }
  if (!passkey) missing.push("MPESA_PASSKEY");
  else if (!PRINTABLE_SECRET.test(passkey)) invalid.push("MPESA_PASSKEY must be 8–512 printable characters without spaces");
  // Without the callback token the adapter refuses every provider callback (it cannot tell a real
  // Daraja event from a stranger's POST), so a deployment that lacks it cannot confirm money —
  // readiness must say so instead of reporting the connector live (§35, §129).
  if (!callbackToken) missing.push("MPESA_CALLBACK_TOKEN");
  else if (!CALLBACK_TOKEN.test(callbackToken)) {
    invalid.push("MPESA_CALLBACK_TOKEN must be 24–128 URL-safe characters (A–Z a–z 0–9 _ -); base64 values containing + / = break the callback URL");
  }

  // ── Environment separation: a connector must not run where its mode is wrong ─
  const vercelEnv = vercelEnvironment();
  if (env === "production" && (vercelEnv === "preview" || vercelEnv === "development")) {
    invalid.push("MPESA_ENV=production is only permitted on the Vercel Production deployment, not on Preview or Development");
  }
  if (env === "sandbox" && vercelEnv === "production") {
    warnings.push("The M-PESA SANDBOX connector is active on a Vercel Production deployment; real customers cannot be charged");
  }
  if (allowedIps.some((ip) => !isIpAddress(ip))) {
    invalid.push("MPESA_ALLOWED_IPS must be a comma-separated list of exact IP addresses");
  }

  // ── Callback URLs: built from the public origin, or overridden explicitly ─
  const overrides: OverrideCheck[] = [
    { name: "MPESA_STK_CALLBACK_URL", value: envValue("MPESA_STK_CALLBACK_URL"), suffix: "/stk" },
    { name: "MPESA_C2B_CONFIRMATION_URL", value: envValue("MPESA_C2B_CONFIRMATION_URL"), suffix: "/confirmation" },
    { name: "MPESA_C2B_VALIDATION_URL", value: envValue("MPESA_C2B_VALIDATION_URL"), suffix: "/validation" },
  ];
  for (const override of overrides) {
    if (!override.value) continue;
    const checked = checkPublicHttpsUrl(override.value);
    if (!checked.ok || !checked.url) {
      invalid.push(`${override.name} ${checked.reason}`);
      continue;
    }
    if (!checked.url.pathname.replace(/\/+$/, "").endsWith(override.suffix)) {
      invalid.push(`${override.name} must end in ${override.suffix} (JATA routes the callback type by its last path segment)`);
    }
    if (callbackToken && checked.url.searchParams.get("token") !== callbackToken) {
      invalid.push(`${override.name} must carry ?token=<MPESA_CALLBACK_TOKEN> (overrides are used verbatim)`);
    }
  }

  const needsBase = overrides.some((override) => !override.value);
  const { base, problem } = callbackBase();
  if (needsBase && problem) invalid.push(problem);

  const tokenUsable = Boolean(callbackToken) && CALLBACK_TOKEN.test(callbackToken);
  const built = (suffix: string, override: string) => {
    if (override) return override;
    if (!base || !tokenUsable) return "";
    return `${base}${MPESA_CALLBACK_PATH_PREFIX}${suffix}?token=${callbackToken}`;
  };
  const stkCallbackUrl = built("/stk", overrides[0].value);
  const c2bConfirmationUrl = built("/confirmation", overrides[1].value);
  const c2bValidationUrl = built("/validation", overrides[2].value);

  const ready = missing.length === 0 && invalid.length === 0 && env !== null;

  // ── Initiator-authenticated operations (reversals) ────────────────────────
  const reversalMissing: string[] = [];
  const reversalInvalid: string[] = [];
  if (!initiatorName) reversalMissing.push("MPESA_INITIATOR_NAME");
  else if (!INITIATOR_NAME.test(initiatorName)) reversalInvalid.push("MPESA_INITIATOR_NAME must be 3–64 letters, digits or _ . @ -");
  if (!securityCredential) reversalMissing.push("MPESA_SECURITY_CREDENTIAL");
  else if (!SECURITY_CREDENTIAL.test(securityCredential)) {
    reversalInvalid.push("MPESA_SECURITY_CREDENTIAL must be the base64 SecurityCredential produced with Safaricom's certificate for this environment");
  }

  return {
    env,
    baseUrl: env ? MPESA_HOSTS[env] : "",
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    stkCallbackUrl,
    c2bConfirmationUrl,
    c2bValidationUrl,
    callbackToken,
    allowedIps,
    ready,
    missing,
    invalid,
    warnings,
    initiatorName,
    securityCredential,
    reversalReady: ready && reversalMissing.length === 0 && reversalInvalid.length === 0,
    reversalMissing,
    reversalInvalid,
  };
}

/** A callback URL with its token removed — safe for logs, admin screens and documentation. */
export function redactCallbackUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/i, "$1[redacted]");
}

/**
 * Everything an operator needs to see about the M-PESA connector — names, rules and redacted
 * URLs, never a secret value (§58, §73).
 */
export function describeMpesaConfig() {
  const config = readMpesaConfig();
  return {
    environment: config.env,
    host: config.baseUrl || null,
    collectionReady: config.ready,
    reversalReady: config.reversalReady,
    missing: [...config.missing],
    invalid: [...config.invalid],
    warnings: [...config.warnings],
    reversalMissing: [...config.reversalMissing],
    reversalInvalid: [...config.reversalInvalid],
    callbackUrls: {
      stk: redactCallbackUrl(config.stkCallbackUrl),
      c2bConfirmation: redactCallbackUrl(config.c2bConfirmationUrl),
      c2bValidation: redactCallbackUrl(config.c2bValidationUrl),
    },
  };
}

export type PaystackConnectorConfig = {
  secretKey: string;
  publicKey: string;
  /** Live keys start with `sk_live_`; test keys with `sk_test_`. */
  mode: "TEST" | "LIVE" | "NONE";
  webhookConfigured: boolean;
  ready: boolean;
  missing: string[];
};

export function readPaystackConfig(): PaystackConnectorConfig {
  const secretKey = envValue("PAYSTACK_SECRET_KEY");
  const publicKey = envValue("PAYSTACK_PUBLIC_KEY");
  const mode: PaystackConnectorConfig["mode"] = !secretKey ? "NONE" : secretKey.startsWith("sk_live_") ? "LIVE" : "TEST";
  const missing: string[] = [];
  if (!secretKey) missing.push("PAYSTACK_SECRET_KEY");
  return {
    secretKey,
    publicKey,
    mode,
    // Paystack signs every event with the same secret; no separate webhook secret exists.
    webhookConfigured: Boolean(secretKey),
    ready: Boolean(secretKey),
    missing,
  };
}

export type BankConnectorConfig = {
  /** Where JATA's authorized bank/aggregator connector lives, when one is provisioned. */
  baseUrl: string;
  apiKey: string;
  ready: boolean;
  missing: string[];
};

export function readBankConnectorConfig(): BankConnectorConfig {
  const baseUrl = envValue("BANK_CONNECTOR_URL");
  const apiKey = envValue("BANK_CONNECTOR_API_KEY");
  const missing: string[] = [];
  if (!baseUrl) missing.push("BANK_CONNECTOR_URL");
  if (!apiKey) missing.push("BANK_CONNECTOR_API_KEY");
  return { baseUrl, apiKey, ready: missing.length === 0, missing };
}

export type TestModeState = {
  /** TEST MODE is explicit and never mixed with production records (§94). */
  enabled: boolean;
  reason: string;
  /**
   * True only when the deployment said so out loud (`JATA_PAYMENTS_TEST_MODE=on`) *and* the
   * deployment is not a production one. Used to decide whether an unauthenticated provider
   * payload may be accepted at all (§35, §120).
   */
  explicit: boolean;
  /** `on` was requested on a production deployment and has been ignored (fail closed). */
  ignoredOnInProduction?: boolean;
};

/**
 * Test mode is derived from what is actually connected: only a LIVE connector (M-PESA in
 * production mode, or a `sk_live_` Paystack key) makes a deployment "production". A sandbox
 * M-PESA connector is a test connector, however completely it is configured.
 *
 * `JATA_PAYMENTS_TEST_MODE=on` is honoured only off production: when M-PESA is in production mode
 * or the deployment is Vercel Production, the flag is ignored, so it can never be the reason an
 * unauthenticated provider callback is accepted on a live system.
 */
export function readTestMode(): TestModeState {
  const requested = envValue("JATA_PAYMENTS_TEST_MODE").toLowerCase();
  if (requested === "off" || requested === "false" || requested === "0") {
    return { enabled: false, reason: "Test mode is switched off for this deployment.", explicit: false };
  }
  const mpesa = readMpesaConfig();
  const productionDeployment = mpesa.env === "production" || vercelEnvironment() === "production";
  const requestedOn = requested === "on" || requested === "true" || requested === "1";
  if (requestedOn && !productionDeployment) {
    return { enabled: true, reason: "JATA_PAYMENTS_TEST_MODE is switched on for this deployment.", explicit: true };
  }
  const productionReady = (mpesa.ready && mpesa.env === "production") || readPaystackConfig().mode === "LIVE";
  return {
    enabled: !productionReady,
    reason: requestedOn
      ? "JATA_PAYMENTS_TEST_MODE=on was ignored because this is a production deployment."
      : productionReady
        ? "A live provider connector is configured."
        : "No live provider connector is configured, so payments run in test mode.",
    explicit: false,
    ...(requestedOn ? { ignoredOnInProduction: true } : {}),
  };
}

/**
 * Internal connector readiness — for JATA operations and for the pipeline's own decisions.
 * `missing` names environment variables and must never be sent to a merchant browser (§58, §73).
 */
export type ConnectorReadiness = {
  provider: "MPESA" | "PAYSTACK" | "BANK" | "AIRTEL_MONEY";
  ready: boolean;
  mode: "SANDBOX" | "TEST" | "LIVE" | "NONE";
  missing: string[];
  note: string;
};

export function connectorReadiness(): ConnectorReadiness[] {
  const mpesa = readMpesaConfig();
  const paystack = readPaystackConfig();
  const bank = readBankConnectorConfig();
  return [
    {
      provider: "MPESA",
      ready: mpesa.ready,
      mode: mpesa.ready ? (mpesa.env === "production" ? "LIVE" : "SANDBOX") : "NONE",
      missing: mpesa.missing,
      note: mpesa.ready
        ? `Daraja ${mpesa.env} connector configured; JATA registers the callbacks centrally.`
        : mpesa.invalid.length
          ? `M-PESA connector configuration needs attention: ${mpesa.invalid.join("; ")}.`
          : "M-PESA central connector credentials are not configured in this deployment.",
    },
    {
      provider: "PAYSTACK",
      ready: paystack.ready,
      mode: paystack.mode,
      missing: paystack.missing,
      note: paystack.ready
        ? `Paystack ${paystack.mode.toLowerCase()} connector configured.`
        : "Paystack connector key is not configured in this deployment.",
    },
    {
      provider: "BANK",
      ready: bank.ready,
      mode: bank.ready ? "LIVE" : "NONE",
      missing: bank.missing,
      note: bank.ready
        ? "An authorized bank connector is configured."
        : "No authorized bank connector is configured, so bank destinations are instructions-only.",
    },
    {
      provider: "AIRTEL_MONEY",
      ready: false,
      mode: "NONE",
      missing: [],
      note: "Airtel Money is not implemented in this build.",
    },
  ];
}

export function connectorReady(provider: string): boolean {
  return connectorReadiness().some((entry) => entry.provider === provider && entry.ready);
}
