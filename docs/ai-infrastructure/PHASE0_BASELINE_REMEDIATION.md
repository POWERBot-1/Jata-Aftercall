# PHASE 0 — ENGINEERING BASELINE REMEDIATION

**Branch:** `arena/84a3b550-jata-aftercall`
**Date:** 2026-11-22
**Scope:** remediate the pre-existing defects recorded in `11_ACCEPTANCE_REPORT.md` §1. No product behaviour changed.

---

## Result

| Gate | Before | After | Status |
|---|---|---|---|
| `tsc --noEmit` | exit 1, **5 errors** | exit **0**, 0 errors | **PASS** |
| `vitest run` (full) | 4,676 pass / **3 fail** / 343 skip | **4,690 pass / 0 fail** / 343 skip | **PASS** |
| Licence policy | did not exist | 11 tests, negative-controls verified | **PASS** |
| PostgreSQL suites | **NOT TESTED** (no DB, no engine) | **105 tests pass** on real PostgreSQL 16.2 | **PASS (partial — see §5)** |
| Security invariants | — | unchanged; the masked tenant-isolation assertion now actually executes | **PASS** |

---

## Task A — the three failing unit tests

### Root cause: clock-rotten fixtures, not a code defect

Both suites hardcoded an **absolute** subscription window. On the wall-clock date they lapsed:

| Suite | Fixture `graceUntil` | Rotted on |
|---|---|---|
| `autopilot-execution-rollback-isolation.test.ts` | `2026-11-13` | 2026-11-14 |
| `autopilot-phase1-hardening.test.ts` | `2026-11-17` | 2026-11-18 |

Once past `graceUntil`, `deriveAutopilotEntitlement` correctly returned not-entitled, and
`evaluateAutopilotActionPolicy` correctly refused with `ENTITLEMENT_REQUIRED`. The tests then failed
asserting behaviour that was never about dates.

**The production code was right. The tests were wrong, and they were wrong in a way that hid a
security assertion.**

