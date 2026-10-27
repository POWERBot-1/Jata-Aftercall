# POS / ERP - PRO — security review

Scope: everything added under `lib/erp`, `lib/messaging`, `app/api/erp`, `app/api/store`,
`app/api/webhooks`, `app/dashboard/erp`, `app/store`, `components/erp`, plus the schema and migration.

Method: read the code path for each threat, then try to break it in a unit test where the sandbox
allows. A control that is only described here and not covered by a test is marked
**NOT TESTED** — this is a self-review by the author, not a penetration test or an external audit.

Overall posture: **no critical or high finding open** in what could be tested. Three findings are
recorded as accepted risks with explicit limits (F-1 rate limiter is per-process, F-2 tenancy is
application-enforced rather than row-level, F-3 in-database queue under load). One area,
F-4 (production behaviour under real provider load), cannot be tested here at all.

---

## 1. Identity, session and authorisation

| Control | Implementation | Evidence |
| --- | --- | --- |
| Every ERP screen and action re-authorises | `requireErpAccess` runs per request; server components and server actions both call it | `tests/unit/erp-entitlement-access.test.ts` (23) |
| Tenant isolation | `assertBusinessOwnership` before any read; every query re-scoped by `businessId` | access suite; storefront cross-tenant 404 test |
| Role matrix | 6 roles × 27 permissions, unknown role → `VIEWER` | access suite |
| Approval limits | OWNER/ADMIN unlimited, FINANCE KES 50,000, MANAGER KES 10,000, STAFF/VIEWER 0 | access suite |
| Separation of duties | the approver of a campaign cannot be its creator | campaigns suite |
| Role assignment | ERP roles live in `ErpConfiguration.teamRolesJson`, not the shared `BusinessMember.role` (which also drives the POS); `OWNER` cannot be assigned or read back from JSON; nobody can change their own role; an ADMIN cannot mint an ADMIN | `tests/unit/erp-team.test.ts` (17) |
| Denied attempts | written to `ErpAuditEvent` with outcome `DENIED` and a reason code | access suite |
| Missing session | 401 before any data access | access suite |

**Finding F-2 (accepted).** Tenancy is enforced in application code plus `businessId` predicates,
not by PostgreSQL row-level security. A bug that forgets a `where: { businessId }` would be a
cross-tenant read. Mitigations in place: every table has a `businessId` index as its first column
(cheap to add the predicate), loaders take `businessId` as their only tenant input, and a test walks
`lib/erp` and `lib/messaging` to assert every Prisma model referenced actually exists. The residual
risk is a reviewer-level control, not a runtime one. RLS is worth adding before a multi-tenant
production launch with untrusted operators.

## 2. Secrets

| Control | Implementation |
| --- | --- |
| No secrets in the client bundle | Every module reading `process.env` is server-only (`lib/erp`, `lib/messaging`, route handlers). No `NEXT_PUBLIC_` ERP variable exists. |
| Secrets kept out of audit rows | `redactAuditValue` replaces any key matching `secret|password|token|api_key|authorization|private_key|otp`, recursively, depth-capped (`lib/erp/audit.ts`) |
| Secrets kept out of error responses | `safeError.ts` `SAFE_ERRORS` mapping; `actionErrorMessage` returns a generic sentence when a message looks like a driver error (`/prisma|sql|stack|ECONN|invocation/i`) |
| Shop signing secret | `STOREFRONT_REF_SECRET`; production refuses to serve the shop when it is missing or shorter than 16 characters (`503 STOREFRONT_UNCONFIGURED`) |
| Webhook secret | `MESSAGING_WEBHOOK_SECRET`; missing secret ⇒ every callback refused |
| Credentials in `.env.example` | All blank, with the note that provider keys belong in the host's secret store |

`.env.example` was rewritten in this change to only list variables the code actually reads. Earlier
drafts listed `MESSAGING_SMS_API_KEY` and friends which no adapter reads — a documentation trap that
would have made an operator believe a provider was connected when nothing was.

