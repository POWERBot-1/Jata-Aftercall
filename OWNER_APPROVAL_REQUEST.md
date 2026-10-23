# E-25 owner approval request — decisions A–G

**Prepared:** 2026-10-19 (Africa/Nairobi) · **Current release state:** **NOT READY — ENVIRONMENTAL VERIFICATION BLOCKED**

This request asks for seven separate written decisions; it is **not** approval to install, spend, connect, migrate, activate, send, deploy, or change application behavior. No decision is inferred from code or migration comments, test names, a historical release report, or a draft customer notice. Current records still leave owner approval pending. The source and migration comments calling the sale implementation “approved policy C” are not owner-approval evidence; decision G explicitly asks the owner to confirm or replace that policy.

The 316 stable IDs remain **75 PASS / 0 FAIL / 0 PARTIAL / 122 BLOCKED / 119 NOT TESTED / 0 NOT APPLICABLE**; all 241 open IDs remain in `REMAINING_BLOCKERS.md`. E-23 is still the last successful application suite/typecheck/lint/build record. E-25 confirmed `node_modules` is absent, syntax-checked the two preflight scripts (exit 0), and reran the no-target browser and migration guards (each exit 2 before launch/connection). **No application suite, database/browser/SMTP/storage check, audit, installation, migration, or provider operation ran in E-25.** No requirement status changed.

## A — Isolated verification environment and spend cap

**Decision requested.** Select one:
1. **Supply existing, no-incremental-cost local resources (recommended):** a disposable loopback-only PostgreSQL target containing synthetic data, matching Prisma **5.22.0** Client and query/schema/migration engines, and a compatible real Chrome/Chromium browser runner.
2. **Authorize installations/provisioning:** specify an explicit hard **one-time maximum** and **monthly recurring maximum**, in a named currency, for any package/engine/browser/system-tool installation and infrastructure. If either cap is zero, do not acquire that item. `npm ci --ignore-scripts --no-audit --fund=false` installs locked JS dependencies only; it does not guarantee the matching Prisma engines. Prior native-engine download failed TLS; do not retry without separate approval.
3. **Defer:** provide no target/tools and keep the environmental gate blocked (the safe default until resources are explicitly supplied/approved).

**Recommendation / boundaries.** Prefer already-available local tools and **PostgreSQL 16** for the documented DB/E2E workflow; use the separate guarded migration-harness contract only as its own separately verified target. Synthetic data only. No production, production-derived, hosted, shared, or customer database; loopback binding only. Never put URLs or credentials in files or logs. A browser result counts only when an actual compatible browser launches; intercepted UI is not backend acceptance.

**Implications.** A disposable target can be destructively written/cleaned by migrations and E2E fixtures, so identity proof and synthetic-only data are mandatory. A wrong/shared target risks customer data and integrity. Missing matching engines or a fake browser would produce misleading results. No production or customer action is needed.

**Cost.** $0 if the owner supplies existing local resources. Otherwise installation, browser, infrastructure and recurring service costs are **unknown**; state both caps explicitly. No spend or installation is authorized until then.

**Affected gates/IDs.** `RB-02`, `RB-03`, `RB-04`; `A-141`, `A-177`, `A-184`, plus the DB/browser-dependent route and journey clusters itemized in `REMAINING_BLOCKERS.md` (including Studio, storefront, POS, recovery and responsive/accessibility rows). This decision alone closes no ID.

**Work without approval.** Static/source review, ID reconciliation and fail-closed no-target checks only. No package/system install, browser download, provisioning, DB target, or migration.

**Exact next verification after approval.** First supply/verify the disposable target; do not migrate before identity review:
```sh
psql -X -v ON_ERROR_STOP=1 --dbname "$DATABASE_URL" -c "SELECT current_database(), current_user, host(inet_server_addr()) AS server, current_setting('data_directory') AS data_directory, version();"
```
Confirm it matches the owner-approved local target and synthetic-only boundary. Then, only if installation is separately covered by the stated cap, run `npm ci --ignore-scripts --no-audit --fund=false`; verify `npx prisma -v` reports 5.22.0 and the supplied engines match; run `npx prisma validate` and `npx prisma generate`. After migration review, use the approved disposable URL for `npx prisma migrate deploy`, `npx vitest run tests/prisma`, `npm test`, `npm run test:e2e`, and `npm run test:e2e:pos`. Run `npm run test:db:migrations` separately with its specifically approved `MEDIA_TEST_DATABASE_URL`. Record exits, counts and target type without recording URLs. Browser checks follow DB verification; use `npm run test:browser:password-recovery-ui` for the UI-only check and the guarded authenticated/browser suites for actual journeys.

