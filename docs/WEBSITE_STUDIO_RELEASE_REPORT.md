# JATA AFTERCALL — Website Studio Release Report

Running evidence record for the JATA Immersive Website Engine work. The plan, baseline audit and
blockers are in `WEBSITE_STUDIO_RELEASE_PLAN.md`.

Every number below was produced by a command in this session. Where a check could not be run, it
says so rather than implying a pass.

---

## 1. Commits, branch, pull request

| Item | Value |
| --- | --- |
| Repository | `https://github.com/POWERBot-1/Jata-Aftercall` |
| Base (intended target) | `main` @ `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` |
| Baseline HEAD before any edit | `77e35cec6a5726f569ab3febd3e7766300b14890` |
| Feature branch | `arena/a9a473f2-jata-aftercall` |
| Stage 2 (motion) commit | `bc1bbdeb5b7eca06fa83bb0e2c1e3476daf98f95` |
| First documentation commit | `cb5ca87e108321798c58e035a2a3504a96192a58` |
| Weight-check + decision-register commit | `a9029b3df316cd6065724267e900ce30a0053291` |
| Branch URL | https://github.com/POWERBot-1/Jata-Aftercall/tree/arena/a9a473f2-jata-aftercall |
| Ancestry vs `origin/main` | **0 behind / 20 ahead** (`git rev-list --left-right --count origin/main...HEAD`) |
| Force-push / history rewrite | none |
| Merged | **no** |
| Production deployed | **NOT DEPLOYED** |

### Sandbox reset and recovery (session of 2026-10-11, second pass)

The Arena sandbox was reset between sessions. Local `HEAD` had reverted to the baseline
`77e35ce…`, the clone was shallow again, and the Stage 2 work existed only as uncommitted
working-tree files. **Nothing was lost**, because the branch had already been pushed to GitHub.

Recovery, with no destructive step:

1. `git fetch --deepen 400 origin` — the remote commits became reachable locally.
2. Compared the working tree against the remote commit `abdee80…`: `git diff --stat abdee80 -- .`
   showed no difference for the six tracked files, and `git hash-object` matched the remote blob
   hash for **all nine** new files (`IDENTICAL` × 9).
3. Only then `git reset --mixed abdee80…` — moves the branch pointer and leaves every file byte
   for byte as it was. The working tree came out clean.

No `--hard`, no stash dropped, no file deleted, `origin/main` untouched.

### Pull request