## 3. The public storefront (the only unauthenticated surface)

| Threat | Control | Evidence |
| --- | --- | --- |
| Enumerating products | Catalogue references are HMAC-SHA256 over `businessId:productId`, base64url, 22 chars. Sequential ids never appear in HTML. | storefront suite |
| Forging a reference | `resolveProductRef` rejects; `PRODUCT_UNAVAILABLE`, not a 20 MB error | storefront suite |
| Tampering with the basket | Every price is recomputed server-side from `PosProduct` via `effectiveUnitPrice`; a client-supplied price is ignored | storefront suite |
| Cross-tenant order | `placeStoreOrder` resolves the slug to one business; another tenant's slug is `STORE_CLOSED` | storefront suite |
| Replay / double order | `idempotencyKey` unique per `(businessId, idempotencyKey)`; replay returns the same order | storefront suite |
| Carding / scripted abuse | `rateLimit` 8 orders/minute per slug, plus a honeypot field (`company`) | API route + storefront suite |
| Oversell | Stock is checked and deducted in one `$transaction` at confirmation, never at order time | storefront suite |
| Data minimisation on the order page | `publicOrderView` masks the phone to its last three digits and exposes no internal ids | storefront suite |
| Probability of guessing an order URL | 32-char random token, `ErpStoreOrder_publicToken_key` unique | schema test |

**Finding F-1 (accepted).** `lib/rate-limit.ts` is an in-process limiter. On Vercel it bounds abuse
per lambda instance, not globally; a determined attacker with many concurrent connections gets more
throughput than the nominal rate. Accepted for launch because the endpoint creates no message, takes
no money and deducts no stock — the worst case is junk orders the merchant rejects. Before any paid
traffic, move the limiter to a shared store.

## 4. Messaging

| Threat | Control | Evidence |
| --- | --- | --- |
| Sending to someone who never consented | `consentDecision` requires a marketing consent record with source and wording version; a phone number alone is not consent | segments/consent suite |
| Sending after an opt-out | `MsgSuppression` beats consent, and is re-checked at dispatch, not only at audience build | dispatch suite (post-approval revocation) |
| Sending at 3am | 08:00–20:00 Nairobi quiet hours push the send later rather than dropping it | campaigns suite |
| Spamming a contact | frequency cap 4 per 30 days | campaigns suite |
| Sending from an unapproved Sender ID | `senderIdCanSend` requires `ACTIVE`; approval refuses without one | sender-ID + campaigns suites |
| Sending without cost confirmation | approval refuses without `costConfirmed` | campaigns suite |
| Duplicate send on retry | per-recipient `idempotencyKey`, CAS claim, and `UNKNOWN` outcomes are reconciled, never resent blind | dispatch suite |
| Provider timeout treated as failure | `UNKNOWN` + `AWAITING_RECONCILIATION`; a retry only after reconciliation | dispatch suite |
| Forged delivery callback | HMAC over the raw body, constant-time compare, dedupe by event id | dispatch suite |
| A live adapter on an unconfigured deployment | providers fail closed with `PROVIDER_NOT_CONFIGURED`; dispatch refuses live unless `MESSAGING_LIVE_ENABLED=true` | dispatch suite + route |
| Wallet drained by a bug | credit is a compare-and-set; approval reserves, dispatch charges actual segments, reconcile charges once or releases | dispatch suite |
| Spending without a human | no auto top-up, no auto-approval, kill switch pauses everything | campaigns + automation suites |

The route handler checks the signature **before** parsing JSON, so a malformed body cannot reach the
parser unauthenticated.

## 5. Accounting integrity

