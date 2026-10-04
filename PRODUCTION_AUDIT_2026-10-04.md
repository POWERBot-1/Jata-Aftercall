# Production audit — 2026-10-04 (base `b733f41`)

Scope: public homepage, register/login, Monthly KES 149, Annual KES 999, AI Business Front Desk
KES 499, Interactive Business KES 999, Business POS KES 499, payment → server verification →
entitlement → publish, authorization / tenant isolation, deployment health.

## Defects found and fixed

| # | Severity | Defect | Reproduction / evidence | Fix | Regression test |
|---|---|---|---|---|---|
| 1 | **HIGH** | Admin pages relied on `app/admin/layout.tsx` alone. A request with `RSC: 1` + `Next-Router-State-Tree` ("layout already loaded") rendered the page segment for an **anonymous** visitor — the page executed and queried customers, phones, payments. | Reproduced on `next dev`: `/admin/payments` → 307 normally, **200 + page body** with the headers. After fix the same request yields `NEXT_REDIRECT`. | `lib/adminGuard.ts` `requireAdminPage()` called first in all 6 admin pages. | `tests/security/admin-page-authorization.test.ts` (19; 13 fail without the fix, incl. a "no admin page may skip the guard" scan) |
| 2 | **HIGH** | AI Front Desk entitlement bypass (plan substitution). A leftover ACTIVE `AIPackageEntitlement` row bypassed the plan check, so after buying AI (499) and then Monthly (149) live AI stayed on for the Monthly window. | `deriveAIEntitlement` with Monthly subscription + stale AI row → `entitled: true` (failing probe). | `lib/ai-entitlement.ts`: a subscription row that belongs to another product always means "not AI". | `tests/unit/ai-entitlement-plan-substitution.test.ts` |
| 3 | **MEDIUM-HIGH** | A refunded Business POS payment left the POS ACTIVE and wrongly suspended the business's unrelated AFTERCALL subscription (refund branch only touched `Subscription`). | Code path + test: refund of a POS payment never wrote `PosSubscription`. | `app/api/paystack/webhook/route.ts`: plan resolved from the stored payment; POS refund suspends `PosSubscription`/`PosEntitlement`/LIVE `PosConfiguration` (+audit), AFTERCALL refund unchanged. Still inside the idempotent transaction. | `tests/integration/paystack-refund-pos.test.ts` |
| 4 | **MEDIUM** | Every public `/b/<slug>` page showed "Ask AI Front Desk →" even without the paid package; `/b/<slug>/ai` answers 404 → customers land on "Page not found" (all 4 production demo pages). | Production fetch of `/b/nyumbani-kitchen` and `/b/nyumbani-kitchen/ai`. | Link rendered only when `getAIPackageStatus().entitled` (server-side, fails closed). | `tests/unit/business-page-ai-link.test.ts` |
| 5 | **LOW-MEDIUM** | Production homepage rendered `AI Business Front Desk � KES 499/month` and `Interactive Business � KES 999/month` (U+FFFD in stored plan names); DB-failure fallback silently dropped both products. | Production homepage fetch. | `planDisplayName()` falls back to the canonical name for a corrupt stored name; fallback lists all four advertised plans (never the private POS plan). Prices unchanged. | `tests/unit/homepage-plan-cards.test.ts` |

## Verified as already correct (no change)

Checkout resolves price from `PlanConfig` server-side and fails closed on mis-priced AI / Interactive / POS plans;
webhook signature (HMAC-SHA512, timing-safe), amount/currency/reference evidence, `ProcessedWebhook` replay guard and
PENDING→PAID compare-and-set; browser-side success never activates (mock path disabled in production); every
`/api/pos/*` mutation is permission-checked and `requireLive`/entitlement-gated; POS pages authorize via the same
loader; owner APIs return 401 unauthenticated; tenant checks derive from session; PR #34 AI Front Desk behaviours
(multi-item, Bamburi grade ambiguity, unlisted Savannah cement, ordinary conversation, delivery references) are
covered by existing tests, all passing.

## Not changed — reported

* **Demo businesses on production are empty** ("Contact details … coming soon", "No services listed yet") although the
  homepage advertises them as "Realistic examples". This is production *data*; `npm run seed` would restore it but
  also creates an admin with a documented default password when none exists — operator decision required.
* Sessions are stateless 7-day JWTs carrying `role`; a demoted admin keeps access until expiry. Design-level.
* `GET /api/auth/logout` logs out on GET (CSRF logout nuisance). Low.
* One `Subscription` row per business: buying a different AFTERCALL-family plan replaces the previous plan row
  (design; extension window still stacks).
* Interactive site stays live after lapse ("live copy unchanged" per `INTERACTIVE_BUSINESS_E2E_RUNBOOK` step 17) — documented behaviour.
* `normalizeBusinessRole` maps an unknown stored role to OWNER (fail-open). Latent: the app only ever writes `OWNER`
  memberships. `PATCH /api/business` uses a read-level guard for publishing. Latent while no non-owner members exist.

## Could not be verified (and why)

Real Paystack payment (no test mechanism / no keys), authenticated production UAT (register/login/dashboard/POS
journeys need POSTs and a session — only unauthenticated GETs were possible), production PlanConfig rows (no DB
access), mobile layout in a real browser, PostgreSQL-backed tests (2 files skipped: no `DATABASE_URL`; CI runs them).