## B — Isolated non-relaying SMTP and synthetic recipients

**Decision requested.** Approve only a **local, loopback-bound, TLS-verified, non-relaying SMTP capture sink** with outbound delivery disabled and synthetic `.test` recipients (for example, `owner@example.test`), or defer SMTP transport tests. No real address, production relay, sender activation, or email to a customer is within this request.

**Recommendation / alternatives.** Use the sink only after A’s disposable DB/browser prerequisites are verified; otherwise keep mock-only tests. The existing mail tests use mocks. This repository has **no real-SMTP integration command today**. A guarded sink harness must first reject non-loopback hosts, non-TLS/invalid certificates, non-synthetic recipients, and any relay-capable target; do not describe a mock test as delivery evidence.

**Implications.** A sink can validate transport and rendered content without contacting a real mailbox. Misconfiguration could disclose reset links or contact information or send real mail, so outbound blocking, TLS verification and synthetic-only recipients are mandatory. Customer, privacy and account effects must be nil.

**Cost.** $0 if an already-available local sink is supplied. Any hosted sink, paid sender, certificate/tool purchase or relay cost is unknown and **not authorized**; no paid relay is an alternative in this request.

**Affected gates/IDs.** `RB-08`; `A-138–A-142`, especially `A-141`. These remain blocked until actual application-DB, browser and sink evidence exists.

**Work without approval.** Keep reviewing mock test coverage; do not configure SMTP or send email. The existing mock-only command, after A’s dependency approval, is:
```sh
npm test -- tests/security/password-reset.test.ts tests/unit/password-reset-email.test.ts tests/security/auth-session-revocation.test.ts tests/security/login-session-version.test.ts
```
This is not a sink/delivery test. After separate sink approval, implement the guarded integration harness first; there is no honest existing command for real-sink verification to run today.

**Exact next action after approval.** Provide the loopback endpoint, trusted test CA if needed, synthetic recipient and proof outbound delivery is disabled, out-of-band only. Run the guarded mock suite above, then the newly added sink-only integration test; record its exact command/exit and captured-message count, with all token/recipient details redacted. Never send to a real mailbox.

## C — Durable-media comparison, budget and legacy remediation

**Decision requested.** Authorize a **non-binding comparison only** before provider selection: compare Vercel Blob, a suitable S3-compatible option (for example AWS S3 or R2), and Cloudinary using current provider terms/prices and this product’s measured workload. The comparison must cover API/runtime compatibility, storage/operations/egress/transformation costs, public versus private access, tenant isolation, draft/customer privacy, quotas, retention/legal deletion, deletion of referenced assets, rollback and legacy-data remediation. Or defer comparison and keep new image writes disabled. **Do not select/activate a provider, create an account/token, install a provider package, upload/backfill, migrate data, or spend** as part of this decision.

**Recommendation / alternatives.** Compare first, select later. Keep the invariant **no binary media in Neon**. The old local price examples are illustrative, inconsistent and not current quotes; no comparable current price, usage volume or budget is verified. After comparison, the owner must name a provider and access design, set per-tenant/global quotas, state one-time and monthly spend ceilings, and separately authorize any account, secret, activation or migration. If no safe budget/access choice is available, defer and retain the fail-closed upload behavior.

For legacy data, choose and document a remediation path before selection: preserve existing reads while inventorying only an owner-approved isolated/sanitized snapshot; then either (i) owner-reviewed replacement/re-upload, or (ii) a dry-run, per-tenant staged backfill with mapping, verification and rollback, with cleanup/deletion separately approved. Specify how drafts, published content, products, revisions/history, orphans and deletion requests are handled. No inventory has been run; existing inline records and arbitrary binary representations are unknown.

