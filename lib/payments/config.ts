/**
 * Provider readiness (§2, §12, §58, §73, §129).
 *
 * JATA's central connector credentials live in the server environment. This module is the only
 * place that reads them, the only place that decides whether a provider is *actually* connected
 * in this deployment, and it never returns a secret — only whether the connector is ready and
 * which names are still missing (for internal administration, never for a browser response).
 *
 * Honesty rule (§129): if the credentials for a provider are absent, JATA says so plainly and
 * keeps the merchant-facing capability at "payment instructions". It never pretends a provider
 * is live because the code for it exists.
 */

export type MpesaConfig = {
  env: "sandbox" | "production";
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** JATA's own paying shortcode used to raise the STK prompt. */
  shortcode: string;
  passkey: string;
  /** JATA's central callback for STK prompts — never a merchant URL (§14). */
  stkCallbackUrl: string;
  /** JATA's central C2B confirmation endpoint registered with Safaricom (§34). */
  c2bConfirmationUrl: string;
  c2bValidationUrl: string;
  /** Path token(s) JATA registers inside its callback URLs, so a bare URL guess cannot post. */
  callbackToken: string;
  /** Optional IP allowlist for provider callbacks (§35). Empty = not enforced. */
  allowedIps: string[];
  ready: boolean;
  missing: string[];
};

function envValue(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function absoluteUrl(value: string, base: string, path: string): string {
  const raw = value || `${base.replace(/\/$/, "")}${path}`;
  return raw;
}

export function publicBaseUrl(): string {
  return (envValue("PUBLIC_BASE_URL") || envValue("NEXTAUTH_URL") || "http://localhost:3000").replace(/\/$/, "");
}

export function readMpesaConfig(): MpesaConfig {
  const env = envValue("MPESA_ENV").toLowerCase() === "production" ? "production" : "sandbox";
  const baseUrl = env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
  const consumerKey = envValue("MPESA_CONSUMER_KEY");
  const consumerSecret = envValue("MPESA_CONSUMER_SECRET");
  const shortcode = envValue("MPESA_SHORTCODE");
  const passkey = envValue("MPESA_PASSKEY");
  const callbackToken = envValue("MPESA_CALLBACK_TOKEN");
  const stkCallbackUrl = absoluteUrl(envValue("MPESA_STK_CALLBACK_URL"), publicBaseUrl(), `/api/payments/webhooks/mpesa/stk?token=${callbackToken}`);
  const c2bConfirmationUrl = absoluteUrl(envValue("MPESA_C2B_CONFIRMATION_URL"), publicBaseUrl(), `/api/payments/webhooks/mpesa/confirmation?token=${callbackToken}`);
  const c2bValidationUrl = absoluteUrl(envValue("MPESA_C2B_VALIDATION_URL"), publicBaseUrl(), `/api/payments/webhooks/mpesa/validation?token=${callbackToken}`);

  const missing: string[] = [];
  if (!consumerKey) missing.push("MPESA_CONSUMER_KEY");
  if (!consumerSecret) missing.push("MPESA_CONSUMER_SECRET");
  if (!shortcode) missing.push("MPESA_SHORTCODE");
  if (!passkey) missing.push("MPESA_PASSKEY");
  // Without the callback token the adapter refuses every provider callback (it cannot tell a real
  // Daraja event from a stranger's POST), so a deployment that lacks it cannot confirm money —
  // readiness must say so instead of reporting the connector live (§35, §129).
  if (!callbackToken) missing.push("MPESA_CALLBACK_TOKEN");

  return {
    env,
    baseUrl,
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    stkCallbackUrl,
    c2bConfirmationUrl,
    c2bValidationUrl,
    callbackToken,
    allowedIps: envValue("MPESA_ALLOWED_IPS").split(",").map((ip) => ip.trim()).filter(Boolean),
    ready: missing.length === 0,
    missing,
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
   * True only when the deployment said so out loud (`JATA_PAYMENTS_TEST_MODE=on`). Used to decide
   * whether an unauthenticated provider payload may be accepted at all (§35, §120).
   */
  explicit: boolean;
};

export function readTestMode(): TestModeState {
  const explicit = envValue("JATA_PAYMENTS_TEST_MODE").toLowerCase();
  if (explicit === "off" || explicit === "false" || explicit === "0") {
    return { enabled: false, reason: "Test mode is switched off for this deployment.", explicit: false };
  }
  if (explicit === "on" || explicit === "true" || explicit === "1") {
    return { enabled: true, reason: "JATA_PAYMENT_TEST_MODE is switched on for this deployment.", explicit: true };
  }
  const productionReady = readMpesaConfig().ready || readPaystackConfig().mode === "LIVE";
  return {
    enabled: !productionReady,
    reason: productionReady
      ? "A live provider connector is configured."
      : "No live provider connector is configured, so payments run in test mode.",
    explicit: false,
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
        ? `Daraja ${mpesa.env} connector configured; callbacks are registered centrally by JATA.`
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