`gh auth status` confirms `POWERBot-1` with `permissions: {admin: true, push: true, …}` on the
repository, so opening a PR was authorized, and **PR #42** is now open against `main`
(https://github.com/POWERBot-1/Jata-Aftercall/pull/42). GitHub reports it `MERGEABLE` with
`mergeStateStatus: UNSTABLE`, which means **required checks exist and had not yet passed** at the
time of writing. `gh api repos/…/branches/main/protection` returns **403 "Resource not accessible
by integration"**, so the protection *rules* cannot be read with this token — but
`gh pr checks 42` shows what is actually running. Details and the observed check states are in §11.

---

## 2. What was implemented

Stage 2 of the plan: the motion engine, built on the mandated `motion` dependency.

| File | Role |
| --- | --- |
| `lib/experience/motion.ts` | **new.** Pure motion contract. The fourteen §21 presets with CSS fallback classes, `motionPlan()` (the download gate), `sectionRecipesForPage()` (deterministic per-business choreography), `isLowPowerDevice()`. No DOM access. |
| `lib/experience/seed.ts` | **new.** `hashSeed` / `seededChoice` / `regenerationSeed`, extracted from `diversity.ts` so the client bundle does not pull the theme table in for two small functions. |
| `lib/experience/diversity.ts` | re-exports those three from `./seed`; public API unchanged, no behaviour change. |
| `components/storefront/motion/MotionRuntime.ts` | **new.** The only module that imports `motion`. Entrance, stagger, split, clip, morph, scroll-driven parallax/image-pan, pointer-only magnetic CTA. |
| `components/storefront/motion/MotionEngineMount.tsx` | **new.** Computes the plan and only then `import("./MotionRuntime")`. |
| `components/storefront/MotionReveal.tsx` | now takes `motionLevel` + `recipe`, emits `data-eb-motion`, keeps the CSS reveal and the 4s safety timeout. Never imports `motion`. |
| `components/storefront/ExperienceSite.tsx` | mounts the engine, marks up sections from the document's generation seed, marks the hero CTA for the magnetic recipe. |
| `app/globals.css` | `html[data-motion-engine="js"]` rules plus the `[data-eb-magnetic]` transition and its reduced-motion opt-out. |
| `app/dev/motion-preview/page.tsx` | **new.** Development-only harness (404 in production), same pattern as `app/dev/immersive-preview`. |
| `scripts/browser/motion-engine.check.mjs` | **new.** Real-browser scenarios. `npm run test:browser:motion`. Exits 2 without `CHROME_PATH`. |
| `tests/unit/motion-engine.test.ts` | **new.** 29 tests. |
| `package.json`, `package-lock.json` | `motion` `^14.1.0` added; `test:browser:motion` script added. |

### Safety properties, and where each is enforced

- **Reduced motion** — `motionPlan()` returns `{engine:"css", recipes:[]}` before anything else;
  `prefers-reduced-motion` also has its own CSS block. Asserted by
  `tests/unit/motion-engine.test.ts`.
- **Lite never downloads the engine** — `resolveRenderMode` runs before the import is attempted;
  the boundary test asserts no Lite-path file imports `motion` or references `MotionRuntime`.
- **A `subtle` theme stays on CSS** — one transition does not justify a library.
- **A blocked or failed chunk cannot hide content** — under `html[data-motion-engine="js"]` the
  stylesheet leaves every `.eb-reveal` fully opaque; the runtime hides only the elements it is
  about to animate, and a 4‑second timer restores anything it has not reached.
- **Touch first** — `magnetic` is bound to the button and skipped without `(pointer: fine)`;
  section recipes never include a hover-only preset.
- **Low-power** — continuous scroll-driven recipes are dropped; the rest of the choreography
  stays.

---

## 2b. Second increment — publishing weight check (§83) and the decision register

Added in commit `a9029b3`.

| File | Role |
| --- | --- |
| `lib/experience/weight.ts` | **new.** The §83 pre-publish weight calculation, computed from the experience document alone — no database query, no network call. Reports measured image bytes (from data-URL payloads), model bytes where the caller knows them, asset request count, which §39 budgets are breached, and plain-language recommendations. |
| `app/api/studio/health/route.ts` | Adds a `weight` object to the existing GET response. **Additive only**: `buildHealthReport` and the readiness score are untouched. |
| `tests/unit/experience-weight.test.ts` | **new.** 15 tests. |
| `docs/WEBSITE_STUDIO_RELEASE_PLAN.md` | §4 is now a decision register covering Decisions A–E with verified evidence, risk, owner and the exact approval needed. |

Design choices that matter, and why:

- **Advisory, never blocking.** It cannot refuse a publication, cannot touch the payment or
  entitlement gate, and does not feed the readiness score. An owner on a slow connection is better
  served by a heavy-but-live website than by a refusal.
- **Bytes are only claimed when known.** A remote URL has no size until something fetches it, so
  it is counted as unmeasured and the verdict becomes `"unknown"` instead of pretending the page
  is light. `verdict: "unknown"` is a real answer.
- **The document walk is generic.** A hard-coded list of image fields would silently stop counting
  new ones — galleries, variants, campaigns — which is how a budget check quietly becomes a lie.
- **It cannot throw.** A malformed or cyclic document yields an empty report, bounded by a node
  cap, so a health read can never fail the Studio page that displays it.

Verified: the weight module is server-only. `/b/[slug]` first-load JS is unchanged at **3.95 kB /
117 kB**, identical to the Stage 2 measurement.

Two claims in `STORAGE_DECISION.md` were independently re-verified rather than trusted:
`assertCanStore` has **no production call site** (grep finds only its definition and
`tests/unit/storage-provider.test.ts`), and `resolveStorageProvider` is reached only from
`lib/experience/immersive/policy.ts` — never from the upload path. The storage contract exists;
nothing in production writes through it.

---


| Question | Answer, with evidence |
| --- | --- |
| Package manager | **npm.** `package-lock.json` present; no `yarn.lock`, no `pnpm-lock.yaml`. |
| Command executed | `npm install motion --no-audit --no-fund`, run from the repository root on the feature branch |
| Exit code | 0 — `added 4 packages in 3s` |
| Installed version | `motion` **14.1.0** (`node -p "require('motion/package.json').version"`) |
| Peer requirements | `react ^18.0.0 \|\| ^19.0.0`, `react-dom ^18.0.0 \|\| ^19.0.0` — the repo is on `react` 18.3.1 and `next` 15.5.26, so the peer range is satisfied |
| In `package.json` | yes: `"motion": "^14.1.0"` under `dependencies` |
| In the lockfile | yes: root `packages[""].dependencies.motion` plus entries for `motion`, `framer-motion`, `motion-dom`, `motion-utils` (all 14.1.0). `tslib` already existed as a transitive dependency |
| Lockfile diff | **+61 lines, all additive.** No existing entry was modified or removed; no unrelated dependency moved |
| Duplicate animation system? | **No.** Before this change the repo had no animation library at all — `grep` for `gsap\|motion\|framer-motion` in the lockfile matched only `three`. GSAP was **not** added (conflict C3 in the plan) |
| Tree-shaking / lazy loading | The library is reached only through `import("./MotionRuntime")` inside `MotionEngineMount`, which itself runs only when `motionPlan()` returns `motion-js` |

### Bundle impact, measured

`npx next build` was run twice: once at the baseline SHA (working tree stashed) and once with the
change. Chunk lists were read from `.next/app-build-manifest.json` and sized with `fs.statSync`.

| Route `/b/[slug]` | Baseline `77e35ce` | With motion | Delta |
| --- | --- | --- | --- |
| Sum of initial chunks (raw bytes) | **388,947** | **393,270** | **+4,323 (+1.1 %)** |
| Next's reported First Load JS | 116 kB | 117 kB | +1 kB |
| Route-only chunk | 18,333 | 14,202 | −4,131 |

Two shared framework chunks — `4bd1b696-f785427dddbba9fb.js` (173,020 B) and
`1255-0f12d1d68e0b5948.js` (173,688 B) — carry **identical content-hash filenames in both
builds**, so they are byte-identical and unaffected.

**The `motion` library is not in any first load.** It is emitted as
`.next/static/chunks/7419.8acf392b0eb5980e.js` (**62,963 bytes** raw), and a scan of
`app-build-manifest.json` across every route returned **no route that lists it as an initial
chunk**. A Lite page and a `subtle` Motion page never request it.

The first +25.7 kB attempt at this change was caused by `lib/experience/motion.ts` importing
`seededChoice` from `diversity.ts`, which imports `themes.ts` — dragging the whole theme table
into the client bundle. Extracting `lib/experience/seed.ts` cut the delta from 25,697 to 4,323
bytes. Both numbers are real measurements, not estimates.

---

## 4. Tests

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **PASS**, exit 0 |
| Lint | `npx next lint` | **PASS**, exit 0. One pre-existing warning: `components/storefront/CartProvider.tsx:210` `@next/next/no-img-element` — present at baseline, unrelated |
| Unit / integration / security | `npx vitest run` | **148 files passed, 10 skipped; 1784 tests passed, 94 skipped**. Progression: baseline `77e35ce` 146/1740 → after Stage 2 `bc1bbde` 147/1769 → after the weight check `a9029b3` **148/1784**. The 10 skipped files and 94 skipped tests are unchanged throughout. **0 new failures at any step.** |
| Same suite **against real PostgreSQL** (GitHub Actions, run `38150400914`) | `npx vitest run --exclude tests/e2e` | **156 test files passed (156); 1837 tests passed, 1 expected fail (1838); 0 skipped.** This is the first genuine database evidence for this work: `prisma generate`, `prisma migrate deploy`, `npm run seed`, then the suite against a live `postgres:16` service. The +53 tests over the local run are exactly the five `tests/prisma/` suites that self-skip without `PRISMA_TEST_DATABASE_URL`. |
| Production build | `npx next build` | **PASS**, exit 0 |
| Prisma schema validation | `npx prisma validate` | **BLOCKED** — `request to https://binaries.prisma.sh/... failed, reason: Client network socket disconnected before secure TLS connection was established` |
| Prisma generate / migrate deploy | — | **BLOCKED**, same cause. No migration was added by this work, so nothing needed deploying |
| Browser (motion) | `npm run test:browser:motion` | **NOT RUN** — no Chrome/Chromium in the sandbox; the script exits 2 without `CHROME_PATH` |
| Browser (immersive) | `npm run test:browser:immersive` | **NOT RUN** — same reason |
| E2E journeys | `npm run test:e2e`, `test:e2e:pos` | **NOT RUN locally** — no PostgreSQL in the sandbox. These are the 94 skips; CI runs them against Postgres 16 and fails if anything skips |
| Physical Android / low-end device | — | **NOT RUN** |
| Real AI image provider | — | **NOT EXERCISED** — no API key configured; adapters fail closed to `jata-local` |
| Durable object storage | — | **NOT VERIFIED** — no provider configured |

No test was deleted, skipped, or loosened. The new file's assertions are on real module
behaviour (`motionPlan` outputs, `sectionRecipesForPage` determinism, rendered markup) and on
real source facts (import boundary, CSS rules, chunk gating).

---

## 5. Database and migration evidence

No schema change. `prisma/schema.prisma` is byte-identical to the baseline; `prisma/migrations/`
is unchanged at 15 directories. Nothing to migrate, so migration risk for this change is nil.

`prisma validate` could not be run (blocked, §4), which is stated rather than glossed: the schema
is unchanged, so validation status is the same as at baseline, where CI last ran it green.

---

## 6. Security and tenant isolation evidence

This change adds no route, no database access, and no new input surface. The only new server
input is the `?level`, `?preference` and `?seed` query parameters of `/dev/motion-preview`, which
is `notFound()` in production, matches `level` against a three-item allowlist, `preference`
through `isRenderPreference`, and `seed` against `/^[\w:-]{1,64}$/`. It reads no tenant and no
database.

The existing tenant suite is unchanged and still passes: `tests/security/tenant-isolation`,
`experience-tenant-isolation`, `publication-access`, `ai-front-desk-tenant-isolation`,
`pos-tenant-isolation`, `payments-isolation`, `referral-security`.

Server-side authorisation on every experience and media route (`lib/tenant.ts`
`assertBusinessOwnership` / `guardTenantMutation`) is untouched.

---

## 7. Known limitations

1. **Immersive mode is not delivered.** `IMPLEMENTED_RENDER_MODES` is still `["lite","motion"]`;
   `immersive` falls back to `motion`, then `lite`. Stage 5 remains open and needs durable
   storage (blocker B1).
2. **Durable media storage is still not configured.** Images remain inline data URLs in the draft
   JSON. `STORAGE_DECISION.md` §7.5 lists the owner decisions still outstanding.
3. **AI image generation has not been exercised against a real provider.** The local provider
   produces genuine PNGs and is labelled as JATA artwork, not photography.
4. **The JS motion engine has never run in a real browser.** Its decision layer is unit-tested and
   its boundary is statically tested, but the animation itself is unverified until
   `npm run test:browser:motion` runs against a Chrome binary. Reported as not run.
5. **§85 `ExperienceQualityScore` and §86 `ImageQualityScore` do not exist.** Publication is
   gated on payment, entitlement and content validity, not on a quality threshold.
6. **Homepage plan order and the "Interactive Business" → "Website Studio" rename are unchanged**
   (conflicts C1 and C2 in the plan). Both need an owner decision because both contradict
   currently passing tests and, for C2, operator-editable database text.
7. **Performance telemetry is incomplete.** `data-render-mode`, `data-motion-plan` and
   `data-motion-engine` are on `<html>` for diagnostics, but nothing yet ships asset load time,
   3D init time or fallback rate to analytics (§57), and the engine does not yet learn from
   previous-session performance (§58).

---

## 8. Final SHAs

| Item | SHA |
| --- | --- |
| Base `origin/main` | `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` |
| Baseline before edits | `77e35cec6a5726f569ab3febd3e7766300b14890` |
| Implementation commit | `bc1bbdeb5b7eca06fa83bb0e2c1e3476daf98f95` |
| Documentation commit (this file) | `cb5ca87e108321798c58e035a2a3504a96192a58` |
| Remote branch SHA after the documentation push | verified with `git ls-remote origin refs/heads/arena/a9a473f2-jata-aftercall`; the SHA it returned is the final one for this delivery and is quoted in §1 |

---

## 9. Approvals and unresolved decisions

Required before this can be considered complete:

1. **Owner decision on conflict C1** — homepage plan ordering.
2. **Owner decision on conflict C2** — the "Website Studio" rename, including whether
   `PlanConfig.name` rows are updated in the database.
3. **Owner decision on blocker B1** — approve a durable object-storage provider, its secret, a
   spend ceiling and a per-tenant quota (`STORAGE_DECISION.md` §7.5).
4. **Owner decision on blocker B2** — supply an AI image provider key.
5. **Authorisation to open the pull request** against `main`, and separately, to merge it.

Nothing in this session opened a pull request, merged anything, changed a payment or refund
policy, touched a production database, or deployed. Production deployment remains a separate
action requiring explicit approval.

---

## 10. Recovery

This branch is the recovery source, not the Arena filesystem. To resume:

```
git fetch origin arena/a9a473f2-jata-aftercall
git log --oneline 9c36bd1..origin/arena/a9a473f2-jata-aftercall
```

`npm ci` restores the exact dependency tree from `package-lock.json`, including `motion` 14.1.0.

---

## 11. Pull request status

| Item | Value |
| --- | --- |
| Authorization to open | **yes** — `gh auth status` = `POWERBot-1`; repo `permissions.admin = true` |
| Required checks readable | **no** — `GET /repos/POWERBot-1/Jata-Aftercall/branches/main/protection` → `403 Resource not accessible by integration` |
| PR | **#42** — https://github.com/POWERBot-1/Jata-Aftercall/pull/42 · base `main`, head `arena/a9a473f2-jata-aftercall` |
| PR mergeable | `MERGEABLE` (no conflict with `main`) |
| PR merge state | `UNSTABLE` — required checks exist and were not yet satisfied at the time of writing |
| Checks observed via `gh pr checks 42` | `Vercel` **pass**; `Vercel Preview Comments` **pass**; `Journey against a real database` **fail** — see §12 for the diagnosis |
| Main suite inside that job | **156 files / 1837 tests passed, 0 skipped** against real `postgres:16` — the DB coverage now genuinely runs |
| What still fails in that job | four tests in `tests/e2e/interactive-business-journey.test.ts` (13, 14, 16, 17), pre-existing, in the publish and payment contract — see §12 |
| Merge | **not performed** |
| Release status | **BLOCKED** |

Remaining actions, with the responsible party:

1. **Owner** — answer Decisions A, B, C and D in `WEBSITE_STUDIO_RELEASE_PLAN.md` §4. Each has an
   exact approval sentence; none can be inferred safely.
2. **Owner / maintainer** — confirm whether `main` carries required status checks, since this
   token cannot read them, and confirm the CI run on the PR is green.
3. **Maintainer** — review the diff against `main` and authorise the merge. Merging is not done
   here. Note the range is **20 commits / 167 files**: the branch was cut from
   `arena/33ebb805-jata-aftercall`, which was already 17 commits ahead of `main`, so those
   pre-existing unmerged commits travel with this PR.
4. **Maintainer** — production deployment is a separate, explicitly authorised action. It has not
   been performed.

Until 1 and 2 are satisfied, the release stays **BLOCKED** even though every check that can run in
this environment passes.

---

## 12. CI evidence — what was broken, what was fixed, what remains

The `Journey against a real database` job was red on the first two runs of PR #42. GitHub's log
download endpoint is not reachable from this sandbox, but the workflow posts its own failing output
to the pull request, which was used as the source of truth throughout.

### First failure — a CI configuration gap, inherited from the baseline

The workflow's skip guard failed the job:

```
↓ tests/prisma/storefront-checkout.test.ts (15 tests | 15 skipped)
...
if grep -qE "[1-9][0-9]* skipped"; then
  echo "Database suites skipped — DATABASE_URL did not reach vitest." >&2
  exit 1
```

The guard's message names the wrong variable. `tests/prisma/` gates on
`realPrismaConfigured = Boolean(process.env.PRISMA_TEST_DATABASE_URL)`
(`tests/helpers/prisma-client.ts:17`), while the job env set only `DATABASE_URL`. The
`tests/integration/*-postgres.test.ts` suites gate on `DATABASE_URL` and did run; the five
`tests/prisma/` suites skipped, and the guard failed the job. **The job could never have gone
green once `tests/prisma/` landed.**

Inherited, not introduced here — each point verified by command:

- `git ls-tree 75f6440 tests/prisma` → **empty**. The directory did not exist at `75f6440`, the last
  CI-green commit on the parent branch.
- It was added by `143d1b1` *"Payment lifecycle rules and real-Prisma integration suite"*, one of
  **11** parent-branch commits that never had a CI run. The baseline `77e35ce` itself was never
  verified.
- `git diff --name-only 77e35ce..HEAD -- .github tests/prisma` → **empty**. This work touched
  neither.

**Fix:** commit `4b0158e` sets `PRISMA_TEST_DATABASE_URL` in the job env, pointing at the same
per-run migrated `postgres:16` service — which is what the helper's documented contract asks for
("an ISOLATED PostgreSQL database that has been migrated. Never production"). No test was skipped,
weakened, excluded or rewritten. Five real-Prisma suites that were silently skipping now run, and
the result is the 1837-test pass in §4.

### Second failure — the §66 journey, pre-existing, in payment and publish policy

With the main suite green, the job reached its later steps for the first time. Four tests fail,
all in `tests/e2e/interactive-business-journey.test.ts`:

| Test | Line | Assertion that fails |
| --- | --- | --- |
| 13 — the owner receives the order and processes it | 341 | `expected undefined to be truthy` |
| 14 — a customer books a service and the owner completes it | 391 | `expected [] to include '11:00'` |
| 16 — an unpaid business can build but never publish | 469 | `expected 428 to be 403` |
| 17 — a lapsed entitlement hides the site but never deletes the content | 494 | `expected 428 to be 403` |

Root cause for 16 and 17, verified: `app/api/experience/publish/route.ts:98` returns **428**
(`VERSION_REQUIRED_CODE`) when the request body has no `draftVersion`. The journey posts
`{ businessId }` with no version, so it is rejected by the version guard before the entitlement
gate can return the expected `403 { requires: "PAYMENT" }`. That guard was added by baseline
commit `99f458b` *"Release remediation: publish version check, tenant gaps, browser checks"*; the
journey was never updated to send a version. Tests 13 and 14 sit in the order/payment path and
show a Prisma `clientVersion: 5.22.0` error surfacing from `lib/experience/payments.ts:329`
(`verifyOrderPayment`).

**Not fixed here, deliberately.** My 19 changed files touch none of these paths
(`git diff --name-only 77e35ce..HEAD` is entirely motion, experience/weight, docs and the workflow).
Repairing them means choosing between two contract changes — send a `draftVersion` from the journey
and keep the guard as designed, or reorder the route so the entitlement gate runs first — and both
touch the publish and payment contract, which is an owner decision. Guessing at payment behaviour
from a sandbox with no database would be the failure mode the guardrails exist to prevent.

`npm run test:e2e:pos` reported "(no output captured)" in the same run; its status is therefore
**not claimed** either way.

### What this changes about the release position

- Real database coverage for the Website Studio work now exists and passes: **1837 tests, 0
  skipped**, against `postgres:16` with migrations applied and plans seeded.
- The branch is **not** mergeable while the §66 journey is red. That is a pre-existing condition of
  the 11 unverified parent-branch commits, now made visible rather than hidden behind a
  misdiagnosed skip.
- The owner must decide the publish-contract question in tests 16/17, and whether tests 13/14 are a
  payment regression or a stale journey, before this can merge.
