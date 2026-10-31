import "server-only";

/**
 * Test-mode provider lookup only. Never falls back to the application's Paystack secret.
 * The caller must authenticate/authorize, validate its own feature gate and compare the
 * result with a fresh local snapshot. No settlement, commission or provider mutation occurs.
 */
export async function readSandboxTransaction(reference: string) {
  const secret = process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET;
  if (process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED !== "true" ||
      !secret || !/^sk_test_[A-Za-z0-9]+$/.test(secret) || secret.length > 255 ||
      !/^[A-Za-z0-9.=-]{1,255}$/.test(reference)) throw new Error("SANDBOX_NOT_AVAILABLE");
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => null);
  const data = result?.data;
  const id = typeof data?.id === "number" && Number.isSafeInteger(data.id) && data.id > 0 ? String(data.id) : data?.id;
  if (!response.ok || result?.status !== true || !data || typeof id !== "string" || !/^[1-9]\d{0,254}$/.test(id) ||
      typeof data.reference !== "string" || !/^[A-Za-z0-9.=-]{1,255}$/.test(data.reference) ||
      typeof data.status !== "string" || !/^[a-z_]{1,32}$/.test(data.status) ||
      typeof data.currency !== "string" || !/^[A-Z]{3}$/.test(data.currency) ||
      !Number.isSafeInteger(data.amount) || data.amount < 0) throw new Error("SANDBOX_RESPONSE_INVALID");
  return { transactionId: id, reference: data.reference, status: data.status, currency: data.currency, amountMinor: BigInt(data.amount) };
}
