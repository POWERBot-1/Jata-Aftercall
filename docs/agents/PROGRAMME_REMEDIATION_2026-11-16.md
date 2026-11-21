# Programme remediation — 2026-11-16

**Branch:** `remediation/programme-readiness-2026-11-16`
**Base:** `main` at `09a4aa059b227f8fbb9dbece6faaa0fd32fe91e7`
**Status:** IN PROGRESS — no readiness record is promoted to PASS.

## Scope and guardrails

This work addresses the owner-dependent blockers without inventing policy or changing production. No merge, deployment, production database access, DNS change, Vercel environment change, live payment, commission accrual, payout, provider activation or paid resource is performed by this branch.

## 1. Admin console — ADMIN-005 / ADMIN-010

- The current owner-approved access policy is **DENY for all 90 role/capability combinations** (decision dated 2026-11-01). This is an actual policy decision, not an absent default. It does not authorize an operator, any ALLOW cell, a role grant or provisioning.
- The independent operational gate remains `CONTROL_ROLE_ACCESS_ENABLED=false`. The existing console can display the denial policy and refuses protected reads/actions before grant lookup.
- The console already withholds financial amounts, payment references and owner identity/contact fields. This remains the correct fail-closed behavior while the owner has not approved a PII/financial display policy.
- MRR/ARR, payment, subscription, AI-usage, job and incident definitions are not sufficiently specified to calculate or display as authoritative metrics. Do not derive MRR from a plan price or count a payment as recurring revenue without an approved accounting definition.
- **Still BLOCKED:** owner must define the fields and metrics that each authorized operator may see, the authoritative source and calculation rules, and any future role/capability ALLOW plus the grant-provisioning authority. No operator has been provisioned.

## 2. Agent commissions — ADMIN-006 / ADMIN-013

- Existing foundations include a pure commission evaluator, immutable ledger storage and read-only reconciliation primitives. They do not constitute a verified payment-to-commission lifecycle.
- The evaluator is deliberately non-writing and rejects missing/unapproved policy. It now also rejects an `APPROVED`-looking snapshot if any governance dimension is absent: attribution precedence/window and renewal/correction treatment, tax/discount/fee treatment, recurrence, refund/chargeback/dispute reversals, caps, payout schedule/method/hold, hierarchy and retention/legal-hold. Test values are explicit `TEST_ONLY` placeholders, not JATA terms.
- The repository's owner-decision matrix still lacks exact rates/basis, qualifying verified events, attribution precedence/window, recurrence/eligibility, tax/discount/refund/chargeback treatment, caps/holds, payout schedule/method and hierarchy compensation.
- **Still BLOCKED:** no approved policy is present in the accessible project record. This branch does not invent one, enable an accrual writer, reconcile real payments, or initiate payouts. The new completeness guard is not proof of an approved policy or an end-to-end commission lifecycle. Policy-independent synthetic integration work can proceed only where it cannot create payable entries or imply real payment verification.

## 3. Website Studio motion — MOTION-007 / MOTION-008 / MOTION-017

- The complete owner-provided advanced fintech motion specification is present verbatim in `docs/ADMIN_BUILDING_INSTRUCTIONS.md §032`. The earlier claim that this specification is unavailable is stale and should not be used as the current blocker.
- The owner explicitly named `a28c1a46101ac90bbf28d374b4986b689196de8d` as the genuine pre-motion source revision in §042. The commit is present in repository history. This resolves the missing-reference question; it does **not** prove a reproduced screenshot baseline.
- Added a historical-baseline CI job that checks out the owner-named revision, sanitizes its legacy fixture seed (no fixed admin/demo password and no synthetic PAID payment), then uses the current capture harness in baseline mode. The job is not yet accepted until it completes and yields the expected captures.
- The acceptance still requires identical route, fixture data, browser, viewport and motion preference on the historical and candidate builds; actual before/after captures/recordings; all supported families and applicable generation/preview/publish routes; queue/re-entry/cleanup; reduced/disabled behavior; and independent visual review.
- Existing exact-head Motion and E2E CI results are useful but do not prove the historical visual comparison or all Studio acceptance. No customer website is republished by this work.
- **Still BLOCKED:** execute the same-fixture historical baseline harness and full remaining browser matrix; preserve the owner's existing visual design and each generated site's own brand.

