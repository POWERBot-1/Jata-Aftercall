# PR #59 — Website Studio Canvas: review, merge, deploy & production acceptance

**Date:** 2026-10-25
**Repository:** `POWERBot-1/Jata-Aftercall`
**Pull request:** [#59 — feat(studio): Website Studio Canvas](https://github.com/POWERBot-1/Jata-Aftercall/pull/59) — **MERGED**
**Production:** https://jata-aftercall.vercel.app

---

## 1. Pull request status

| Field | Value |
| --- | --- |
| PR | [#59](https://github.com/POWERBot-1/Jata-Aftercall/pull/59), `state: MERGED` |
| Merged at | 2026-10-25T13:08:27Z |
| Merged by | `POWERBot-1` |
| Merge method | merge commit (no squash, no rebase, no history rewrite) |
| Branch protection | obeyed — no bypass, no admin override, no forced check |
| Review requirement | none configured (`reviewDecision: ""`); checks were the gate |

## 2. Commits

| Role | SHA |
| --- | --- |
| Reviewed / approved head (candidate) | `532cb8eaf04a549163de8cd4e9609f098334f311` |
| Base `main` at review time | `420d2af15257aa3d878116b1745205cb79ff2b20` |
| Merge commit = final `main` HEAD | `2cae6cd52e22e8dd940e45e6207282ab4e89f018` |
| Deployed commit (`githubCommitSha`) | `2cae6cd52e22e8dd940e45e6207282ab4e89f018` |

`git fetch origin` after the merge: `origin/main == 2cae6cd…`, and `git log 2cae6cd..origin/main` is empty — no extra commits landed after the merge.

## 3. Verification results on the exact candidate (`532cb8e`)

CI on the PR head — **12/12 checks pass**:

| Check | Result |
| --- | --- |
| Static (install / prisma generate / lint / typecheck / audit) | PASS |
| D2 build + audit + controls | PASS |
| Exact candidate applies on disposable PostgreSQL 18 | PASS |
| Journey against a real database | PASS (11m46s) |
| Migration target guard | PASS |
| Migrations + schema on PostgreSQL 18 | PASS |
| Production build path on PostgreSQL 18 | PASS |
| Schema reconciliation proposal closes the drift | PASS |
| Failure paths actually fail | PASS |
| Release gate (aggregate) | PASS |
| Vercel | PASS |
| Vercel Preview Comments | PASS |

Local re-verification after the fixes:

| Gate | Result |
| --- | --- |
| Unit tests | **123 files / 1565 tests PASS** |
| Canvas suites | **50 tests PASS** |
| ESLint (`app components lib`) | 0 errors (36 pre-existing warnings) |
| `next build` | compiled successfully |
| `tsc --noEmit` | clean except one pre-existing error in `tests/prisma/experience-boundary.test.ts` (Prisma client cannot be generated in this offline sandbox; CI's Static job generates it and passes) |

Post-merge `main` gates on `2cae6cd` — all green:

| Run | Result |
| --- | --- |
| Release Validation `[push]` (`40196256188`) | success |
| Interactive Business E2E `[push]` (`40196256163`) | success (finished 13:20Z) |
| Production smoke (read-only) `[deployment_status]` (`40196398052`) — job "Read-only smoke" | success |

Scope guard on the merged diff: **no** `prisma/` schema or migration files, **no** payment / subscription / Paystack / entitlement / auth / publishing files. No migration was required or run.

## 4. Vercel deployment

| Field | Value |
| --- | --- |
| Deployment ID | `dpl_CtJVZiYK7xoeh3JHuJiP7bCZ747b` |
| State | **READY**, `readySubstate: PROMOTED` |
| Target | production |
| Commit | `2cae6cd52e22e8dd940e45e6207282ab4e89f018` (verified) |
| Created | 2026-10-25T13:08:30Z (auto-deployed by Vercel on merge) |
| Ready / promoted | 2026-10-25T13:10:22Z (`aliasAssignedAt` 13:10:22Z) |
| Time to ready | 110767 ms |
| Alias | `jata-aftercall.vercel.app` ✔ assigned |
| Deployment URL | https://jata-aftercall-nmzenbsl7-powerbot-1.vercel.app |
| Previous production | `dpl_7fc6dbwKqCjvpG6tPzg2YnYdtttK` @ `420d2af` (READY, now `isRollbackCandidate: true`) |

No duplicate deployment was created, no force promotion, no config or environment change, no rollback. The existing production rollback target is `dpl_7fc6dbw…` @ `420d2af`.

## 5. Acceptance evidence (production, deployed commit `2cae6cd`)

| Check | Expected | Observed |
| --- | --- | --- |
| `GET /health` | `{"status":"ok","db":"up"}` | `{"status":"ok","db":"up","version":"1.0.0","timestamp":"2026-10-25T13:12:58.257Z"}` — database reachable |
| `GET /` (landing) | 200, full page | 200; hero, feature grid, four demo examples, five-plan pricing with Paystack copy intact |
| `GET /dashboard` | redirect to login | redirected to `/login` (no dashboard HTML leaked) |
| `GET /dashboard/businesses/<id>/canvas` (unauthenticated) | blocked | redirected to `/login` — Canvas is not reachable without a session |
| `GET /api/experience` (unauthenticated) | 401 JSON | `{"error":"Please sign in to continue."}` |
| `GET /studio-preview` | 404 in production (DB-free demo is dev-only by design) | 404 page served |
| `GET /b/marys-beauty-studio` (storefront) | unchanged, renders live content | 200; full storefront with WhatsApp/Call/Directions/Share, services, offer, hours, quote, footer — no draft leakage |
| `GET /login` | 200 | 200 |

The production alias serves exactly the merged commit; the deployed route tree includes `app/dashboard/businesses/[id]/canvas/page.tsx`.

## 6. Defects found in review and fixed before merge (all in `532cb8e`)

1. **Critical — draft version frozen after the first save.** The save response reader looked for a top-level `draftVersion`, but the API returns it under `experience.draftVersion`. Every edit after the first sent a stale `expectedDraftVersion`, got a **409**, and was rolled back — the Canvas was effectively single-use. Fixed with `readSaveResponse()`, which accepts either response shape, rejects a non-positive-integer version, and tolerates a non-object payload (regression-tested).
2. **CTA label edits silently discarded.** The inspector exposed the registry key `cta.label`, but the server's `normalizeSection` whitelist drops dotted keys. `patchForField()` now writes the whole `cta` object (`label` capped at 40, existing `href` preserved) and never emits a literal `"cta.label"` key; `inspectorFieldsFor()` only offers persistable fields (items point to the catalogue, images to Photos).
3. **Client/server title cap mismatch** — client cap lowered from 120 to 90 to match `safeText(raw.title, 90)`.
4. **Double-submit race** — an `inFlight` guard serialises saves so a double submit cannot 409 itself.
5. **Invalid ARIA** — `role="tab"` without `tabpanel` replaced with `role="group"` + `aria-pressed` segmented controls (CSS selectors updated).

11 regression tests were added; Canvas coverage is 50 passing tests.

## 7. Not tested / blocked (stated plainly, not inferred)

- **Authenticated Canvas journey in production** (load → edit → reorder → hide → save → draft preview → draft-vs-live) — **NOT TESTED**: no production owner credentials were supplied and none were requested or read.
- **Browser / visual acceptance**, screenshots, responsive behaviour at real viewports, keyboard focus order, reduced-motion, touch-target measurement — **BLOCKED**: no Chromium binary in the environment (`scripts/browser/*.check.mjs` cannot run). A static HTML snapshot exists at `docs/evidence/studio-canvas-2026-10-25/`; it is a labelled substitute and is **not** proof of browser behaviour.
- **Physical Android device testing** — **NOT TESTED** (no device).
- **Real-network performance / Web Vitals** — **NOT TESTED**.
- **Cross-tenant isolation exercised against live data** — **NOT TESTED** live; the authorization boundary was only observed negatively (unauthenticated request → login / 401). Tenant isolation remains covered by the existing suite and CI's real-database journey, not by a manual two-tenant production test.
- **Payment / subscription / publish gates** — **NOT TESTED live** (no real payments were made, by design). The merged diff touches none of those code paths, so their behaviour is unchanged from `420d2af`.

## 8. Verdict by phase

| Phase | Verdict | Basis |
| --- | --- | --- |
| 1 — Pre-merge verification | **PASS** | Exact head `532cb8e` on base `420d2af`, 0 commits behind, no conflicts, `MERGEABLE`/`CLEAN`, all required checks green on that exact SHA |
| 2 — Code review & defect remediation | **PASS** | Full diff reviewed; 5 defects fixed (1 critical, data-loss class); 11 regression tests added; local gates re-run green |
| 3 — Merge gate | **PASS** | No critical security/auth/tenant/payment/data-loss/build defect remained; no migration or destructive DB operation; protection obeyed |
| 4 — Merge & deployment | **PASS** | Merged as `2cae6cd`; Vercel auto-deployed that exact commit; READY + PROMOTED; production alias assigned; no duplicate/forced deployment |
| 5 — Production acceptance | **PASS (partial, as labelled)** | Health+DB, landing, dashboard/canvas auth redirect, `/api/experience` 401, storefront render and non-leakage verified on the promoted commit. Authenticated owner journey, browser/visual, device and performance checks are **NOT TESTED** (see §7) |
| 6 — Report | **PASS** | This document |

**Overall: PASS**, with the explicit exclusions in §7 — the Canvas feature is merged and live at https://jata-aftercall.vercel.app on commit `2cae6cd`, but authenticated in-browser editing was not exercised here and must be confirmed by an owner signing in.