`autopilot-phase1-hardening.test.ts` Priority 2 is a **cross-tenant isolation** test: it proposes a
FAQ action referencing `uq_foreign_b` (another tenant's question) and asserts execution is refused
with `FOREIGN_OR_MISSING_QUESTION`. Because execution was dying at the entitlement gate first, the
assertion compared `ENTITLEMENT_REQUIRED` to `FOREIGN_OR_MISSING_QUESTION` and failed. **The tenant
check it exists to protect had not actually been executed for two days.** That is the real cost of a
rotting fixture: not a red build, a blind security test.

### Corrective action

- Added `tests/helpers/testClock.ts` with `daysFromNow()` and `activeSubscriptionWindow()`.
- Replaced the absolute windows in both suites with `activeSubscriptionWindow()`.

This is **not** assertion-weakening. Every behavioural assertion is byte-identical. What changed is
that the fixture now expresses its actual intent ("a currently valid subscription") instead of
encoding a date that expires.

**Deliberately not done:** the fixture was *not* pinned to a fake clock. Pinning would have hidden
the genuine defect class — that these suites read the real clock while asserting time-independent
behaviour. Tests that *do* assert time behaviour (`Priority 4` expiry, quiet hours) already pass an
explicit `now` and were left untouched.

### Why the rot was limited to two files

Audited all hardcoded expiry dates under `tests/`. Most suites (`autopilot-entitlement-and-packs`,
`erp-entitlement`, `pos-entitlement`) pass an explicit `now`, so past fixture dates are *intentional*
inputs rather than latent breakage. Only the two files above combined a rotted fixture with a real
clock.

### Verification
```
tests/unit/autopilot-execution-rollback-isolation.test.ts   4 passed (was 3 passed | 1 failed)
tests/unit/autopilot-phase1-hardening.test.ts               6 passed (was 4 passed | 2 failed)
```

---

## Task B — the orphaned lifecycle store

### Investigation (not assumption)

| Question | Evidence |
|---|---|
| Is it referenced? | **No.** All 8 exports have **0** references across `app/`, `lib/`, `scripts/`, `tests/`. |
| Do the imports exist in this commit? | **No.** `git log --all` shows the two modules **never existed** in any commit on this branch's history. |
| Does the Prisma model exist? | **No.** `prisma.productLifecycleExecutionRun` is called but the model is absent (`grep` → 0). |
| Is it incomplete or historical? | **Neither — it is un-merged.**

### The decisive finding

The work lives on **open PR #142** (`arena/lifecycle-producer-contract-20261122`, a draft, `MERGEABLE`)
and PR #141. Those branches contain the complete workstream:

```
lib/admin/product-lifecycle-execution-ledger.ts      (the first missing module)
lib/admin/product-expiry-grace-observation.ts        (the second missing module)
lib/admin/product-lifecycle-payload-guard.ts
lib/admin/product-lifecycle-execution-store.ts       (a NEWER version than ours)
prisma/migrations/20261122000000_product_lifecycle_execution_ledger/migration.sql
app/api/cron/product-lifecycle-observer/route.ts
+ 5 unit suites, 1 integration suite, 5 operational docs
```

Every symbol `product-lifecycle-execution-store.ts` imports exists on that branch.

### Corrective action: delete the copy on this branch

`lib/admin/product-lifecycle-execution-store.ts` was committed to this branch **without its
dependencies**. It cannot be repaired here without inventing modules — explicitly forbidden — or
without pulling the schema migration, which instruction 11 and gate **G-1** forbid.

Deleting it:
- removes 2 typecheck errors;
- removes **no** functionality (nothing imported it);
- removes **no** test coverage (it has no tests on this branch; #142 brings their own);
- leaves #142 as the sole owner of the workstream, so there is no drift and no merge conflict.

**This is not a silent bypass.** Nothing is stubbed, mocked or suppressed. Git retains the file, and
`git revert` restores it in one command.

---

## Task C — the three Prisma typecheck errors

### Part 1: two of the three were NOT defects

Generated Prisma Client with the repository's own documented offline procedure
(`docs/agents/IMPLEMENTATION_STATUS.md:41`):

```
PRISMA_QUERY_ENGINE_LIBRARY=/usr/bin/true PRISMA_SCHEMA_ENGINE_BINARY=/usr/bin/true \
DATABASE_URL='postgresql://validation_only:validation_only@127.0.0.1:5432/validation_only?schema=public' \
npx prisma generate --no-engine
```

Afterwards `Prisma.dmmf` and `PrismaClientKnownRequestError` resolve. **No source change was
required** — the errors were symptoms of a client that had never been generated because
`binaries.prisma.sh` is unreachable from this sandbox. `BusinessUncheckedCreateInput` also resolved.

**No generated types were fabricated and no error was suppressed.**

### Part 2: the remaining two errors were real, and are Task B

Fixed by the deletion above, not by editing types.

---

## Task D — licence and blocked-dependency enforcement

Implemented `tests/unit/licence-policy.test.ts` (11 tests) plus `docs/ai-infrastructure/model-weights.json`.

| Test | Enforces |
|---|---|
| scans a non-trivial tree | the walker cannot silently return nothing (a policy test that inspects nothing always passes) |
| no forbidden licence | rejects AGPL, GPL-2/3, SSPL, BUSL, Sustainable Use, CC-BY-NC/NonCommercial, Coqui CPML, Commons Clause, Elastic |
| no blocked package | 17 named packages from `03` §2 (Dify, n8n, Open WebUI, Flowise, Weaviate, XTTS, F5-TTS, Piper-GPL, autogen, RVC…) |
| no UNKNOWN licence | an undeclared licence fails closed rather than passing |
| allowlist or recorded exception | every component licence must be allowlisted or carry a written position |
| MPL-2.0 stays unmodified | a vendored/patchted MPL file would trigger file-level copyleft |
| OpenPage attribution | licence text, copyright holder, permission grant, pinned commit `9818eb4`, and the "deliberately NOT imported" list all survive |
| weight provenance | every registered weight needs https source, pinned revision, 64-hex SHA-256, byte size, verification date, and an allowlisted commercial licence |

**The `weights` array is intentionally empty.** No weight has been downloaded, so no hash exists.
Registering a placeholder hash would be a fabricated integrity claim. Candidates live in a separate
`candidates` array with no integrity assertion.

### Negative controls (proving the gate fails when it should)

Injected two fake packages into `node_modules` — `n8n@1.0.0` ("Sustainable Use License") and
`some-tts-model@2.0.0` ("CC-BY-NC-4.0"). Result: **3 tests failed with precise diagnostics**
(`n8n@1.0.0 declares "Sustainable Use License" — internal/non-commercial only`). Both were removed and
the suite returned to 11/11 green. A gate whose failure branch has never executed is decoration.

---

## Task E — the PostgreSQL suites

The environment **can** run them, and this establishes which suites are genuinely runnable.

### Environment built (all disposable, all outside the repository)

| Piece | Detail |
|---|---|
| PostgreSQL | **16.2**, from the `pgserver` wheel, port 55432, data dir `/tmp/jatapg` |
| Migrations | **65/65 applied cleanly**, 194 tables in `public` |
| Prisma engine | native engine undownloadable (`binaries.prisma.sh` blocked) |
| Prisma WASM harness | `/tmp/harness` — client generated with `driverAdapters`, `query_engine_bg.wasm` present, WASM loader patched to instantiate the module in Node |

### Results

| Group | Suites | Tests | Status |
|---|---|---|---|
| Harness-compatible (`makeRealPrisma`) | **11 pass** | **105 pass** | **PASS** |
| Native-engine only (`lib/db.ts`) | 6 suites | 12 fail, 26 skip | **BLOCKED (environment)** |

The 11 passing suites include the ERP concurrency/approval/procurement/requisition/task suites and the
POS supplier-concurrency, snapshot-exclusion, provider-reversal and repayment-refund-race suites —
i.e. the transaction-boundary tests. **105 real database assertions executed for the first time in
this environment.**

### The 6 that cannot run here, and why

`ai-front-desk-entitlement`, `business-hub-loyalty-points`, `openpage-authenticated`,
`payment-wallet-refunds`, `payment-wallet-stk-receipt`, `pos-refund-race` all reach the database through
`lib/db.ts`, which constructs `new PrismaClient()` with **no adapter support**. Under the WASM harness it
fails with `Error validating datasource 'db': the URL must start with the protocol 'prisma://'` — an
engine-availability error, not a product failure. Making `lib/db.ts` adapter-aware is a **production
code change** and was not made.

### New finding: six DB suites were wired to nothing

No npm script and no CI workflow ran them:

```
UNWIRED: ai-front-desk-entitlement, business-hub-loyalty-points, openpage-authenticated,
         payment-wallet-refunds, payment-wallet-stk-receipt, pos-refund-race
         (website-studio × 3 are covered by the dedicated postgres config)
```

Added `npm run test:db:remaining` so they are runnable. **The workflow step is deliberately not added
here** — that is CI-surface change worth a separate review.

---

## Files changed

| File | Change |
|---|---|
| `tests/helpers/testClock.ts` | **new** — relative-date fixture helpers |
| `tests/unit/autopilot-execution-rollback-isolation.test.ts` | 1 import + fixture window |
| `tests/unit/autopilot-phase1-hardening.test.ts` | 1 import + fixture window |
| `tests/unit/licence-policy.test.ts` | **new** — 11 licence/provenance tests |
| `docs/ai-infrastructure/model-weights.json` | **new** — weight provenance registry |
| `lib/admin/product-lifecycle-execution-store.ts` | **deleted** — un-merged, owned by PR #142 |
| `package.json` | +1 script (`test:db:remaining`) |
| `docs/ai-infrastructure/PHASE0_BASELINE_REMEDIATION.md` | this document |

**No production code changed. No schema migration. No payment logic. No entitlement logic. No
deployment. No secret. No new dependency.**

---

## Security and regression implications

1. **Net security improvement.** A cross-tenant isolation assertion that had silently stopped
   executing now runs and passes. Priority 2's tenant-boundary test is live again.
2. **No invariant weakened.** No assertion was relaxed, deleted or skipped. The two edited fixtures
   changed only their dates; every `expect(...)` is unchanged.
3. **No suppression.** No `@ts-ignore`, no `as any` added, no test skipped, no stub module invented.
4. **Deletion is reversible and owns nothing.** `git revert` restores the orphan; PR #142 remains the
   single source for the workstream.
5. **Temp infrastructure was disposable.** PostgreSQL stopped; `/tmp/harness` and `/tmp/jatapg` are
   outside the repository and are not persisted.

---

## BLOCKED — exact action required

| # | Blocker | Exact unblocking action |
|---|---|---|
| B-1 | Native Prisma engine cannot be downloaded (`binaries.prisma.sh` unreachable) | Allow egress to `binaries.prisma.sh` in this sandbox, **or** run the 6 native-engine suites in CI (which has network). Until then they are BLOCKED, not failed. |
| B-2 | `lib/db.ts` has no adapter path, so the WASM harness cannot serve app-mediated DB tests | Owner decision: adopt `driverAdapters` + `@prisma/adapter-pg` as a **production** change. Not made here. |
| B-3 | Six DB suites are un-run in CI | Add `npm run test:db:remaining` to `.github/workflows/pos-erp-verify.yml` after the ERP step. Deliberately deferred as CI-surface change. |
| B-4 | Lifecycle workstream is un-merged | Review and merge **PR #142** (draft, MERGEABLE). It carries the migration, which is gate **G-1**. |

---

## Exact next task

**Phase L (remainder)** — the licence safeguards from Phase 0 Task D are done. What remains from
Phase L before Phase 1 can honestly start:

- **L.3** verify the OpenPage attribution test also pins the upstream *file list* (currently pins
  licence text + commit + refusal heading).
- **L.4** add a `THIRD_PARTY_NOTICES` generator so the Apache-2.0 / BSD / CC-BY attribution duty is
  discharged by a build artefact rather than by a policy note.

Then **Phase 1** — the dormant `lib/ai-infra/` skeleton with `AI_INFRA_ENABLED` defaulting off and a
test proving the flag-off path makes zero outbound calls and zero new database reads. That is safe,
reversible and needs no gate.
