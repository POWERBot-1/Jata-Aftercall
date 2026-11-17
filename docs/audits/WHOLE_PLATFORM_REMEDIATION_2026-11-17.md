# Whole-platform remediation — batch 1 (2026-11-17)

**Branch:** `arena/a3de1985-jata-aftercall`, branched from main/Production `09a4aa059b227f8fbb9dbece6faaa0fd32fe91e7`.
**Inputs reconciled:** PR #125 head `ed3d561` (fast-forwarded), PR #117 `eb7d507` (merged), PR #112 `3214fc5` (merged with fixes), and the 2026-11-17 whole-platform assessment (`WHOLE_PLATFORM_ASSESSMENT_AND_REMEDIATION_PLAN_2026-11-17.md`).
**Release verdict: NOT READY.** Nothing here was deployed or merged to `main`. No Production env, DB, DNS, payment credential or customer record was read for mutation or changed. `CONTROL_ROLE_ACCESS_ENABLED` stays `false`, and the 90-cell Control DENY matrix is unchanged.

Status vocabulary follows RELEASE-001. Finding status is PENDING / IN PROGRESS / BLOCKED / IMPLEMENTED / VERIFIED. Evidence is PASS / FAIL / BLOCKED / NOT TESTED. "Local" means this sandbox: no Docker, no Prisma engine download, and Chromium 153 for diagnosis only. Local results are not CI evidence, and CI evidence comes from the exact-head PR run.

## 1. Traceability matrix (finding → root cause → fix → regression test → evidence)

