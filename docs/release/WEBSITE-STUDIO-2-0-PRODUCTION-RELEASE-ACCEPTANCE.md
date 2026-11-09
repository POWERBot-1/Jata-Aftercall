# Website Studio 2.0 — production release acceptance record

- **Feature:** Website Studio 2.0 — per-site publication cutover, publication history and rollback
- **Owner / release authority:** Gitanya Kariuki
- **Recorded:** 2026-11-09 (UTC)
- **Status:** RELEASED — merged and deployed; recorded after the fact from reproducible evidence.

This record exists so that the release claim can be checked rather than believed. Every result
below is a command that anyone with the same repository can run again. Nothing here is a
transcription of a log that cannot be regenerated.

---

## 1. Exact commits

| Role | SHA |
| --- | --- |
| Base of the release branch | `8a59ecf912838109d1844fc86e60db9c19bbc6d1` (`main` before the release) |
| **Verified candidate** (feature branch head) | `2b16787cde1646deb7d7d333c94a90f034f180ff` |
| **Merge commit** (now `main`) | `42d8c94c7bef060b9914fd38bb35bf8b17452aa7` |

The merge commit's second parent is exactly the verified candidate, and the two trees are
identical — so the deployed code is the code that passed the checks:

```bash
git merge-base --is-ancestor 2b16787c 42d8c94c && echo "candidate is an ancestor of main"
git rev-parse 2b16787c^{tree} 42d8c94c^{tree}     # both: 8fb084a88a38bbf8535f76716ad21560ab2eb653
git diff 2b16787c 42d8c94c                        # empty
```

- Pull request: https://github.com/POWERBot-1/Jata-Aftercall/pull/104 (merged 2026-11-09T21:52:31Z)
- Merge method: ordinary merge commit. No force-merge, no check bypassed, no required check
  converted to optional.

## 2. Remote CI — GitHub Actions on the verified candidate `2b16787c`

Required contexts per the `main-protection` ruleset (id `25548981`):

| Required context | Result |
| --- | --- |
| Release gate (aggregate) | success |
| Migration target guard | success |
| Journey against a real database | success |

Full rollup on `2b16787c` (run `42703741548`): **18 success, 1 skipped, 1 failure**. Notable
successes: `instruction-integrity`, `Migrations and PostgreSQL suite`, `Exact candidate applies
on disposable PostgreSQL 18`, `Production build path on PostgreSQL 18`, `D2 — build, audit and
controls on the candidate tree`, `Real-Chrome six-viewport capture on a disposable database`.

The single failure is `programme-completeness` and it is **not** a required context. It reports
`NOT READY (24)` — the records listed in §5 — and it fails identically on the pre-release `main`
head `8a59ecf9`. It is a pre-existing condition of the target branch, not a regression introduced
by this release, and it is deliberately **not** hidden, reclassified or made optional.

## 3. Local verification — run on the merged commit `42d8c94c`

Environment: Linux sandbox, Node.js v22.22.3, PostgreSQL 16 created fresh for the run, migrations
replayed from the complete committed history, Chromium 153.0.8010.0.

`binaries.prisma.sh` is outside this environment's egress allowlist, so the query engine ran as
Prisma's own WebAssembly engine via `@prisma/adapter-pg`, generated from the committed schema by
`scripts/erp/build-wasm-harness.sh`. It is the same Prisma query engine, not a mock — but it is
**not** the pinned native engine. Native-engine coverage is provided by CI, not by this section.

| Check | Command | Result |
| --- | --- | --- |
| Authenticated Studio browser gate | `npm run test:browser:studio-authenticated` | **530 passed, 0 failed, 0 skipped** |
| Hydration gate | (inside the same run) | `required=15 ok=15 failed=0 unresolved=0 missing=0 malformed=0 auxiliary=66 duplicates=0` |
| Motion/interaction gate | (inside the same run) | `M418 GATE PASS: all required samples and checks passed` |
| Website Studio PostgreSQL suites | `WEBSITE_STUDIO_POSTGRES_TESTS=1 npx vitest run --config vitest.website-studio-postgres.config.ts` | **39/39 passed** (4 files) |
| Full unit/integration suite | `npx vitest run` | 4741 passed, 3 failed (see §4) |
| Typecheck | `npx tsc --noEmit` | clean |
| Production build | `npm run build` | completed successfully |
| Instruction integrity | `node scripts/admin/check-building-instructions.mjs --ci` | `PASS: 45 sequential requirements; 4 committed revision(s); first working tree committed` |
| Instruction fixtures | `node --test scripts/admin/tests/instruction-integrity.test.mjs` | 7 pass, 0 fail |
| Evidence manifest | `node scripts/ci/verify-evidence-manifest.mjs` | `PASS: 68 artifacts match the manifest` |

## 4. The 3 local failures are pre-existing, proven rather than asserted

| Failing test | Cause |
| --- | --- |
| `tests/prisma/control-plane-foundation-postgres.test.ts` — persists an event … | `ControlAuditEvent_actorId_fkey` foreign-key violation |
| `tests/prisma/control-plane-foundation-postgres.test.ts` — rolls back an application-helper event … | same FK path |
| `tests/unit/autopilot-phase1-hardening.test.ts` — Priority 1 DMMF parity | `Prisma.dmmf is not available …` |

Both files are untouched by this release. Run in a clean `git worktree` of the **pre-release**
`main` (`8a59ecf`) against the same database and harness, they fail with the same 3 failures
(`Test Files 2 failed (2) | Tests 3 failed | 7 passed (10)`). They are harness/DMMF
environmental limitations, not defects in this change, and no assertion was relaxed to obtain
this result.

