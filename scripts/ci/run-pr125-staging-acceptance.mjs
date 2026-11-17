import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const fail = (code) => { throw new Error(code); };
const required = (name) => {
  const value = process.env[name];
  if (!value) fail(`MISSING_${name}`);
  return value;
};

if (process.env.VERCEL_ENV !== "preview" || process.env.JATA_RUN_STAGING_ACCEPTANCE !== "true") {
  fail("PR125_ACCEPTANCE_MUST_RUN_ON_EXPLICIT_PREVIEW_OPT_IN");
}
if (process.env.VERCEL_GIT_COMMIT_REF !== "remediation/owner-authorized-acceptance-v2-2026-11-16") {
  fail("PR125_ACCEPTANCE_BRANCH_MISMATCH");
}
const publicKey = required("PAYSTACK_PUBLIC_KEY");
const secretKey = required("PAYSTACK_SECRET_KEY");
const demoPassword = required("DEMO_FIXTURE_PASSWORD");
if (!publicKey.startsWith("pk_test_") || !secretKey.startsWith("sk_test_")) fail("PAYSTACK_TEST_KEY_PREFIX_REQUIRED");
if (demoPassword.length < 32) fail("DEMO_FIXTURE_PASSWORD_TOO_SHORT");

const prisma = new PrismaClient();
const baseUrl = "http://127.0.0.1:3100";
let server;

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) fail("NEXT_START_EXITED_BEFORE_READY");
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail("NEXT_START_TIMEOUT");
}

async function jsonResponse(response, code) {
  let body;
  try { body = await response.json(); } catch { fail(code); }
  if (!response.ok) fail(code);
  return body;
}

