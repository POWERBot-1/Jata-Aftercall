# JATA AFTERCALL — Merged PR Audit & Controlled Production Deployment

**Audit date:** 2026-10-25 (UTC)
**Repository:** POWERBot-1/Jata-Aftercall (public, default branch `main`)
**Production URL:** https://jata-aftercall.vercel.app
**Vercel project:** `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`, team `team_azd5tt6fZ2mt1v6Op6s5iJHv`)
**Executed on branch:** `arena/ac08c99a-jata-aftercall` (read-only audit; no merge, no history rewrite, no schema change)

---

## 1. Headline result

| Fact | Value |
|---|---|
| `main` HEAD | `420d2af15257aa3d878116b1745205cb79ff2b20` |
| Promoted production deployment | `dpl_7fc6dbwKqCjvpG6tPzg2YnYdtttK` |
| Production deployment commit SHA | `420d2af15257aa3d878116b1745205cb79ff2b20` |
| **SHA match** | **Exact — production is at `main` HEAD** |
| Merged PRs inspected | 48 (all merged PRs in the repository) |
| Merged PRs **absent** from production | **0** |

**No eligible deployment exists. Per the execution rule, I created no new
deployment** — re-deploying `main` would produce a byte-identical duplicate of the
build already promoted at 11:28:55Z.

---

## 2. Phase 1 — Verified state

### 2.1 GitHub `main`

```
$ git rev-parse origin/main
420d2af15257aa3d878116b1745205cb79ff2b20
$ git log -1 --format='%H %cI %s' origin/main
420d2af... 2026-10-25T04:27:39-07:00 Merge pull request #58 from POWERBot-1/arena/44f2d980-jata-aftercall
```

The local clone was shallow (depth 1) on arrival; `git fetch --unshallow` was run so
ancestry was verified against the real 434-commit history, not a truncated one.

### 2.2 Vercel production deployment