**Implications.** Public object URLs can expose drafts to anyone holding a URL; private storage/proxy access changes cost and latency. Tenant-scoped keys, server authorization, upload validation, quotas, and retention/deletion controls are required. Legacy data may remain unreadable/edit-blocking or incur migration/support work; no change may silently break published images. The implementation currently rejects new inline bytes and does not have a durable object adapter/read path.

**Cost.** Comparison-only spend: $0. Current storage/provider costs and legacy volume are **unknown**; request a hard one-time cap and monthly cap before any activation. No price estimate in older documents is a quote.

**Affected gates/IDs.** `RB-01`, `A-078`, `A-080–A-086`, `A-083`, `A-118–A-120`, `A-182`, `A-184`, and `B-012` (among the related open media/product gates). No ID closes from a provider choice alone.

**Work without approval.** Compare source interfaces and controls, refresh public pricing/terms when authorized, refine the count-only inventory query without executing it, and retain the existing fail-closed no-new-binary boundary. No DB query, storage activation or upload.

**Exact next action after approval.** First approve a read-only role and isolated/sanitized snapshot; then, if the required local `psql` tool is already available or separately approved, run:
```sh
psql -X -v ON_ERROR_STOP=1 --dbname "$LEGACY_MEDIA_READONLY_DATABASE_URL" --file LEGACY_MEDIA_INVENTORY_READONLY.sql
```
This query is count-only, unvalidated in PostgreSQL and has stated detection limits; preserve aggregate results only. After separate provider/budget/access approval and adapter implementation, run the existing isolated/mock regressions:
```sh
npm test -- tests/integration/media-route-upload.test.ts tests/integration/mobile-upload-pipeline.test.ts tests/unit/storage-provider.test.ts tests/unit/media-persistence-policy.test.ts
```
A real upload/read/delete/tenant/rollback test requires a later, separate provider activation approval. Never put binary media in Neon.

## D — POS paid entitlement versus publication readiness

**Decision requested.** Decide whether customer-facing POS status must distinguish payment entitlement from publication readiness, and explicitly say whether sales may continue while a paid configuration has no new published snapshot.

**Current behavior.** If legacy inline media prevents provisioning a new snapshot, confirmed payment/subscription and `LIVE` may be preserved, no new published version/snapshot is written, the draft is retained, readiness is false, `effectiveConfiguration` may fall back to the draft, and POS access is gated by entitlement rather than readiness. This is mocked/fake-DB evidence, not Prisma evidence.

**Recommendation / alternatives.** Safest option: keep settlement, entitlement and sales access unchanged; present the two states separately, e.g. **“Paid — setup/publish required”** until a valid snapshot exists. Alternative: block sales until owner-reviewed publication/remediation, but that is a separate commercial choice with explicit customer remediation and rollback. A third option is to defer the presentation decision and leave current behavior unchanged; do not silently relabel `LIVE` as publication readiness.

**Implications.** Conflating entitlement with readiness may mislead owners/cashiers about whether setup was published; allowing draft fallback can affect what operators see. Blocking a paid business may interrupt legitimate sales, settlement expectations and customer service. No payment, settlement, inventory, authorization or entitlement change is proposed.

**Cost.** $0 for a written choice; implementation, support and verification cost are unknown until scope is selected. No new service spend is required for a policy decision.

**Affected gates/IDs.** `RB-17`; `A-120`, `A-122–A-128`, and DB invariant gate `A-184`. Preserve payment/tenant/role/idempotency controls.

**Work without approval.** Keep inspecting mocked/source evidence; no status copy, `LIVE`, readiness, sales, settlement or entitlement change.

**Exact next verification after approval.** For a presentation-only decision, run after dependencies are approved:
```sh
npm test -- tests/integration/pos-api-routes.test.ts tests/unit/pos-entitlement.test.ts tests/unit/repair-guards.test.ts
```
Then, after A, run the approved disposable-DB POS journey (`npm run test:e2e:pos`) and record whether its DB/provider interactions are real or mocked. Do not make a real sale/payment/refund.

## E — Caller-email fallback

