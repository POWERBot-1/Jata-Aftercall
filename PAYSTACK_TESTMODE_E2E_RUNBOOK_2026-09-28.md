# PAYSTACK TEST-MODE E2E — OPERATOR RUNBOOK (2026-09-28)

**Gate:** G3 — Paystack test-mode E2E (steps 1–12)
**Authorized approach:** Vercel **Preview** deployment + **isolated test database**
**Status:** ⛔ **BLOCKED IN SANDBOX — operator-side actions required. STOPPED as instructed (no improvisation).**

---

## 1. Why the sandbox stopped (measured 2026-09-28)

| Requirement | Finding |
|---|---|
| Vercel CLI authentication | `vercel` binary not installed; no `VERCEL_TOKEN` in environment; no `~/.vercel` credentials. The prior session's authentication as `powerbot-1` did not carry into this fresh sandbox. |
| Network egress to Vercel | `https://jata-aftercall.vercel.app/health` → `SSL_ERROR_SYSCALL` (egress blocked). |
| Network egress to Paystack | `https://api.paystack.co/` → `SSL_ERROR_SYSCALL` (egress blocked). Cannot initialize transactions or receive/replay webhooks. |
| GitHub egress | Working (`git`/`gh` OK) — PR operations unaffected. |
| Test secrets | `sk_test_*` / `pk_test_*` keys and the isolated `DATABASE_URL` are operator-held; per G3 rules they must never be printed, committed, or pasted into chat. |

Consequence: steps 3–4 of the flow (test-mode charge and Paystack-originated webhook delivery) cannot be executed from the sandbox. Per the G3 instruction — *"identify the exact operator-side action required and STOP rather than improvising"* — execution halts here.

## 2. Exact operator-side actions required to unblock

1. **Vercel access** — authenticate the Vercel CLI in the execution environment as `powerbot-1` (`vercel login`, or provide a `VERCEL_TOKEN` scoped to project `powerbot-1/jata-aftercall`).
2. **Isolated test database** — provision a fresh Postgres database (e.g. a new Neon branch/database, separate from production) and expose its `DATABASE_URL` **only** as a Vercel Preview environment variable. Never reuse the production `DATABASE_URL`.
3. **Paystack test keys** — set `PAYSTACK_SECRET_KEY=sk_test_…` and `PAYSTACK_PUBLIC_KEY=pk_test_…` as **Preview-only** environment variables in the Vercel dashboard (never in chat, never in Git).
4. **Webhook registration** — in the Paystack dashboard (test mode, merchant JATA ATLAS 2006074): Settings → Webhooks → add `https://<preview-domain>/api/paystack/webhook` pointing at the preview deployment.
5. **Charge authorization** — the Paystack test checkout (authorization_url) must be completed in a browser with Paystack's test card `4084 0840 8408 4081` (any future expiry / CVV / OTP). This is a Paystack-hosted page and cannot be driven headlessly from this sandbox.

## 3. Execution flow once unblocked (authorized steps 1–12)

| # | Step | Expected evidence | Where verified |
|---|---|---|---|
| 1 | Register | account created; session cookie set; `200` | Operator browser (preview URL) |
| 2 | Create business | draft business row created for the new tenant | Operator browser |
| 3 | Checkout (Paystack **test mode**) | `POST /api/checkout` returns Paystack `authorization_url`; payable amount server-derived from PlanConfig | Operator browser |
| 4 | Webhook received | `charge.success` delivered to preview webhook; HMAC-SHA512 signature verified; `ProcessedWebhook` row written | Paystack dashboard + preview logs |
| 5 | Subscription ACTIVE | subscription transitions to `ACTIVE` with `expiresAt` = plan duration (30/365 days) | Operator browser (`/dashboard/subscription`) |
| 6 | Publish business | `isPublished = true` accepted (per G2 policy, no subscription gate) | Operator browser |
| 7 | `/b/slug` publicly live | logged-out browser receives `200` and full page | Operator browser (private window) |
| 8 | Analytics increment | `POST /api/analytics/event` bumps views/CTA counters; dashboard shows increment | Operator browser |
| 9 | Duplicate webhook | second delivery → `already_processed`; **no double extension** of `expiresAt` | Preview logs + dashboard expiry |
| 10 | Renewal/extension | renewed payment extends expiry from current `expiresAt` (not from payment date) | Dashboard |
| 11 | `prisma migrate deploy` | preview build gate runs `scripts/migrate.sh` → `prisma migrate deploy` cleanly on the isolated DB | Vercel build logs |
| 12 | Seed evidence | demo seed where applicable on the isolated DB | `npm run seed` logs |

**Safety rails (non-negotiable):** production database is never targeted; production is never modified; no secret is printed, committed, or pasted; test data lives only in the isolated DB.

## 4. G4 — public page operator measurements (same operator session)

Measure on the live public `/b/slug` from step 7 and record per-page results:

- Lighthouse / performance score (mobile)
- OG title · OG description · OG image
- Canonical URL
- Mobile sticky CTA present and actionable
- Web Share API with visible fallback
- Analytics counter increments on view/CTA
- Tenant-scoped analytics (events attribute only to the owning business — cross-check a second tenant's dashboard)

Rule: measurements are recorded as observed; no code is altered to manufacture passing values.

---

**Next gate after execution:** post G3/G4 evidence for independent verification. Production remains untouched by this gate.