| Field | Value |
|---|---|
| Deployment ID | `dpl_7fc6dbwKqCjvpG6tPzg2YnYdtttK` |
| URL | `jata-aftercall-mmmq4n3wy-powerbot-1.vercel.app` |
| Aliases | `jata-aftercall.vercel.app`, `jata-aftercall-powerbot-1.vercel.app`, `jata-aftercall-git-main-powerbot-1.vercel.app` |
| State | `READY` |
| Ready substate | `PROMOTED` |
| `buildSkipped` | `false` |
| Git source | `ref: main`, `sha: 420d2af15257aa3d878116b1745205cb79ff2b20` |
| Trigger | `git` (GitHub integration), production branch `main` |
| Created | 2026-10-25T11:27:43.888Z (4 s after the merge commit) |
| Ready | 2026-10-25T11:28:55.814Z |
| Alias assigned | 2026-10-25T11:28:56.023Z |
| Previous production deployment | `dpl_GpxJcRUVry5nvBnS4YCAjmdJsQ7g` @ `e8de29d7` (PR #57), ready 2026-10-25T08:57:01.905Z |

### 2.3 Branch protection

Ruleset **`main-protection`** (id `25548981`, `active`, target `branch`, `~DEFAULT_BRANCH`):

- deletion — blocked
- non-fast-forward — blocked
- pull request — required; allowed merge methods `merge`, `squash`, `rebase`; review threads must resolve; `require_extra_approval_for_unattributed_changes` on
- required status checks (`strict`), all preserved and untouched by this audit:
  - `Journey against a real database`
  - `Migration target guard`
  - `Release gate (aggregate)`

**No rule was bypassed, edited, or disabled.**

### 2.4 Squash / merge / rebase accounting

Inclusion was proven by ancestry (`git merge-base --is-ancestor <merge-commit> 420d2af`),
not by PR status. Because the production SHA **equals** `main` HEAD, every commit
reachable from `main` — merge commits, squash commits (#40, #48), and the plain
commits inside rebased branches — is by definition part of the deployed tree. The
48 per-PR ancestry checks are corroboration of that property, not a substitute for it.

---

## 3. Phase 1/2 — Per-PR verdict table

Every merged PR below is **PASS**: merged, ancestor of the production SHA, and
covered by a green release gate at that SHA.

| PR | Title | Merged (UTC) | Merge commit | In production 420d2af |
|---:|---|---|---|---|
| #58 | fix(landing): keep the wordmark clear of the header controls on phones | 2026-10-25T11:27:40Z | `420d2af1` | ✅ IN |
| #57 | fix(landing): show all five plans in one pricing grid, POS included | 2026-10-25T08:55:24Z | `e8de29d7` | ✅ IN |
| #56 | fix(landing): align pricing cards, benefit icons and the demo-page mock | 2026-10-25T06:44:32Z | `a04ecb7d` | ✅ IN |
| #55 | Landing redesign: motion-led homepage and demo showcase | 2026-10-24T20:32:28Z | `6e848237` | ✅ IN |
| #54 | fix: remediate PR 49 payment, media, auth, and POS lifecycle | 2026-10-23T21:06:04Z | `cce008df` | ✅ IN |
| #53 | security: patch Next.js advisories | 2026-10-23T03:03:45Z | `ba08f462` | ✅ IN |
| #52 | schema: reconcile six divergences between migrations and schema.prisma | 2026-10-22T23:35:00Z | `ac3af415` | ✅ IN |
| #50 | ci: reproducible release-validation gate (PostgreSQL 18, failure paths, mig… | 2026-10-21T10:18:07Z | `66c4f33a` | ✅ IN |
| #48 | build: Migration Guard v3 with the verified Production target enrolled | 2026-10-18T11:45:20Z | `2575cf46` | ✅ IN |
| #46 | security: fail-closed authorization for publish/unpublish (§5, §15, §46) | 2026-10-16T17:52:24Z | `01314455` | ✅ IN |
| #45 | Verification candidate: payment-settlement revival, hydration #418, depende… | 2026-10-16T17:52:26Z | `9cb5b607` | ✅ IN |
| #43 | Draft: Phase 4 registered recipe layouts (session continuation on arena/8e3… | 2026-10-13T14:40:25Z | `8db6a9e4` | ✅ IN |
| #40 | PR #39 remediation: stock capability, branch isolation, refund integrity, m… | 2026-10-05T17:00:39Z | `9c36bd10` | ✅ IN |
| #38 | Fix STK receipt handling and atomic wallet refunds | 2026-10-05T07:24:07Z | `fcf9fa44` | ✅ IN |
| #37 | JATA Payment Wallet: provider-agnostic payments inside the Business POS | 2026-10-04T21:00:08Z | `7da4b4f0` | ✅ IN |
| #36 | Website Studio: AI photography, mobile upload fix, media library, health, c… | 2026-10-04T19:07:49Z | `d8a7e8d6` | ✅ IN |
| #35 | Production audit 2026-10-04: admin authz, AI entitlement substitution, POS … | 2026-10-04T17:28:06Z | `455646c6` | ✅ IN |
| #34 | Remediate multi-item ordering intent and ambiguous product context | 2026-10-04T14:58:45Z | `b733f418` | ✅ IN |
| #33 | Ground AI Business Front Desk in the owner's Business Brain | 2026-10-04T09:21:39Z | `98e69824` | ✅ IN |
| #32 | ci: drop the temporary suite-summary comment step | 2026-10-03T22:28:02Z | `42794daf` | ✅ IN |
| #31 | ci: temporarily post the suite summary to measure counts for the final tree | 2026-10-03T22:26:02Z | `77811f86` | ✅ IN |
| #30 | test(ai-entitlement): pin the rule the database actually enforces | 2026-10-03T22:23:44Z | `282e8e1f` | ✅ IN |
| #29 | test(ai-entitlement): prove the commercial gate against real PostgreSQL | 2026-10-03T22:19:56Z | `10f4e638` | ✅ IN |
| #28 | ci: re-trigger the workflow after a stalled runner (no content change) | 2026-10-03T22:12:52Z | `3f5983f4` | ✅ IN |
| #27 | chore: remove the verification report from the branch | 2026-10-03T21:50:09Z | `a24dbc87` | ✅ IN |
| #26 | ci: remove the temporary suite-summary comment step | 2026-10-03T21:47:20Z | `d791b9ae` | ✅ IN |
| #25 | Verification: AI Business Front Desk remediation for PR #24 | 2026-10-03T21:44:54Z | `265ce0fd` | ✅ IN |
| #24 | Synchronize & Remediate AI Business Front Desk against Master Build Specifi… | 2026-10-03T23:54:57Z | `15a780f4` | ✅ IN |
| #23 | fix(pos,home): working Continue CTA on the POS plan screen, Business POS en… | 2026-10-03T17:26:47Z | `f3b48e1b` | ✅ IN |
| #22 | fix(pos): enforce module-read permission on the /credit, /expenses and /sta… | 2026-10-03T11:37:30Z | `8f90e030` | ✅ IN |
| #21 | Build configurable Business POS | 2026-10-03T09:23:20Z | `6e1ce6e7` | ✅ IN |
| #19 | JATA AFTERCALL — Interactive Business (KES 999/month) | 2026-10-02T09:50:19Z | `a8c7effa` | ✅ IN |
| #18 | feat: Phase 1 Foundation + Phase 3 Commerce + Phase 4 Notifications + Phase… | 2026-10-01T15:56:39Z | `5061801d` | ✅ IN |
| #17 | Handle partial Paystack refunds without false full refunds | 2026-10-01T14:45:44Z | `2dc1a3ec` | ✅ IN |
| #15 | Stage 2: self-service referral flow | 2026-09-29T13:05:42Z | `993fb1bd` | ✅ IN |
| #14 | Stage 1: enforce payment-before-publication and fix active-plan availability | 2026-09-29T12:10:47Z | `1fc7c431` | ✅ IN |
| #13 | docs: sanitize demo credentials and URLs | 2026-09-29T10:59:16Z | `90897a09` | ✅ IN |
| #12 | fix(ux): current-main remediation from the Instruction 1 audit | 2026-09-29T10:46:23Z | `b9cf6e78` | ✅ IN |
| #11 | fix(health): never claim db:up when DATABASE_URL is unconfigured | 2026-09-28T21:38:43Z | `d9bb8b35` | ✅ IN |
| #10 | fix(D1): dark-theme Services list contrast in BusinessPage (minimal, G4 evi… | 2026-09-28T19:08:01Z | `0b87e05a` | ✅ IN |
| #9 | fix(G4): static branded OG image + social metadata for /b/[slug] | 2026-09-28T18:32:06Z | `f6a65e0f` | ✅ IN |
| #8 | G2+G5+G3 docs: publication policy note, production verification record, tes… | 2026-09-28T18:06:51Z | `b2199469` | ✅ IN |
| #7 | Remediate subscription checkout and business location flows | 2026-09-28T14:51:34Z | `4c7af74c` | ✅ IN |
| #6 | Fix stable production base URL and onboarding redirect swallowed by try/catch | 2026-09-27T08:29:52Z | `f23f4df6` | ✅ IN |
| #5 | Recover authorized subscription, Kenyan phone normalization, and production… | 2026-09-27T07:29:33Z | `a17054ee` | ✅ IN |
| #4 | fix: owner lifecycle, unpublished preview, and design-system repair | 2026-09-26T17:43:21Z | `6b539410` | ✅ IN |
| #2 | feat(deploy): production DB init — initial migration + isolated build gate … | 2026-09-16T07:14:23Z | `a3755391` | ✅ IN |
| #1 | JATA AFTERCALL V1 — Next.js + Prisma + Neon + Paystack (JATA ATLAS 2006074) | 2026-09-13T16:38:27Z | `a1af2fde` | ✅ IN |

### 3.1 Detailed evidence — most recent changes in production

| Item | Evidence |
|---|---|
| **PR #58** — fix(landing): keep the wordmark clear of the header controls on phones | Merged 2026-10-25T11:27:40Z, merge commit `420d2af1` (== production SHA) |
| Production inclusion | **Present** — deployment `dpl_7fc6dbw…` `gitSource.sha = 420d2af1…` |
| Checks | **PASS** — `Journey against a real database` ✅, `Migration target guard` ✅, `Release gate (aggregate)` ✅, plus Static / Production build path / Migrations+schema on PG18 / Failure paths / Schema reconciliation — all `success` on `420d2af` |
| Deployment | `dpl_7fc6dbwKqCjvpG6tPzg2YnYdtttK`, SHA `420d2af1`, `READY`/`PROMOTED`, 2026-10-25T11:28:55.814Z |
| Smoke tests | `/health` → `{"status":"ok","db":"up","version":"1.0.0"}` at 12:02:54Z (live, this audit); `/` → 200, renders; `/dashboard` → redirected to `/login` (auth gate intact); CI `Production smoke (read-only)` run 40189038746 triggered by this deployment — **success** |
| **PR #57** — five plans in one pricing grid, POS included | Merged 2026-10-25T08:55:24Z, merge commit `e8de29d7` |
| Production inclusion | **Present**, verified at *content* level: live homepage pricing grid contains **five** cards — Monthly KES 149, Annual KES 999, AI Business Front Desk KES 499, Website Studio KES 999, and **"JATA AFTERCALL — Business POS" (Owner-only, KES 499)** linking to `/dashboard/pos`. The POS card in the grid is the marker introduced by #57 and absent before it. |
| Checks | **PASS** — release gate green on `e8de29d7` (run 40178547288 / 4017892…) and again on `420d2af` which contains it |
| Deployment | Deployed as `dpl_GpxJcRUVry5nvBnS4YCAjmdJsQ7g` @ `e8de29d7`, then carried forward into the current `dpl_7fc6dbw…` |
| **PR #56** — align pricing cards, benefit icons, demo mock | Merged 2026-10-25T06:44:32Z, `a04ecb7d`; deployed `dpl_CfKpqvKe7mUr9uCJqoDjjXbx6Zx1`; **Present** |
| **PR #55** — landing redesign, motion-led homepage | Merged 2026-10-24T20:32:28Z, `6e848237`; deployed `dpl_J29hBKefPmxXCo6qZC2FsDp1ZYGQ`; **Present** |
| **PR #54** — remediate PR 49 payment, media, auth, POS lifecycle | Merged 2026-10-23T21:06:04Z, `cce008df`; deployed `dpl_txLB1StXs1zpJANRnqCmXFpZUmDh`; **Present** |
| **PR #53** — patch Next.js advisories | Merged 2026-10-23T03:03:45Z, `ba08f462`; deployed `dpl_2RskAV3FpHdQw3itZAf7EqQkPsG4`; **Present** |
| **PR #52** — reconcile six schema/migration divergences | Merged 2026-10-22T23:35:00Z, `ac3af415`; deployed `dpl_28K6dY7vEtMfLuCBidnoiz94KeQt`; **Present** |
| **PR #50** — reproducible release-validation gate | Merged 2026-10-21T10:18:07Z, `66c4f33a`; **Present** |
| **PR #48** — Migration Guard v3 (squash-merged) | Merged 2026-10-18T11:45:20Z, `2575cf46`; **Present** |
| **PR #46** — fail-closed publish/unpublish authorization | Merged 2026-10-16T17:52:24Z, `01314455`; deployed `dpl_AF7xXZW7RHmZ4AbfVLh9659REYfj`; **Present** |

### 3.2 Anomaly worth the owner's attention (no action taken)

**PR #45** ("Verification candidate: payment-settlement revival, hydration #418,
dependency and design-system gates — **NOT APPROVED FOR DEPLOYMENT**") was merged at
2026-10-16T17:52:26Z (`9cb5b607`) and is therefore **live in production**. Its own body
states it "must not be merged or deployed until the owner authorises it explicitly".

Its payment-settlement rule is present in the deployed tree:

```
lib/paymentVerification.ts
34: export const SETTLEABLE_PAYMENT_STATES = ["PENDING","FAILED","CANCELLED","EXPIRED"] as const;
```

This is **already deployed history** — reverting or rewriting it is out of scope and
forbidden by the brief. It was subsequently covered by the #52 schema reconciliation,
#53 security patch, and #54 remediation, and it passes the release gate at `420d2af`.
Recorded as a **governance risk**, not as an undeployed change.

---

## 4. Phase 2 — Safety & compatibility audit

No change is awaiting deployment, so no new deployment risk was introduced. Findings
relevant to keeping the current production state safe:

| Area | Finding |
|---|---|
| Architecture preserved | Next.js 15 App Router, Prisma, Neon PostgreSQL, Paystack, Vercel — untouched. Zero code changes made by this audit. |
| Database | **No migrations run, no schema change, no data operation.** The release gate's `Migrations + schema on PostgreSQL 18` and `Schema reconciliation proposal closes the drift` both pass, and `Migration target guard` confirms the production target is the enrolled one. |
| Payments | Paystack behaviour unchanged. `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` remain project-level `sensitive` vars; **no secret was read, printed, or modified.** |
| Env vars | Required production vars present: `AUTH_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `PUBLIC_BASE_URL`, `DATABASE_URL` (production), `ADMIN_EMAILS`, `CLIENT_KEY`, Paystack keys, M-Pesa keys. No change required for any merged PR. |
| Branch protection | Untouched; the three required contexts remain enforced with `strict` policy. |
| Build-skip config (note) | Project setting `commandForIgnoringBuildStep = \`if [ "$VERCEL_ENV" == "production" ]; then exit 1; else exit 0; fi\`` — i.e. **preview builds are deliberately skipped, production builds always run.** `CANCELED` preview deployments in the history (e.g. `dpl_3Yc7HcbT…` on the PR #58 branch) are this policy working as configured, **not** failures and not evidence of an undeployed merge. |

---

## 5. Phase 3 — Controlled deployment decision

1. **Is a deployment needed?** No. Production SHA `420d2af…` == `main` HEAD `420d2af…`.
2. **Would a normal `main` deployment include the missing changes?** There are none missing.
3. **Duplicate-deployment avoidance:** **no deployment was created.** Re-deploying the
   same SHA would add a redundant build with no change in served output.
4. **Authorized workflow:** the existing Vercel ↔ GitHub integration on production branch
   `main` already produced the promoted build; no CLI deploy, no unmerged branch code,
   no `--force`, no promotion override.
5. **No PR merged. No history rewritten. No database operation. No secret touched.**

---

## 6. Phase 4 — Final status

| Bucket | Items |
|---|---|
| **CONFIRMED DEPLOYED** | All **48** merged PRs, including #58 (production SHA itself), #57 (verified by live five-plan pricing grid incl. Business POS card), #56, #55, #54, #53, #52, #50, #48, #46, and all older merges down to #10. |
| **CONFIRMED NOT DEPLOYED** | **None.** Zero merged PRs are absent from `main` HEAD, and production is at `main` HEAD. |
| **DEPLOYED AND VERIFIED** | Nothing newly deployed by this audit (none required). The existing `dpl_7fc6dbw…` is `READY`/`PROMOTED` at `420d2af` and passed post-deployment checks. |
| **BLOCKED** | Nothing blocked the audit. |
| **NOT TESTED** | (see below) |

### 6.1 Smoke tests actually executed in this audit

| Check | Result |
|---|---|
| `GET /health` | **PASS** — `{"status":"ok","db":"up","version":"1.0.0","timestamp":"2026-10-25T12:02:54.877Z"}` (real DB connection up) |
| `GET /` | **PASS** — 200, full landing page renders; five-plan pricing grid with POS card present |
| `GET /dashboard` (no session) | **PASS** — redirected to `/login`; authentication gate intact, no business data exposed |
| `GET /login` | **PASS** — renders sign-in form |
| CI `Production smoke (read-only)` run `40189038746` | **PASS** — triggered by `deployment_status` for this production deployment, job `Read-only smoke` success, 14 s (checks `/`, `/health`, optional `/b/<slug>`) |

### 6.2 NOT TESTED — and why

| Not tested | Reason |
|---|---|
| Live Paystack payment / verification / refund | Requires a real transaction and production Paystack keys; no payment may be initiated without owner approval. Covered indirectly by CI `Journey against a real database` (success on `420d2af`). |
| Authenticated owner journeys (dashboard, POS, subscription enforcement, business isolation) | Requires production credentials I must not use or request. CI `Journey against a real database` exercises these against a real PostgreSQL instance and passed on `420d2af`. |
| Direct `curl` status codes from this sandbox | Sandbox egress is allowlisted (GitHub/npm/PyPI only); `jata-aftercall.vercel.app` was reached via the platform fetch tool instead. Status-code-level assertions therefore come from the CI smoke run, not from local curl. |
| Mobile-viewport header geometry (PR #58) | A real headless-Chromium run is not available here; the repo carries `scripts/browser/home-header-tagline.check.mjs` plus committed evidence logs under `docs/evidence/home-header-tagline-2026-10-25/`. Inclusion is proven by SHA; pixel-level re-verification is owner/CI territory. |

### 6.3 Outstanding risks

1. **PR #45 is live despite "NOT APPROVED FOR DEPLOYMENT".** It predates this audit and
   introduced the settleable-state rule now in `lib/paymentVerification.ts`. Requires an
   explicit owner decision — accept it as shipped, or authorise a scoped remediation PR
   (which would need the full gate + a real Paystack test). Not something this audit may
   change unilaterally.
2. **8 open PRs are unmerged and therefore not deployed** — #51, #49, #47, #44, #42, #41,
   #20, #16. Out of scope by instruction; none was merged or deployed.
3. **Preview builds are intentionally skipped** by `commandForIgnoringBuildStep`; do not
   read `CANCELED` preview entries as broken merges.
4. **No automatic rollback target is configured beyond Vercel's own history**
   (`lastRollbackTarget: null`). The previous good production build remains
   `dpl_GpxJcRUVry5nvBnS4YCAjmdJsQ7g` @ `e8de29d7` if a rollback is ever needed.
5. **Production smoke coverage depends on the `deployment_status` event.** It fired and
   passed for this deployment; if Vercel's GitHub deployment events are ever disabled, the
   post-deployment check would silently stop running (the workflow file documents this).

---

## 7. Conclusion

Production is **exactly** at `main` HEAD (`420d2af15257aa3d878116b1745205cb79ff2b20`), via
deployment `dpl_7fc6dbwKqCjvpG6tPzg2YnYdtttK` (`READY`, `PROMOTED`, aliased to
`jata-aftercall.vercel.app`). All 48 merged pull requests are included. **There is no
eligible undeployed change, so no deployment was performed** — that is the correct
outcome of the execution rule, not a failure.