**Decision requested.** Confirm whether an order’s valid stored email may continue to be used first, with a syntactically valid caller-provided email as fallback when the stored email is absent/invalid, or specify a stricter alternative (require stored order email, or collect and persist a customer-confirmed address before payment initiation). State what the customer is told and whether mailbox verification is required.

**Current behavior.** Order-payment initiation checks a tenant-scoped pending/unpaid order and derives amount from that order; it prefers a syntactically valid stored order email, otherwise accepts a syntactically valid caller email. The fallback is not mailbox-verified or necessarily consented to, and does not update the order email. Booking/retry paths can synthesize `@customer.jata.local` placeholders. These facts do not weaken server-derived amount, tenant, payment-status, signature/reference/amount/currency, idempotency or settlement checks.

**Recommendation / alternatives.** Preserve the current behavior until the owner chooses; do not silently switch recipients, require verification, alter customer copy, or change AI payment-request dispatch. If retained, consider a separately approved disclosure/confirmation of the recipient and its source. A stricter stored/confirmed-email requirement can prevent misdirected provider correspondence but may block checkout or require an account/contact journey.

**Implications.** A typo or caller-controlled address may receive provider correspondence/receipts, differ from the order contact or expose contact data to a provider without proof of mailbox ownership. Tightening policy can affect conversion and recovery for customers with missing legacy emails. Amount, order and tenant authority remain server-side.

**Cost.** $0 for the decision. Any verification, persistence, notification, privacy/legal or UX work has unknown cost until specified; no provider/email spend is authorized.

**Affected gates/IDs.** `RB-12`; related payment/account acceptance includes `A-008`, `A-131–A-133`, and `A-183–A-185`. `A-184` remains a separate DB verification gate. A decision does not close checkout, payment or account-journey acceptance.

**Work without approval.** Preserve source behavior and mock tests; do not change the address, send payment/email, or add AI payment dispatch.

**Exact next verification after approval.** Run the focused mocked regressions:
```sh
npm test -- tests/unit/ai-payment-request-integrity.test.ts tests/integration/storefront-checkout.test.ts tests/integration/storefront-parity.test.ts tests/integration/payments-journey.test.ts
```
Then run the applicable Prisma/payment journey only against A’s verified disposable DB. Record mock versus Prisma/provider scope explicitly; no real payment or refund.

## F — `braces@3.0.3` advisory risk choice

**Decision requested.** Choose either (1) **do not accept** the unresolved audit risk and hold release until a compatible upstream fix is available, or (2) make an explicit, time-bounded residual-risk acceptance naming the accountable owner, expiry/review date and mitigations. A separate option is to authorize compatibility investigation only; that does not authorize a downgrade, override or suppression.

**Exact finding.** GitHub advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): `braces` affected through **3.0.3**; deeply nested patterns can cause stack-exhaustion denial of service, **CWE-674, High, CVSS 7.5** (`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`). Current lockfile path is development-only: `eslint-config-next@16.4.0 → @next/eslint-plugin-next@16.4.0 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`. The five high audit entries are propagated through this chain; E-24 production-only audit had 0 findings, while the full audit exited 1. Registry review found no compatible patch; the suggested forced `eslint-config-next@14.2.35` downgrade conflicts with Next 16 / ESLint 9.

**Recommendation / alternatives.** Do not call the finding fixed or accept it by default. Prefer waiting for and applying the smallest compatible upstream patch. If the owner elects to accept residual risk for a limited period, keep the dependency dev-only, run lint/build/CI in isolated time/resource-limited jobs on trusted sources, do not feed attacker-controlled nested glob patterns to the parser, monitor upstream and set a firm expiry. These mitigations reduce exposure but do **not** remove the stack-exhaustion risk. No audit suppression, forced downgrade or weakened test/lint gate.

**Implications.** The reviewed path is tooling rather than an application runtime dependency; the identified impact is availability of lint/build/CI if crafted nested patterns reach it. No app runtime path was found in this review, which is not a claim of zero future exploitability. Acceptance leaves a high-severity residual CI/build risk and may remain unacceptable to release reviewers.

**Cost.** $0 for a written choice. Remediation engineering/CI isolation cost is unknown; no paid runner or service is authorized.

