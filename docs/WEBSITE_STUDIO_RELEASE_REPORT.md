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
| Implementation commit | `bc1bbdeb5b7eca06fa83bb0e2c1e3476daf98f95` — *"Website Studio: install motion and build the Stage 2 motion engine on it"* |
| Documentation commit | the commit that adds this file (SHA below, §8) |
| Branch URL | https://github.com/POWERBot-1/Jata-Aftercall/tree/arena/a9a473f2-jata-aftercall |
| Pull request | **not opened yet** — see §9 |
| Pushed and verified | **yes.** `git ls-remote origin refs/heads/arena/a9a473f2-jata-aftercall` returned `bc1bbdeb5b7eca06fa83bb0e2c1e3476daf98f95`, matching local HEAD at the time |
| Force-push / history rewrite | none. One new branch push (`* [new branch]`), no `--force` anywhere |
| Merged | **no** |
| Production deployed | **NOT DEPLOYED** |

No unrelated changes are on the branch. `git diff --stat` against the baseline is exactly the 13
implementation files plus these two documents.

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

## 3. Dependency change: `motion`

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
| Unit / integration / security | `npx vitest run` | **147 files passed, 10 skipped; 1769 tests passed, 94 skipped** (baseline at `77e35ce`: 146 files / 1740 tests, same 10 skipped files). +1 file, +29 tests, 0 new failures |
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
| Implementation commit (pushed, remote-verified) | `bc1bbdeb5b7eca06fa83bb0e2c1e3476daf98f95` |
| Documentation commit | see `git log --oneline -1` — this file is added in the commit immediately after `bc1bbde`; the remote branch SHA after that push is recorded in the next update of this section |

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