| ID | Pri | Finding / source | Root cause | Fix (commit) | Regression test | Evidence | Status |
|---|---|---|---|---|---|---|---|
| R-OTP-01 | P0 | PG18 `agent-applications-postgres` OTP race assertion failed on PR #125 CI | Under READ COMMITTED, two concurrent correct submissions both read the pre-verification row, so the loser reported a failure instead of `already` | `settled()` re-reads the committed application (`2fbe9aa`) | `tests/unit/agent-phone-verification-race.test.ts` (4) — fails without the fix | Local PASS. PG18 CI pending | IMPLEMENTED |
| R-MAN-01 | P0 | Static step 10 failed: evidence manifest MISMATCH | `PROGRAMME_READINESS.json` was edited after the manifest was generated | Manifest regenerated as the last step. The verifier is unchanged | `scripts/__tests__/verify-evidence-manifest.test.mjs` (existing) | `--check` PASS locally; CI pending | IMPLEMENTED |
| R-CAP-01 | P1 | Motion capture `BLOCKED TimeoutError 12000ms` (route-behaviour-evidence.mjs:205); the 12 constrained rows never ran | (a) The fixture renders **17** targets, but the harness hard-coded 18. (b) Playback is visibility-gated, and viewport-relative sections left only 2–5 targets in view, so ≥8 played was impossible. (c) The harness counted Web Animations (~2 per element), while the controller bounds concurrent **elements** (`MAX_ACTIVE_REVEALS = 8`) | Dev-only compact layout puts every stress target in view. The harness reads N from the DOM (N > 8 required) and requires exactly 8 started and N−8 queued early, all N complete, and max 8 concurrently animating elements (`51d9d37`). The gate is not weakened | The harness itself is the browser regression | Local Chromium 3/3 PASS: 17 targets, 8 started, 9 queued, maxActive 8, maxAnimations 16. CI pending | IMPLEMENTED |
| R-WS-01 | P1 | **New, found by inspecting rendered pixels:** editorial and cardless-immersive section headings invisible on dark themes (measured 1.1:1 on Graphite) at all 6 viewports, motion and reduced | `276756e` hard-coded `rgb(26 26 26)` ink, assuming those sections paint on white. They are transparent and paint on `--eb-bg` | Use `var(--eb-heading)`, which `themeCss()` already contrast-corrects against `--eb-bg` (`ab4d905`) | `tests/unit/storefront-contrast-and-specificity.test.ts`: token used, no fixed ink, and every theme (light and dark) clears AA. Fails without the fix (2) | Local Chromium sweep: 20 families × 6 viewports × motion/reduced = 240 renders. 30 flagged before the fix (all this defect), 0 after for the affected families | IMPLEMENTED |
| R-MJ-01 | P1 | #115: MJENGO settlement used nonexistent `Payment.planKey`; storage shared with ERP | See #112 | #112's isolated MJENGO/ERP PRO tables (merge `b0cd8dc`) | `mjengo-settlement` (19), `mjengo-storage-isolation`, `mjengo-feature-flag` | Local PASS. DB CI pending | IMPLEMENTED |
| R-MJ-02 | P0 | #112 migration `20261112090000` would sort before 15 applied production migrations | Timestamp predates the applied history | Renamed to `20261202000000_mjengo_isolated_entitlements` (after #116's n8n migrations). Plain DDL, so a mismatched existing table fails the deploy instead of being skipped (`b0cd8dc`) | `repair-guards`, `mjengo-storage-isolation` | Local PASS. PG18 rehearsal pending | IMPLEMENTED |
| R-MJ-03 | P1 | Journey (a): `/login?next=/dashboard/mjengo` dropped the destination | Login used a two-entry allowlist without MJENGO; register ignored `next` | `lib/post-auth-destination.ts` exact-token allowlist with open-redirect protection, carried across login⇄register (`713f750`). Repeated `next` refused (`6b45b45`) | `mjengo-customer-journey` (14), `tests/security/agent-login-redirect` | Local PASS | IMPLEMENTED |
| R-MJ-04 | P1 | Journey (b): NONE/CANCELLED/EXPIRED got 403, a dead end because checkout is offered only on 402 | Denial status ignored `nextAction` | `mjengoDenialStatus`: pay/renew/setup → 402; SUSPENDED/pending → 403, so no second checkout (`b75da0a`) | `mjengo-customer-journey`, `mjengo-branding-and-journal` | Local PASS | IMPLEMENTED |
| R-MJ-05 | P1 | Journey (c): every business reported as "configured" | `findUnique(...).then(() => true)` is true even when the row is `null` | `hasMjengoConfiguration` returns `Boolean(row)` and fails closed (`d982863`) | `mjengo-configured-lifecycle` (5) — 3 fail without the fix | Local PASS | IMPLEMENTED |
| R-MJ-06 | P1 | Journey (d): multi-business picker showed raw ids | Rendered ids only | Tenant-scoped `findMany` of the owner's businesses; names shown (`713f750`) | `mjengo-customer-journey` source check | Local PASS | IMPLEMENTED |
| R-MJ-07 | P0 | Journey (e): journal/branding APIs checked ownership only, not entitlement | Ownership was treated as entitlement | `assertMjengoEntitled` after the ownership check on journal POST/GET and branding POST (`b75da0a`) | `mjengo-branding-and-journal` (+6) | Local PASS | IMPLEMENTED |
| R-DEP-01 | P0 | Audit: 7 moderate + 11 high (main) | `next` advisory; old typescript-eslint pinned minimatch <11 through a forced override | next 16.4.6 (from #125); typescript-eslint 8.73.0 → minimatch 11.0.9 natively; forced `minimatch@>=7 <11` override **removed** (`e08e585`) | `npm audit` in release-validation | Full tree: **0 moderate, 16 high**. `--omit=dev`: **0** | IMPLEMENTED |
| R-DEP-02 | P0 | 16 high remain: GHSA-fc5q-39xc-vjpf picomatch ≤4.0.7 ReDoS | No upstream patch (`first_patched: null`; latest 4.0.7; upstream fix PRs #238/#246 unmerged). Dev/build-only paths | No unsafe override, downgrade or suppression | Release-validation reports the full audit; the production gate is `--omit=dev` | BLOCKED (upstream) | BLOCKED |

## 2. Security and dependency audit (deliverable 4)

- Production dependency audit (`npm audit --omit=dev`): **0 vulnerabilities** on the merged tree with this batch's lockfile.
- Full tree: **16 high**. All are the single advisory GHSA-fc5q-39xc-vjpf (picomatch), reached only through build/dev tooling. There is no patched version, so the finding is **BLOCKED (upstream)** and is not suppressed. Owner action: none until upstream releases. Re-audit when picomatch > 4.0.7 or 2.3.3 is published.
- Open-redirect hardening: post-auth destinations accept exact tokens only. Arbitrary URLs, protocol-relative URLs, traversal, query-suffixed values, `__proto__`/`constructor`, and repeated parameters all resolve to `/dashboard`.
- Not done in this batch (still P0 and open): the full two-tenant authorization matrix on PostgreSQL, the Paystack Preview sandbox suite (signature, idempotency, concurrency, out-of-order, refund, subscription, POS entitlement, reconciliation), and ledger idempotency proof. PR #125 recorded a sandbox journey PASS; the remaining cases are NOT TESTED.

## 3. Product journey (deliverable 6) — MJENGO OS

Public page `/products/mjengo-os` → CTA `/dashboard/mjengo` → unauthenticated `/login?next=mjengo` → sign-in or registration preserves the destination → picker by business name → `[businessId]` gate:

- no entitlement → 402, and checkout is offered at KES 2,000 / 30 days;
- PAID but pending, or SUSPENDED → 403, with no second checkout;
- entitled → workspace;
- APIs enforce the same entitlement.

Pricing is unchanged: Business Page KES 149/30d and KES 999/365d, Business POS KES 499/30d, MJENGO OS KES 2,000/30d. MJENGO keeps its own identity and tables and is not merged with POS. Evidence: unit and source tests PASS locally. A browser journey with a real session and DB is **NOT TESTED** in this batch.

## 4. Website Studio visual acceptance (deliverable 8)

The local Chromium sweep covered `/dev/motion-preview` for all 20 template families × {320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768} × {motion, reduced}. Screenshots were inspected, not just counted. Checks were horizontal overflow, h1 clipping, h1/action-bar overlap, heading contrast < 3:1, and render mode.

- **Found:** R-WS-01 (above).
- **Expected and not a defect:** `minimal` renders `lite`, because the owner chose lite for that family (`owner-lite`).
- Limits: the fixture uses a single dark theme. Light themes are covered by the token-level test across every theme, not by pixels. This is local diagnosis only; CI artifacts are the acceptance evidence.

## 5. Not covered in this batch (remain open; see the register)

PG18/Neon staging migration of this head; backup/restore rehearsal against RPO ≤15 min / RTO ≤4 h (PG18 PASS on #125, Neon PITR NOT TESTED); R2 durability; DNS/TLS/mail (BLOCKED, owner); suspected test-mode production Paystack key (BLOCKED, owner, read-only); admin reporting (MRR/ARR/gross/refunds/net) acceptance; commission accrual (disabled, with rates NOT CONFIGURED pending the owner's numeric policy); the remaining 16-item test programme; and modules beyond MJENGO, Website Studio, motion and agents.

## 6. External blockers and owner actions (deliverable 11)

1. picomatch upstream patch (GHSA-fc5q-39xc-vjpf): wait or replace the parent tooling. No override.
2. Production Paystack key mode: owner to confirm the live key through read-only inspection.
3. DNS/TLS/mail for `jataaftercall.co.ke`: owner to obtain authoritative records from the registrar or host.
4. Commission policy: owner to supply numeric rates and payout terms before accrual or payout is enabled.
5. Release authorization: separate and explicit. This branch must not be merged or deployed to Production without it.
