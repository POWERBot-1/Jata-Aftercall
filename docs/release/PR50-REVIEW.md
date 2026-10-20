# PR #50 — review report

**PR:** [#50](https://github.com/POWERBot-1/Jata-Aftercall/pull/50) · head **`e2a12a1cb79965efffe7ca271bb0a46d3cf10ad5`** · base `main` @ `2575cf4…` · 15 files, `+2170/−0`
**Gate run:** `39508574563` on that exact head — **6/6 jobs success**
**Reviewer:** the author of PR #50. See §6.

---

## 1. Verified-good

| # | Claim | Evidence | Label |
|---|---|---|---|
| 1 | Passing workflow is bound to the current head | Run `39508574563` `head_sha` = `e2a12a1…` = PR head | **PASS** |
| 2 | 6/6 jobs green on that head | Job list via API | **PASS** |
| 3 | PostgreSQL 18 is the real server | `server_version=18.6 (Debian 18.6-1.pgdg13+2)` | **PASS** |
| 4 | Full migration history applies | 16/16, `Database schema is up to date!` | **PASS** |
| 5 | Re-running `migrate deploy` applies nothing | asserted by grep for `applying migration` | **PASS** |
| 6 | Ledger integrity checked | `verify-migrations.mjs` | **PASS** |
| 7 | Schema drift bounded | baseline exact-match; new **and** stale both fail | **PASS** |
| 8 | Reconciliation patch yields zero drift | job `schema-reconciliation-proposal` | **PASS** |
| 9 | Negative controls actually fail | 5 controls | **PASS** |
| 10 | Positive control proves the skip detector is not always-red | control 4 | **PASS** |
| 11 | Least privilege | `contents: read` workflow-wide; `pull-requests: write` only on the job that posts diagnostics | **PASS** |
| 12 | No secrets in the workflow | only a literal password for disposable service containers | **PASS** |
| 13 | Credential redaction in diagnostics | `.replaceAll('jata_ci_pw','[redacted]')` before posting | **PASS** |
| 14 | Prisma generation has an explicit blocker | `test -f node_modules/.prisma/client/index.js` | **PASS** |
| 15 | Typecheck and lint run and pass | in `static-checks` | **PASS** |
| 16 | Suites fail on any skip | `check-test-output.mjs`, exit 1 | **PASS** |

---

## 2. Defects

### D1 — `npm audit` aborts before the reporter can explain why · **Medium**

The step runs `npm audit --omit=dev --json > /tmp/audit-production.json` under GitHub's default `bash -e`. `npm audit` exits **1** when findings exist, so the step dies on that line and the carefully written `node` reporter — the one that prints `FAIL: N production advisories` — never executes.

Reproduced locally:

```
$ bash -e /tmp/t.sh     # npm() { return 1; }; npm audit ... ; echo REPORTER REACHED
step exit=1             # REPORTER REACHED never printed
```

**Impact:** fails closed (correct) but emits a bare exit code instead of the diagnostic. `/tmp/step-audit.log` would be empty exactly when it is most needed.
**Required change:** capture with `set +e`, record the status, then run the reporter — the same pattern already used for the full-audit branch two lines below.

### D2 — the required checks cannot run on PR #49 · **High (release-blocking by design)**

`release-validation.yml` is absent on `5996229`. Making its checks required before a rebase permanently blocks PR #49. Documented in `docs/release/MAIN-PROTECTION-PROPOSAL.md` §2.1; no code change belongs in PR #50.

### D3 — drift check leaks the credential into process arguments · **Low**

`npx prisma migrate diff --from-url "$DATABASE_URL"` (3 occurrences) places the full URL, password included, in `argv`, visible in `ps` on the runner. The runner is ephemeral and the password is a throwaway container credential, so the practical risk is negligible — but it is the same class of leak the workflow elsewhere goes out of its way to prevent.
**Required change:** none strictly; note it, or pass via a temp file / `PRISMA_MIGRATE_DIFF_FROM_URL` if Prisma supports it.

### D4 — Control 1 copies `node_modules` solely to delete it · **Low**

`cp -a . /tmp/broken` copies the whole workspace *including* `node_modules` (hundreds of MB), then `rm -rf /tmp/broken/node_modules` and symlinks it back. It works and it passed, but it is minutes of runner time and disk.
**Required change:** `tar --exclude=node_modules --exclude=.git -cf - . | (cd /tmp/broken && tar xf -)` or `git worktree`.

### D5 — placeholder `DATABASE_URL` in `static-checks` · **Low**

`postgresql://validation_only:…@127.0.0.1:5432/validation_only` exists only so `prisma validate` can resolve `env("DATABASE_URL")`. Nothing connects. The risk is future confusion: a later step that *does* connect would fail against `127.0.0.1` with a misleading message.
**Required change:** add a one-line comment at each *use* site, not only at the declaration. Documentation, not code.

### D6 — the gate is silent about the migrations it cannot see · **Medium**

`production-build` asserts `Migrations deployed successfully` from the log. On `main` there are 16 migrations and none of them is the pair PR #49 introduces, so the build job proves the *mechanism*, not *those* migrations. That is correct and unavoidable while the migrations live on another branch — but nothing in the output says so, and a green gate reads as "the migrations are fine".
**Required change:** print the applied-migration count and the last migration name in the job summary, so a reader can see which history was actually exercised.

### D7 — `scripts/ci/authorize-migration.mjs` is dead code until adopted · **Low**

It ships with 8 tests and is deliberately not wired into `build.sh`. A future reader may assume it enforces something.
**Required change:** the file header already says "NOT WIRED INTO THE BUILD"; add the same warning to the PR description so it survives review.

---

## 3. Failure behaviour when infrastructure is unavailable

| Scenario | Behaviour | Verdict |
|---|---|---|
| Prisma engine download blocked | explicit `BLOCKED:` and `exit 1` | **fails closed** |
| Advisory service unreachable | `BLOCKED: advisory service unavailable` | **fails closed** |
| Test log missing | `exit 2` | **fails closed** |
| Suite skips everything | `exit 1` | **fails closed** |
| `migrate diff` cannot run | `BLOCKED:` and `exit 1` | **fails closed** |
| A required job is `skipped` | aggregate treats it as non-success | **fails closed** |
| Drift baseline stale | `exit 1` | **fails closed** |

No path was found where an unavailable dependency is reported as a pass.

---

## 4. E2E evidence — preserved, both runs

| Run | Commit | Result | Duration | Note |
|---|---|---|---|---|
| `39505165608` | `a19a83f` | success | — | pre-gate commit |
| `39505559225` | `9ef3c08` | success | 9m37s | pre-gate commit |
| **`39505943097`** | **`47f5ed9`** | **failure** | **8m7s** | step 18, *Hydration 418 controlled race reproduction*; steps 19–27 **skipped** |
| `39508574479` | `e2a12a1` | success | 11m15s | |
| `39417262084` | `main`@`2575cf4` | success | — | |

**Correcting my own earlier reporting:** I quoted durations from `gh run view --json jobs`, which collapsed to the shorter job. The authoritative `/actions/runs/{id}/jobs` call shows the real figures above.

**Diagnosis, from source:** `scripts/browser/hydration-race.check.mjs` exits **1** *only* when `HYDRATION_RACE_ASSERT=clean` **and** `forced.errors418 > 0`. The CI step runs `npm run test:browser:hydration-race` → `node scripts/browser/hydration-race.check.mjs` and **does not set** `HYDRATION_RACE_ASSERT`. Therefore the step can only exit **0** or **2**; **2** is `main().catch(...)` — the harness could not run.

**Conclusion:** infrastructure failure, not a hydration regression. **Limitation:** the exact `BLOCKED / NOT RUN: <message>` line is in a runner log that this environment cannot fetch (`results-receiver.actions.githubusercontent.com` → `EOF`; artifacts host → `EOF`), so which of the three exit-2 causes it was — server startup timeout, browser launch, or bundling — is **NOT TESTED**.

**Structural weakness this exposes:** that step is a *reporting* harness masquerading as a gate. Without `HYDRATION_RACE_ASSERT=clean` it cannot fail on a regression, only on its own inability to start. Recommend setting the variable — a change to an inherited workflow, deliberately out of scope here.

---

## 5. Approval readiness

| Question | Answer |
|---|---|
| Defects found | 7 (1 High-by-design, 2 Medium, 4 Low) |
| Defects that block merging PR #50 | **None** — D1 is a diagnostics quality issue, not a fail-open |
| Recommended before merge | D1, D6 (both cheap; both improve what a red gate tells you) |
| Safe to leave as follow-ups | D3, D4, D5, D7 |

---

## 6. Limitation of this review

**I wrote PR #50.** This document is a self-review. It found real defects, which is evidence it was not purely defensive, but it is not the independent review the order asks for. `christine-kariuki` has `write` access and can provide it; PR #50 currently has **0 reviews**.