async function paystackRequest(path, method, body) {
  const response = await fetch(`https://api.paystack.co/${path}`, {
    method,
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await jsonResponse(response, `PAYSTACK_${path.toUpperCase().replaceAll("/", "_")}_HTTP_FAILED`);
  if (result.status !== true || !result.data) fail(`PAYSTACK_${path.toUpperCase().replaceAll("/", "_")}_REJECTED`);
  return result.data;
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (server.exitCode === null) server.kill("SIGKILL");
}

try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"], {
    env: { ...process.env, PORT: "3100", HOSTNAME: "127.0.0.1" },
    stdio: "ignore",
  });
  await waitForServer();

  const demoEmail = "pr125-staging-owner@jata.link";
  const owner = await prisma.user.findUnique({ where: { email: demoEmail }, select: { id: true, email: true } });
  const checkoutBusiness = await prisma.business.findUnique({ where: { slug: "pr125-staging-checkout" }, select: { id: true } });
  const settlementBusiness = await prisma.business.findUnique({ where: { slug: "pr125-staging-settlement" }, select: { id: true } });
  const posPlan = await prisma.planConfig.findUnique({ where: { key: "BUSINESS_POS" }, select: { id: true, key: true, priceKES: true, durationDays: true } });
  if (!owner || !checkoutBusiness || !settlementBusiness || !posPlan) fail("SYNTHETIC_FIXTURE_MISSING");
  if (posPlan.priceKES !== 499 || posPlan.durationDays !== 30) fail("BUSINESS_POS_PLAN_CONFIGURATION_MISMATCH");

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: demoEmail, password: demoPassword }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!login.ok) fail("SYNTHETIC_OWNER_LOGIN_FAILED");
  const setCookies = typeof login.headers.getSetCookie === "function" ? login.headers.getSetCookie() : [login.headers.get("set-cookie") || ""];
  const sessionCookie = setCookies.map((value) => value.split(";")[0]).find((value) => value.startsWith("jata_session="));
  if (!sessionCookie) fail("SYNTHETIC_OWNER_SESSION_COOKIE_MISSING");
  console.log("[pr125-staging] authenticated synthetic owner login: PASS");

  await prisma.payment.updateMany({
    where: { businessId: checkoutBusiness.id, planId: posPlan.id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ businessId: checkoutBusiness.id, planId: posPlan.id }),
    signal: AbortSignal.timeout(30_000),
  });
  const checkout = await jsonResponse(checkoutResponse, "APP_CHECKOUT_INITIALIZATION_FAILED");
  if (checkout.mock === true || typeof checkout.reference !== "string" || typeof checkout.authorization_url !== "string") fail("APP_CHECKOUT_DID_NOT_INITIALIZE_PAYSTACK");
  const checkoutHost = new URL(checkout.authorization_url).hostname;
  if (!checkoutHost.endsWith("paystack.com")) fail("APP_CHECKOUT_PROVIDER_HOST_MISMATCH");
  const checkoutPayment = await prisma.payment.findUnique({ where: { reference: checkout.reference }, select: { status: true, amount: true, currency: true } });
  if (!checkoutPayment || checkoutPayment.status !== "PENDING" || checkoutPayment.amount !== 49_900 || checkoutPayment.currency !== "KES") fail("APP_CHECKOUT_PENDING_PAYMENT_NOT_PERSISTED");
  await prisma.payment.updateMany({ where: { reference: checkout.reference, status: "PENDING" }, data: { status: "CANCELLED" } });
  console.log("[pr125-staging] authenticated checkout initialization against Paystack test API: PASS");

  const reference = `pr125-${randomUUID()}`;
  const payment = await prisma.payment.create({
    data: {
      reference,
      businessId: settlementBusiness.id,
      userId: owner.id,
      planId: posPlan.id,
      amount: 49_900,
      currency: "KES",
      status: "PENDING",
    },
    select: { id: true, reference: true, amount: true, currency: true },
  });

  let charge = await paystackRequest("charge", "POST", {
    email: owner.email,
    amount: String(payment.amount),
    currency: payment.currency,
    reference,
    card: { number: "4084084084084081", cvv: "408", expiry_month: "11", expiry_year: "2027" },
    metadata: { pr125_staging_acceptance: true, businessId: settlementBusiness.id },
  });
  if (charge.status === "send_otp") charge = await paystackRequest("charge/submit_otp", "POST", { reference, otp: "123456" });
  if (charge.status === "send_pin") charge = await paystackRequest("charge/submit_pin", "POST", { reference, pin: "0000" });
  if (charge.status !== "success" || charge.reference !== reference) fail("PAYSTACK_TEST_CARD_CHARGE_FAILED");

  const verified = await paystackRequest(`transaction/verify/${encodeURIComponent(reference)}`, "GET");
  if (verified.status !== "success" || verified.reference !== reference || verified.amount !== payment.amount || verified.currency !== payment.currency) fail("PAYSTACK_TEST_TRANSACTION_VERIFICATION_FAILED");
  if (verified.domain && verified.domain !== "test") fail("PAYSTACK_TRANSACTION_NOT_IN_TEST_DOMAIN");
  console.log("[pr125-staging] Paystack test-card charge and provider verification: PASS");

  const eventId = `pr125-webhook-${verified.id}-${randomUUID()}`;
  const webhookBody = JSON.stringify({
    id: eventId,
    event: "charge.success",
    data: {
      id: verified.id,
      reference,
      amount: verified.amount,
      currency: verified.currency,
      status: verified.status,
      paid_at: verified.paid_at,
      customer: verified.customer,
      metadata: verified.metadata,
    },
  });
  const signature = createHmac("sha512", secretKey).update(webhookBody).digest("hex");
  const invalidSignature = await fetch(`${baseUrl}/api/paystack/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": "0".repeat(128) },
    body: webhookBody,
    signal: AbortSignal.timeout(15_000),
  });
  if (invalidSignature.status !== 401) fail("INVALID_PAYSTACK_SIGNATURE_WAS_NOT_REJECTED");
  const beforeValid = await prisma.processedWebhook.count({ where: { id: eventId } });
  if (beforeValid !== 0) fail("INVALID_SIGNATURE_WROTE_PROCESSED_EVENT");
  console.log("[pr125-staging] invalid webhook signature rejection: PASS");

  const validWebhook = await fetch(`${baseUrl}/api/paystack/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body: webhookBody,
    signal: AbortSignal.timeout(30_000),
  });
  const validBody = await jsonResponse(validWebhook, "VALID_PAYSTACK_WEBHOOK_SETTLEMENT_FAILED");
  if (validBody.status !== "processed") fail("VALID_PAYSTACK_WEBHOOK_NOT_PROCESSED");

  const settled = await prisma.payment.findUnique({ where: { reference }, select: { id: true, status: true, paystackId: true } });
  const posSubscription = await prisma.posSubscription.findUnique({ where: { businessId: settlementBusiness.id }, select: { status: true, paymentId: true, updatedAt: true } });
  const posEntitlement = await prisma.posEntitlement.findUnique({ where: { businessId: settlementBusiness.id }, select: { status: true } });
  const processedCount = await prisma.processedWebhook.count({ where: { id: eventId } });
  if (settled?.status !== "PAID" || settled.paystackId !== String(verified.id)) fail("PAYMENT_ROW_NOT_SETTLED");
  if (posSubscription?.status !== "ACTIVE" || posSubscription.paymentId !== payment.id) fail("POS_SUBSCRIPTION_NOT_ACTIVATED");
  if (posEntitlement?.status !== "ACTIVE" || processedCount !== 1) fail("POS_ENTITLEMENT_OR_WEBHOOK_LEDGER_NOT_SETTLED");
  const firstSettlementUpdatedAt = posSubscription.updatedAt.getTime();
  console.log("[pr125-staging] signed webhook and application settlement: PASS");

  const duplicateWebhook = await fetch(`${baseUrl}/api/paystack/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body: webhookBody,
    signal: AbortSignal.timeout(15_000),
  });
  const duplicateBody = await jsonResponse(duplicateWebhook, "DUPLICATE_WEBHOOK_REPLAY_FAILED");
  const afterDuplicate = await prisma.posSubscription.findUnique({ where: { businessId: settlementBusiness.id }, select: { updatedAt: true } });
  const finalProcessedCount = await prisma.processedWebhook.count({ where: { id: eventId } });
  if (duplicateBody.status !== "already_processed" || afterDuplicate?.updatedAt.getTime() !== firstSettlementUpdatedAt || finalProcessedCount !== 1) fail("DUPLICATE_WEBHOOK_NOT_IDEMPOTENT");
  console.log("[pr125-staging] duplicate webhook idempotency: PASS");

  const appVerify = await fetch(`${baseUrl}/api/paystack/verify?reference=${encodeURIComponent(reference)}`, {
    headers: { cookie: sessionCookie },
    signal: AbortSignal.timeout(15_000),
  });
  const appVerifyBody = await jsonResponse(appVerify, "AUTHENTICATED_PAYMENT_VERIFY_FAILED");
  if (appVerifyBody.status !== "PAID" || appVerifyBody.subscriptionStatus !== "ACTIVE") fail("AUTHENTICATED_PAYMENT_VERIFY_STATE_MISMATCH");
  console.log("[pr125-staging] authenticated payment verification and active POS entitlement: PASS");
  console.log("[pr125-staging] all Neon + Paystack test-mode acceptance checks passed");
} finally {
  await stopServer();
  await prisma.$disconnect();
}