**Affected gates/IDs.** `RB-13` and verification gate `A-177`; full audit remains open until a compatible fix or explicit review disposition, and the audit itself will still report the finding after risk acceptance.

**Work without approval.** Preserve the dependency tree and audit output; do not suppress, force, downgrade, override, or change dependencies. No fresh audit was run in E-25.

**Exact next verification after approval.** Once dependencies are available, record both audit exits:
```sh
npm audit --omit=dev --json
npm audit --json
```
After a compatible fix (or any separately authorized dependency change), run `npm run lint`, `npm test`, `npm run typecheck`, `npm run build`, and both audits again. If residual risk is accepted, record the owner/expiry/mitigations and keep the audit result visibly open; acceptance is not a clean audit.

## G — Keep framework baseline and sale-price policy separate from environment

Missing dependencies, engines, database, browser or SMTP are **environmental blockers**, not evidence for a framework version or commercial pricing policy. Decide G1 and G2 independently of A–F and each other.

### G1 — Framework baseline (`A-180`)

**Decision requested.** Source A says preserve Next.js **14.2.15**, React, Prisma, Neon and Vercel unless separately reviewed/authorized; this repository’s lockfile currently uses Next.js **16.4.0**, React **18.3.1**, Prisma **5.22.0**, Neon and Vercel. Confirm that the literal Next.js 14.2.15 baseline is binding, confirm the current Next.js 16.4.0 baseline is intended, or defer pending a compatibility review.

**Recommendation / alternatives.** Keep the existing architecture and dependencies unchanged until the owner clarifies the baseline. Do not silently downgrade or upgrade. If 14.2.15 is binding, first authorize a scoped compatibility/rollback plan; no version change is included in this request.

**Implications.** A major framework move can affect React compatibility, routes, authentication, build/deployment, Prisma integration and customer availability. No database or customer data change is inherently required, but regressions could affect every route. Engineering and verification cost are unknown.

**Affected gates/IDs.** `RB-09`, `A-180`; the broader current-head verification gate remains `A-177`. A version decision does not close environmental or UX acceptance.

**Work without approval.** Retain current pinned versions and architecture; no package edits.

**Exact next action after approval.** Record the target version and any separately authorized migration plan first. If dependencies are authorized/restored, verify `npx next --version`, then run `npm run typecheck`, `npm test`, `npm run lint`, and the documented offline-safe `npm run build` on the reviewed tree; if the target changes, include compatibility and full regression evidence before considering any status change.

### G2 — Sale-price policy (`RB-11`)

**Current source implementation (not proof of owner approval).** `lib/sale-pricing.ts` is the shared pricing helper. Catalogue/product sales apply only for the explicit start-inclusive/end-exclusive interval **`startsAt <= now < endsAt`**; stored times are UTC, zoneless owner-entered times use Africa/Nairobi (UTC+03:00). Outside the interval, with no/invalid window, or when the sale is not below list price, the base/list price applies. A product variant with its own price is not discounted by a product-level sale. A quantity/bulk rule is applied after the effective price, only if it lowers the price; it does not compound discounts. If multiple rules match, the current helper selects the **first matching rule in configured order** (the sanitizer preserves order). Storefront checkout, pre-orders, member cart, AI/conversational order/quote paths and POS reference the shared window rule. POS still has its own catalogue, permissioned price overrides and separate wholesale threshold/rules; it is not otherwise identical to catalogue checkout. Product/POS sale-window schema fields and two additive migrations exist in source; **no application database migration ran**. Existing tests cover boundaries/channel parity but were not run in E-25. A customer notice draft exists; delivery is not evidenced.

**Decision requested.** Either explicitly confirm this exact current behavior, including quantity-rule precedence and POS scope, or specify the alternative rule and affected channels/transition. “Keep as implemented” is not a decision until the owner confirms it. The earlier release note’s “ratified” wording and code/migration/test comments are not treated as owner approval.

**Recommendation / alternatives.** Safest is to confirm the current bounded-window rule if that is the intended business policy, while preserving the existing POS authorization/wholesale behavior and documenting first-match quantity precedence. Alternatively specify a different rule (including windows, quantity thresholds/overlap precedence, variants, POS, effective time, existing sales and customer notice). If no decision is made, do not change code or customer-facing prices, do not claim policy approval, and keep the owner gate open.