| Threat | Control | Evidence |
| --- | --- | --- |
| Unbalanced journal | `validateJournal` requires debits = credits, ≥2 lines, one side per line | accounting suite |
| Editing a posted entry | no update path exists; corrections are a mirrored reversal with a reason | accounting suite |
| Silent deletion | nothing deletes a journal; `ErpJournalLine` has no delete route | code review |
| Back-dating into a closed period | `closePeriod` blocks posting; reopening needs a reason of ≥10 characters and is audited | accounting suite |
| Invoice double-post | `idempotencyKey` unique per tenant; re-issuing returns `alreadyIssued` | invoicing suite |
| Payment marked settled by a notification | `recordPayment` only writes from a verified provider record or an explicit human receipt; allocations cannot exceed a balance | invoicing suite |
| Over-credit | `issueCreditNote` caps at the invoiced amount, then refuses `FULLY_CREDITED` | invoicing suite |
| Tax invented | unknown tax key ⇒ invoice rejected (`TAX_RULE_MISSING`); rules are dated rows, defaults marked `verified: false` | tax suites |

## 6. eTIMS and statutory claims

| Threat | Control | Evidence |
| --- | --- | --- |
| Product claims KRA compliance it does not have | `ETIMS_SOLUTIONS` marks every route's real status; `complianceCentreSummary` hard-codes `submissionEnabled: false` | compliance code + eTIMS suite |
| Fake acceptance | `assertAuthoritativeAcceptance` requires **both** a control number and `responseSource === "KRA_ETIMS"`; anything else becomes `UNCERTAIN` | eTIMS suite (18) |
| Resubmitting after a timeout (duplicate fiscal document) | thrown transport error ⇒ `UNCERTAIN`; the state machine has no `UNCERTAIN → SUBMITTING` edge | eTIMS suite |
| A half-configured deployment writing fiscal states | `etimsSubmissionEnabled` needs the flag **and** an adapter key; no certified adapter ships | eTIMS suite |
| Inventing a registration fee | `SENDER_ID_FEES` carries `amountCents: 0` and a note that the provider may charge | sender-ID suite |

## 7. Audit, export and data protection

| Control | Implementation |
| --- | --- |
| Privileged actions audited | role changes, approvals, dispatches, order status, journal posting, eTIMS attempts, denials |
| Audit write failure does not break the operation | `logErpAudit` never throws |
| Export is tenant-scoped and rate limited | `EXPORT_DATA` permission, 3/minute per business, `Content-Disposition: attachment`, capped audit rows (2,000) |
| Export includes personal data deliberately | It is the customer's own data; nothing is emailed anywhere automatically |
| Consent is evidenced, not assumed | `MsgConsentRecord` stores source, wording version and timestamp |

## 8. Findings summary

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-1 | Medium | In-process rate limiter bounds abuse per instance, not globally | Accepted for launch; revisit before paid traffic |
| F-2 | Medium | Tenancy enforced in application code, no row-level security | Accepted; add RLS before multi-tenant production |
| F-3 | Low | Queue is in-database with request-driven claiming; a stalled request delays a batch rather than losing it | Accepted; no data loss, throughput ceiling documented |
| F-4 | Unknown | Behaviour under real provider load, real KRA responses and real M-PESA callbacks | **NOT TESTED** — no credentials, no database, no live traffic in this environment |
| F-5 | Low | `lib/db.ts` offline fallback is an explicit object; a missing model is a runtime 500 tsc cannot see | Mitigated by a test that asserts all 38 models are stubbed |
| F-6 | Info | Branded alphanumeric Sender IDs are outbound-only; replies need a reply-capable number | Documented in the UI and in `replyCapability`; not a defect but a promise the product must not break |

## 9. What this review does not cover

* No penetration test, no external audit, no dependency CVE scan was run in this environment
  (`npm audit` needs the registry; the sandbox has a limited proxy).
* No production traffic, no load test, no soak test.
* No review of the pre-existing platform code beyond the surfaces the ERP touches.
* No assessment of provider-side security (Meta, Safaricom, KRA, Neon, Vercel).
