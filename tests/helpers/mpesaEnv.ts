/**
 * A complete, valid, obviously-fake M-PESA configuration for tests.
 *
 * Nothing here is a real credential, and none of it can reach a real Safaricom host: every value is
 * a placeholder shaped to satisfy JATA's configuration validation, and tests inject their own
 * `fetch`. CI never needs — and must never be given — a production secret.
 */

export const TEST_MPESA = {
  MPESA_ENV: "sandbox",
  MPESA_CONSUMER_KEY: "test_consumer_key_0123456789",
  MPESA_CONSUMER_SECRET: "test_consumer_secret_0123",
  // Safaricom's public sandbox shortcode: valid with MPESA_ENV=sandbox, refused in production.
  MPESA_SHORTCODE: "174379",
  MPESA_PASSKEY: "test_passkey_0123456789abcdef0123456789",
  MPESA_CALLBACK_TOKEN: "test_callback_token_0123456789ab",
  MPESA_INITIATOR_NAME: "JATA_TEST",
  // Base64-shaped placeholder (the real value is an RSA-encrypted password, base64 encoded).
  MPESA_SECURITY_CREDENTIAL: "dGVzdC1zZWN1cml0eS1jcmVkZW50aWFsLWJhc2U2NA==",
  PUBLIC_BASE_URL: "https://jata.test",
} as const;

/** Every variable the M-PESA configuration reads, so a test can start from a known-empty slate. */
export const MPESA_ENV_KEYS = [
  "MPESA_ENV",
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_CALLBACK_TOKEN",
  "MPESA_INITIATOR_NAME",
  "MPESA_SECURITY_CREDENTIAL",
  "MPESA_STK_CALLBACK_URL",
  "MPESA_C2B_CONFIRMATION_URL",
  "MPESA_C2B_VALIDATION_URL",
  "MPESA_ALLOWED_IPS",
  "PUBLIC_BASE_URL",
  "NEXTAUTH_URL",
  "JATA_PAYMENTS_TEST_MODE",
  "VERCEL_ENV",
  "PAYSTACK_SECRET_KEY",
] as const;

/**
 * Clears every M-PESA-related variable, applies the valid test configuration plus any overrides
 * (`undefined` deletes a variable), and returns a function that restores the original environment.
 */
export function applyMpesaEnv(overrides: Partial<Record<string, string | undefined>> = {}): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of MPESA_ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  const merged: Record<string, string | undefined> = { ...TEST_MPESA, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** A Response with a JSON body, as Daraja sends it. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
