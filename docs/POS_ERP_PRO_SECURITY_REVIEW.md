# POS / ERP - PRO — security review (internal, pre-release)

**Scope.** The POS / ERP - PRO surface added in this branch: `lib/erp/*`, `lib/messaging/*`,
`app/dashboard/erp/*`, `app/api/erp/*`, `app/api/store/*`, `app/api/webhooks/messaging/*`,
`app/store/*` and the ERP additions to the Prisma schema.

**What this is not.** This is an **internal engineering review**, not an independent penetration
test, SOC 2 audit or legal review. No external party has examined this code. Nothing here has been
tested against a live provider, KRA eTIMS, or a hostile third party with network access.

**Posture.** Every integration is off by default and fails closed. A deployment that sets no ERP
environment variables serves the screens but refuses to send messages, submit to KRA or claim a
payment is settled.

## Controls in place

| Area | Control | Evidence |
| --- | --- | --- |
| Tenant isolation | Business comes from the authenticated session, never from the body. `assertBusinessOwnership` + `requireErpAccess` run before any tenant row is read. Cross-tenant access is a 403/404 with no row returned. | `tests/unit/erp-access.test.ts`; `tests/integration/erp-pro-postgres.test.ts` ("keeps tenants apart") |
| Authorisation | 6 roles × 27 permissions in one matrix; `requireErpAccess(..., { permission })` throws 403 before the loader runs. Team overrides live in `ErpConfiguration.teamRolesJson`, are validated on write and audited. | `tests/unit/erp-team.test.ts`, `tests/unit/erp-access.test.ts`, DB suite |
| Approval authority | Spend caps per role (MANAGER KES 10,000; FINANCE KES 50,000; STAFF/VIEWER 0; OWNER/ADMIN unlimited) checked server-side, not in the UI. | `lib/erp/access.ts` `ERP_APPROVAL_LIMITS_CENTS` |
| Money integrity | Integer cents only, clamped to 10¹⁰; balanced journals only (unbalanced refused with the KES difference); posted journals immutable — corrections are posted reversals; closed periods refuse new entries. | `tests/unit/erp-accounting.test.ts`, DB suite |
| Duplicate prevention | Unique `(businessId, idempotencyKey)` on orders, invoices, payments, wallet ledger and contacts; reserved unique sequence numbers per tenant; callback events de-duplicated by event id. | `tests/unit/erp-schema.test.ts`, DB suite (P2002, replay tests) |
| Messaging safety | Consent and suppression checked at send time, not just at scheduling; stop keywords matched on the whole message; GSM-7/UCS-2 segmentation charged honestly; `UNKNOWN` provider outcomes are never blindly resent; circuit breaker pauses after 5 consecutive failures; wallet credit is compare-and-set. | `tests/unit/messaging-*.test.ts`, `tests/unit/erp-wallet.test.ts` |
| Provider callbacks | HMAC-SHA256 over the **raw** body compared with `timingSafeEqual`; an unset secret means every callback is refused; rate limited to 120/min per provider. | `app/api/webhooks/messaging/[provider]/route.ts`, `lib/messaging/providers.ts` |
| Public shop | Product references are HMAC-signed and truncated (22 chars) so ids cannot be guessed; orders are addressed by a 32-character random token, not a sequential number; delivery areas, minimum order and opening hours re-checked server-side; a hidden honeypot field rejects bots. | `lib/erp/storefront.ts`, `tests/unit/erp-storefront.test.ts` |
| eTIMS truthfulness | Submission is blocked unless `ETIMS_LIVE_ENABLED="true"` **and** a certified `ETIMS_ADAPTER_KEY` exists; local validation runs first; a transport error is `UNCERTAIN`, never accepted; `ACCEPTED` requires KRA's control number **and** the `KRA_ETIMS` response source; `etimsSubmissionPosture().canSubmit` is always false in this release. | `tests/unit/erp-etims.test.ts`, DB suite |
| Payments | An ERP payment is recorded only from a verified payment record; a provider notification alone never marks money settled; over-allocation is refused; refunds are mirrored by a posted reversal, not by editing the original. | `tests/unit/erp-invoicing.test.ts`, DB suite |
| Audit trail | Every privileged action writes `ErpAuditEvent` with actor, outcome, reason and before/after JSON. There is no update or delete path for audit rows in the application. | `lib/erp/audit.ts`; grep shows only `create` |
| Secrets | `.env.example` documents every variable the code reads and nothing else; secrets are server-only; error responses are mapped through `safeError`/`erpErrorResponse` and never include SQL, stacks or provider payloads. | `.env.example`, `lib/safeError.ts`, `lib/erp/access.ts` |
| Transport headers | `X-Frame-Options: DENY` globally (public business pages `SAMEORIGIN` with `frame-ancestors 'self'`), `nosniff`, strict referrer policy, restrictive permissions policy. | `next.config.mjs` headers |
| Rate limiting | Export endpoint 3/min per business; messaging webhook 120/min per provider. | `app/api/erp/[businessId]/export/route.ts`, webhook route |

## Residual risks / accepted gaps

1. **No independent security review.** Required before a public launch; scheduled as a release
   blocker.
2. **No live provider verification.** Every messaging adapter other than the sandbox is
   `configured: false` and returns `PROVIDER_NOT_CONFIGURED`. Webhook handling has only been
   exercised with local signatures and mocks, never with a real provider's retry storms.
3. **In-process rate limiting.** `lib/rate-limit.ts` is per-instance memory; on a multi-instance
   deployment the effective limit multiplies. A shared store is needed before relying on it for
   abuse prevention.
4. **No per-tenant quota on e-mail/SMS triggering via automations** beyond wallet balance and role
   permissions.
5. **Team role overrides are stored as JSON** rather than a relation. They are validated on write
   and read through one resolver, but a hand-edited row is only normalised (unknown roles fall back
   to the membership role), not rejected.
6. **The audit log is best-effort at the storage layer** (`logErpAudit` swallows write errors so it
   can never break the business transaction). A failed audit insert is therefore not surfaced; a
   stricter deployment should write audits inside the same transaction when it matters.
7. **No encryption at rest beyond the database provider's default.** PINs, phone numbers and
   customer names are stored in plain text columns, matching the existing POS tables.
8. **No data-retention or deletion workflow** for ERP financial records beyond tenant cascade
   deletes; Kenyan record-keeping obligations were not modelled.
9. **KYC documents** (`ErpKycDocument`) point at uploaded media through the existing Studio media
   pipeline. Sender ID applications are not reviewed by a human in this release, so no document is
   marked verified.

## Secrets handling

No credential, token or key is committed. `.env.example` contains placeholders only. The
verification database used a disposable local cluster with a throwaway role and no password
traffic left the machine. Provider keys, if ever configured, belong in the hosting provider's
secret store; the ERP reads them server-side only and never sends them to a browser.