## 5. Deliberately open items

These are open, they are stated as open, and they are **not** covered by the release claim.

| Item | Reason | Status |
| --- | --- | --- |
| `programme-completeness` (24 records) | `ADMIN-005, 006, 007, 009, 010, 013, 014, 015`; `MOTION-002…008, 011–018`; `RELEASE-001` are blocked on owner decisions, provider configuration or physical-device acceptance. The checker fails closed and has no deferral path. | **BLOCKED** — open on `main` before and after this release |
| Cloudflare R2 media persistence | No `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` or bucket in any environment available to this work. | **BLOCKED** — credentials not fabricated, no charges made |
| Native Prisma engine locally | Engine download host outside the egress allowlist. | **BLOCKED locally** — covered by CI |
| `check-website-studio-readiness.mjs --phase=p2` (20 rows) | Rows cite evidence commit `8776ad90`, which is not an ancestor of `main`. Pre-existing; orthogonal to this release. | **BLOCKED** — pre-existing |
| Public content cutover (`public-content-cutover`) | `DEFERRED` by explicit decision: this release ships the multi-site data plane; public rendering stays on `BusinessExperience` pending a separately reviewed migration. | **DEFERRED** |

## 6. Production deployment and independent domain verification

| Fact | Value |
| --- | --- |
| Vercel project | `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`), team `team_azd5tt6fZ2mt1v6Op6s5iJHv` |
| Production deployment | `dpl_BuDFgGbm1VT2v4gs7Xa4Q7YExbrL` |
| Deployment state | `READY`, `readySubstate: PROMOTED`, `aliasAssigned`, `isRollbackCandidate: true` |
| Commit deployed | `42d8c94c7bef060b9914fd38bb35bf8b17452aa7` (`gitSource.sha`), branch `main` |
| Aliases | `jataaftercall.co.ke`, `www.jataaftercall.co.ke`, `jata-aftercall.vercel.app` |

Verified from outside the build system, over the public internet, after promotion:

| Check | Result |
| --- | --- |
| `https://jataaftercall.co.ke/health` | `{"status":"ok","db":"up","version":"1.0.0"}` — real database reachable |
| `https://www.jataaftercall.co.ke/health` | identical payload, same timestamp |
| `https://jataaftercall.co.ke/` | landing page renders: theme chooser, hero, demo band, pricing FAQ |
| `https://www.jataaftercall.co.ke/` | renders the same landing page |
| `https://jataaftercall.co.ke/b/nyumbani-kitchen` | default public storefront renders with services, offer, contact actions, loyalty section |
| `https://jataaftercall.co.ke/b/nyumbani-kitchen/no-such-site-xyz` | **404** "This business page isn't available" — the new per-site route refuses, it does **not** fall back to the tenant's default site |
| JSON API routes (`/api/studio/websites/publish`, `/rollback`) | routed, respond empty without Studio authentication |

The 404 result is the security-relevant one: it shows the per-site route is live on production and
that it fails closed to "not found" rather than serving one site's content on another site's URL.

Write-path behaviours (publish, unpublish, rollback, history, stale-write rejection) are verified
in §3 by the authenticated browser gate and the PostgreSQL suites against a disposable database.
They were **not** exercised against production data: no production mutation was performed to
prove them, by design.

## 7. Rollback

The release is reversible without touching the database:

1. In Vercel, promote the previous production deployment
   `dpl_2AkjhsUcBtFTkTfoMRZ4WLEtvnHW` (`8a59ecf`), or revert the merge commit and let the normal
   `main` pipeline redeploy.
2. The per-site schema added in this release is additive. No migration is destructive, and the
   legacy `BusinessExperience` rendering path remains in place — which is exactly why the public
   content cutover could be deferred without leaving the product in a half-migrated state.

## 8. Reproduce this record

```bash
# 0. exact tree
git checkout 42d8c94c
git rev-parse 2b16787c^{tree} 42d8c94c^{tree}   # must print the same hash twice

# 1. gates that need no database
node scripts/admin/check-building-instructions.mjs --ci
node scripts/ci/verify-evidence-manifest.mjs
npx tsc --noEmit

# 2. disposable PostgreSQL + WASM engine + Chromium
bash scripts/dev/local-verify-env.sh && bash scripts/dev/local-chromium.sh
npm ci
source /tmp/jata-local.env
DEMO_FIXTURE_PASSWORD="$(openssl rand -base64 48)" npm run seed
npm run build && APPLY_SHIM=1 bash scripts/dev/local-verify-env.sh
unset PRISMA_QUERY_ENGINE_LIBRARY PRISMA_SCHEMA_ENGINE_BINARY PRISMA_WASM_HARNESS_DIR
npm run test:browser:studio-authenticated          # expect: 530 passed, 0 failed

# 3. real-database suites
WEBSITE_STUDIO_POSTGRES_TESTS=1 npx vitest run --config vitest.website-studio-postgres.config.ts

# 4. public production routes
curl -s https://jataaftercall.co.ke/health
curl -s https://www.jataaftercall.co.ke/health
```

## 9. What this record does not claim

- It does not claim the programme is complete: 24 `programme-completeness` records remain open.
- It does not claim native-engine Prisma coverage from the local runs; CI covers that.
- It does not claim R2 media persistence, which is blocked on missing credentials.
- It does not claim physical-device (Android) acceptance, or provider-side payment proof. The
  authenticated gate uses synthetic entitlement on a disposable database and says so in its own
  output.
- It does not claim the public content cutover shipped; that was explicitly deferred.
