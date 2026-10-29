#!/usr/bin/env node
/**
 * JATA AFTERCALL — password-reset production end-to-end verification.
 *
 * WHY THIS EXISTS
 * ---------------
 * `production-smoke.yml` is GET-only by charter, and the environment that drives these runs
 * cannot open arbitrary TCP connections to the production origin. This script is the POST-capable
 * counterpart, dispatched manually through `password-reset-e2e.yml`, and it only ever touches the
 * operator-designated E2E test account (email supplied via the E2E_ACCOUNT_EMAIL secret).
 *
 * PHASES (the flow spans two dispatches because the reset link arrives in a real mailbox)
 *   request    register the test account if absent, request a password reset for it and for an
 *               unknown control address, and assert the responses are byte-identical
 *               (anti-enumeration). Exit 2 = delivery unconfigured (SMTP vars missing).
 *   complete   redeem the one-time link (token supplied via the E2E_RESET_TOKEN secret, set by
 *               the operator after reading the email), then prove: the password changed, the
 *               link cannot be replayed, login works with the NEW password, and a wrong
 *               password is refused.
 *
 * WHAT IT NEVER DOES
 *   It never prints the account email, the reset token, any password, or any response body.
 *   Every generated password is masked with ::add-mask:: before first use. It never touches
 *   accounts other than the designated one and the guaranteed-unknown control address.
 *
 * EXIT CODES
 *   0  all assertions passed
 *   1  an assertion failed
 *   2  blocked (delivery unconfigured, or a required secret is missing)
 */

const BASE_URL = (process.env.E2E_BASE_URL || "https://jataaftercall.co.ke").replace(/\/+$/, "");
const ACCOUNT_EMAIL = (process.env.E2E_ACCOUNT_EMAIL || "").trim().toLowerCase();
const CONTROL_EMAIL = `e2e-control-${Date.now()}@example.invalid`;
const PHASE = process.env.E2E_PHASE || "";

function mask(value) {
  // GitHub Actions masks the value in all subsequent log lines.
  console.log(`::add-mask::${value}`);
}

function label(ok, name) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

async function post(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "jata-password-reset-e2e/1.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function get(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    redirect: "follow",
    headers: { "user-agent": "jata-password-reset-e2e/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, text: await response.text() };
}

function freshPassword() {
  return `E2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-Reset!`;
}

let failed = 0;
function assert(ok, name) {
  label(ok, name);
  if (!ok) failed += 1;
}

async function phaseRequest() {
  if (!ACCOUNT_EMAIL) {
    console.log("BLOCKED: E2E_ACCOUNT_EMAIL secret is not set");
    return 2;
  }

  // 1. Ensure the test account exists (a fresh password each run; it is only a placeholder —
  //    phase `complete` replaces it with a brand-new one before signing in).
  const registerPassword = freshPassword();
  mask(registerPassword);
  const register = await post("/api/auth/register", {
    name: "Password Reset E2E",
    email: ACCOUNT_EMAIL,
    password: registerPassword,
    businessName: "Password Reset E2E",
  });
  // 201/200 = created, 4xx = already registered or validation detail — either is fine here.
  label(register.status < 500, `test account is available (register status ${register.status})`);

  // 2. Request resets for the account and for a guaranteed-unknown control address. The two
  //    responses must be indistinguishable in status and body.
  const known = await post("/api/auth/password-reset", { email: ACCOUNT_EMAIL });
  const unknown = await post("/api/auth/password-reset", { email: CONTROL_EMAIL });

  if (known.status === 503 && unknown.status === 503) {
    console.log("BLOCKED: password reset delivery is not configured on this deployment (503 for every address)");
    return 2;
  }

  assert(known.status === 202, `reset request accepted for the test account (status ${known.status})`);
  assert(unknown.status === 202, `reset request accepted for an unknown control address (status ${unknown.status})`);
  assert(known.status === unknown.status, "responses are identical across known/unknown accounts (status)");
  assert(known.text === unknown.text, "responses are identical across known/unknown accounts (body)");
  assert(!known.text.includes(ACCOUNT_EMAIL), "response body does not echo the address");

  // 3. The public screens render.
  const forgot = await get("/forgot-password");
  assert(forgot.status === 200 && /reset your password/i.test(forgot.text), "GET /forgot-password renders the request screen");
  const reset = await get("/reset-password");
  assert(reset.status === 200, "GET /reset-password renders the update screen");

  return failed ? 1 : 0;
}

async function phaseComplete() {
  const token = (process.env.E2E_RESET_TOKEN || "").trim();
  if (!token) {
    console.log("BLOCKED: E2E_RESET_TOKEN secret is not set (read the reset email, then set it)");
    return 2;
  }
  mask(token);
  const newPassword = freshPassword();
  mask(newPassword);
  const wrongPassword = freshPassword();
  mask(wrongPassword);

  // 1. Redeem the one-time link.
  const complete = await post("/api/auth/password-reset/complete", { token, password: newPassword });
  assert(complete.status === 200, `password updated via the one-time link (status ${complete.status})`);

  // 2. The same link must not work twice.
  const replay = await post("/api/auth/password-reset/complete", { token, password: wrongPassword });
  assert(replay.status >= 400 && replay.status < 500, `replayed link is refused (status ${replay.status})`);

  // 3. Login with the NEW password succeeds; a wrong password is refused.
  const goodLogin = await post("/api/auth/login", { email: ACCOUNT_EMAIL, password: newPassword });
  assert(goodLogin.status === 200, `login with the new password succeeds (status ${goodLogin.status})`);
  const badLogin = await post("/api/auth/login", { email: ACCOUNT_EMAIL, password: wrongPassword });
  assert(badLogin.status === 401, `login with a wrong password is refused (status ${badLogin.status})`);

  return failed ? 1 : 0;
}

let exitCode = 1;
try {
  if (PHASE === "request") exitCode = await phaseRequest();
  else if (PHASE === "complete") exitCode = await phaseComplete();
  else {
    console.log("BLOCKED: set E2E_PHASE to request|complete");
    exitCode = 2;
  }
} catch (error) {
  console.log(`FAIL transport error (${error?.name || "error"}: ${String(error?.message || error).slice(0, 120)})`);
  exitCode = 1;
}
console.log(`exit ${exitCode}`);
process.exit(exitCode);