**Implications.** Different rules can change prices charged or quoted across storefront, pre-order, member and AI channels and can affect customer commitments, receipts, promotions, analytics and support. Changing POS rules may alter cashier totals; POS override/authorization, payment settlement, entitlement, inventory, idempotency and reconciliation must remain intact. Do not change caller-email, payment/settlement, POS readiness, or JATA Qi/TANYA AI/AI payment dispatch as part of this decision.

**Cost.** $0 for policy clarification. Any implementation, migration, customer notice or DB/browser verification cost is unknown until the owner chooses; both sale-window migrations remain unapplied.

**Affected gates/IDs.** Primary blocker `RB-11`; the existing matrix cross-references `A-129`, `A-130`, `A-132`, and `A-134–A-137` for related pricing/checkout/transaction reporting acceptance. Those rows have broader acceptance checks and a policy decision alone does not close them. `A-184` remains the database-invariant gate.

**Work without approval.** Keep current behavior unchanged; correct stale documentation/approval wording; inspect existing tests and source only. No sale-policy code changes or migrations.

**Exact next verification after approval.** If current behavior is confirmed, run after A’s dependency/DB gates:
```sh
npm test -- tests/unit/sale-pricing.test.ts tests/unit/sale-channels.test.ts tests/integration/storefront-parity.test.ts tests/integration/preorder-price-integrity.test.ts
```
Then verify migrations and applicable Prisma checkout tests on the approved disposable DB using the ordered A procedure; record mocks versus real DB. If an alternative is selected, first obtain separate implementation authorization, add targeted boundary/channel/precedence regressions, and run these same focused tests plus the applicable disposable Prisma suite before any customer-facing release. No real charge/refund or deployment.

## Safe work and release sequence

No additional runtime-code change was justified by the independent review: remaining work is gated by owner policy, missing test infrastructure, or acceptance evidence that cannot safely be inferred from source/mocks. The E-25 source edits only clarify existing behavior and distinguish implementation from owner approval; they do not change pricing or runtime behavior. The 241 open IDs were checked against the matrix and blocker ledger; statuses remain unchanged.

After approvals, follow this order: **verify the isolated synthetic-only DB identity → verify matching Prisma 5.22.0 Client/engines → review/apply migrations and run Prisma integration tests → real browser checks → isolated non-relaying SMTP sink → approved storage and explicit policy implementation/verification → focused and full regression suite, typecheck, lint, build and audits → reconcile all 316 IDs and the 241 open IDs → final release decision.** Record each exact command, exit, counts, evidence source and whether it used mocks, a real local DB/browser/sink, or storage. No deployment is authorized; deployment always needs separate explicit approval.

## Owner response template

Please answer each separately and include limits/conditions rather than a general “yes”:

- **A:** Supply existing isolated resources / authorize installation-provisioning (one-time cap: ___; monthly cap: ___; currency: ___) / defer.
- **B:** Approve loopback non-relaying TLS sink and synthetic `.test` recipients / defer. Confirm outbound delivery is disabled.
- **C:** Approve comparison only / defer. One-time cap: ___; monthly cap for any later provider: ___; legacy remediation preference: ___; no activation/upload/migration/spend until a separate approval.
- **D:** Keep sales available with separate entitlement/readiness presentation / block sales pending a published snapshot (separate commercial authorization and remediation required) / defer.
- **E:** Retain stored-email-first plus caller fallback / require stored or customer-confirmed persisted email / other exact policy: ___. State customer disclosure and verification requirements.
- **F:** Do not accept (hold for compatible patch) / time-bounded risk acceptance (accountable owner: ___; expiry/review date: ___; mitigations: ___) / authorize compatibility investigation only.
- **G1:** Current Next.js 16.4.0 intended / Source A Next.js 14.2.15 binding / defer for compatibility review.
- **G2:** Confirm the exact current sale-window/bulk/POS rule above / specify the alternative rule, effective time and affected channels: ___.

A written answer authorizes only the explicitly selected decision. It does not authorize production/shared-DB access, real payments/email, provider activation, remote Git actions, merge, or deployment.