## 4. Recovery — ADMIN-014

- Added `scripts/ci/rehearse-disposable-backup-restore.sh` and integrated its job into the existing `.github/workflows/candidate-rehearsal.yml` so the exact-head pull-request workflow can execute it without waiting for a new workflow to reach the default branch.
- The new workflow is designed to create a synthetic database on a disposable PostgreSQL 18 service, apply committed migrations, seed synthetic records, create a full custom-format logical backup, restore into a separate scratch database, compare schema dumps, compare row counts for every user table and compare the Prisma migration ledger.
- The script refuses non-loopback hosts and refuses source database names other than `jata_recovery`; it never accepts a production URL. The workflow uses a PostgreSQL 18 client image to avoid client/server major-version mismatch.
- **First exact-head attempt:** the integrated job completed migrations, seed, dump and restore, then failed the schema-dump comparison. It did not reach row-count or ledger comparison and is not a PASS. The comparison now ignores PostgreSQL dump comments/random guard tokens and emits the diff on failure; an exact-head rerun is required.
- **Still BLOCKED after that run:** Neon provider-side restore/PITR, snapshot inventory, RPO/RTO and recovery from an actual provider snapshot require separate read-only Neon Console access and owner acceptance. A disposable container is not Neon.

## 5. Production checks — ADMIN-009 / RELEASE-001

- Read-only Vercel project inspection confirms both `jataaftercall.co.ke` and `www.jataaftercall.co.ke` are attached and verified. Apex DNS metadata reports external HostAfrica nameservers (`ns1.host-ww.net`, `ns2.host-ww.net`), A values `64.29.17.1` and `216.198.79.1`, no conflicts and `misconfigured=false`. The www record reports CNAME `2da49677b2414cfd.vercel-dns-017.com.`, no conflicts and `misconfigured=false`. Neither project domain has a Vercel redirect target configured. Full details: `docs/evidence/programme-remediation-2026-11-16/VERCEL-DOMAIN-CONFIG.md`.
- The 2026-11-10 remediation report records read-only HTTP checks: apex and www serve the product with matching title/canonical links, and `/control` redirects to sign-in on the apex and Vercel infrastructure hostname.
- That report also records the limitation: direct TLS inspection from this environment fails with `SSL_ERROR_SYSCALL`; proxy fetches do not replace independent TLS/HSTS/cookie inspection. HOSTAFRICA's authoritative DNS/mail-zone export and delivery confirmation remain an owner/operator dependency.
- No DNS, domain, Vercel environment, email, Paystack or production setting is changed here.
- **Still BLOCKED:** independent TLS certificate/cipher, HSTS and cookie-attribute inspection; authoritative HOSTAFRICA DNS/mail-zone evidence and SPF/DKIM/DMARC verification; and separately authorized P0 payment/domain actions. Vercel configuration metadata is not a substitute for those checks.

## Current disposition

| Area | Engineering action in this branch | Status |
|---|---|---|
| Admin console policy | Preserve all-DENY policy and withhold unapproved financial/PII fields | BLOCKED on owner policy; no grant |
| Agent commissions | Preserve non-writing evaluator and no-accrual boundary | BLOCKED on exact commission terms and provider verification scope |
| Website Studio motion | Correct stale blocker: owner specification and historical source revision are available | BLOCKED on historical reproduction and complete browser evidence |
| Recovery | Add disposable PostgreSQL 18 logical backup/restore workflow | NOT TESTED until CI runs; Neon PITR remains BLOCKED |
| Production checks | Preserve existing read-only evidence and explicit limits | BLOCKED on authorized inspection and provider/owner evidence |

The programme-completeness and release gates remain unchanged and must continue to fail while mandatory criteria are unresolved.
