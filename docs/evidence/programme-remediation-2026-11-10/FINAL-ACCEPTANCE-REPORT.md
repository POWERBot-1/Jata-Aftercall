# PR #109 — consolidated acceptance evidence report

**Branch:** `arena/3ecfbb83-jata-aftercall` (PR #109 head: `arena/website-studio-openpage-cutover`)
**Report commit:** `b292d4c`, amended below by `734b76c` (merge with `main`) and the follow-up below
**Date:** 2026-11-11
**Status:** **NOT READY** — see §11. Nothing was merged, deployed or released.

This report is the deliverable of the final acceptance directive. It separates what CI proves from
what only a human can accept, and it marks every gap BLOCKED or NOT TESTED rather than absorbing it
into a green summary.

---

## 1. What changed in this cycle, and why

| Commit | Change | Rationale |
|---|---|---|
| `6fa2a94` | `scripts/ci/retry-prisma-engine.mjs`; Release Validation routes `prisma validate`/`generate` through it; Typecheck recognises a missing client | The Release Validation failure was **environmental**, not a schema defect: `db76269` passed the identical step and `6858f27` failed it while changing only a markdown file. Reproduced locally: `binaries.prisma.sh` unreachable → network error from a valid schema. The wrapper retries **transport faults only**; `P1012` and parse errors still fail on the first attempt, unchanged. |
| `8a8ebe1` | Wired the prompt-to-website journey into CI | The script existed but was wired into **no workflow**, so the acceptance it describes had never run. |
| `4e52537` → `55ca0b8` → `271255e` → `8e0f4a3` | Iterated the journey job, then **deleted it** and moved the journey into the proven build+PostgreSQL job | Each standalone iteration failed on a *second* schema/build path (P1012 from unset datasource vars; then a placeholder `DATABASE_URL` making `scripts/build.sh` run a real migration). Duplicating a build next to a verified one was the wrong design and risked the journey validating a different artifact. |
| this commit | `OWNER-DECISIONS.md` recommendations; this report | Owner asked for recommendations and a consolidated evidence report. |

**No CSS, pricing, policy, schema, migration, payment, subscription or customer data was changed.**
`CONTROL_ROLE_ACCESS_ENABLED` remains `false as const`; no environment override was introduced.

---

## 2. Prisma validation result

**Resolved at CI level, without bypassing validation.**

| Evidence | Detail |
|---|---|
| Failing run | `42993375917`, SHA `6858f27`, job `Static (install, generate, lint, typecheck, audit)`, step *Validate Prisma schema and generate the client* |
| Control | `db76269` **passed** that identical step; the only difference between the two commits is one markdown file |
| Local reproduction | `prisma 5.22.0`, Node 22.22.3: `Error: request to https://binaries.prisma.sh/all_commits/6051973…/debian-openssl-3.0.x/libquery_engine.so.node.gz.sha256 failed, reason: Client network socket disconnected` |
| Prisma version / engine | `prisma 5.22.0`, `@prisma/client 5.22.0`, engine hash `6051973…`; the native query-engine library is fetched on a cache miss |
| Fix | `retry-prisma-engine.mjs` re-runs the **same** command; retryable class is transport only |
| Schema error behaviour | `P1012`, `P1001`, `P1003`, `P3009`, `Error validating`, `Error parsing` → **no retry**, first-attempt failure, original message and exit code preserved |
| Exhaustion behaviour | original exit code preserved + `::error::BLOCKED` annotation naming an infrastructure limitation |
| No bypass introduced | no `continue-on-error`, no `|| true`, no `if: false`; `tsconfig` still excludes only `node_modules` (pinned by tests) |
| Result | Release Validation **PASS**, including *Release gate (aggregate)*, on `6fa2a94` |

---

## 3. CI workflow results

All on head `6fa2a94` (the last commit with a full run of every workflow at time of writing; the
later commits re-run the same suites — see §3a for the outstanding one).

| Conclusion | Count | Notes |
|---|---|---|
| success | 19 | includes Release Validation, Release gate (aggregate), Journey against a real database, Static, Schema/typecheck/build, Real-Chrome six-viewport capture, Instruction integrity, Migration target guard, Production build path on PostgreSQL 18 |
| failure | 1 | `programme-completeness` — **fails by design** while 24 findings are open. Weakening it to obtain green CI is explicitly forbidden. |
| skipped | 2 | `Read-only smoke` ×2 (documented as read-only and non-blocking) |

### 3a. A pre-existing failure on `main`, inherited by this branch

`main` advanced to `0c53bee` (PR #80 merged) after this branch was cut, which made PR #109
`CONFLICTING`. Resolved in `734b76c`: a dry-run merge showed exactly one conflicted file,
`docs/release/EVIDENCE-MANIFEST.sha256` — a generated hash list. Hand-merging hashes is how a
manifest silently stops matching, so the base side was taken and the manifest regenerated from the
merged tree (69/69 PASS). **PR #109 is `MERGEABLE` again.**

After the merge, **one** job fails: `Migrations + schema on PostgreSQL 18`, step *Unit, integration
and security suites against PostgreSQL 18*.

**This is not caused by PR #109.** The same job fails on `main` at `0c53bee` in the **identical
step** (run `43009145558`). It appeared on `main` with the pglite/Prisma remediation commits
(`27cdb8e`, `08658d9`, `630ccbd`) merged after this branch was cut; `6fa2a94` on this branch passed
that job before the merge. Local reproduction of the failing test gives
`TypeError: Cannot read properties of undefined (reading 'datamodel')` from `Prisma.dmmf` in
`tests/unit/autopilot-phase1-hardening.test.ts:493` — the documented consequence of an ungenerated
Prisma Client, not a schema or migration defect. Migration steps in the same job **pass**:
`PASS: ledger and schema expectations match`, `No difference detected`, `Database schema is up to date!`.

**Deliberately not fixed here.** Repairing a `main` regression inside PR #109 would mix an unrelated
fix into a cutover review and risks touching migration baselines. It belongs in its own PR off
`main`.

### 3b. Outstanding workflow, stated plainly

The **Website Studio 2.0** workflow (`website-studio-2-0.yml`) did **not** produce a run for the
current head: its `pull_request.paths` filter matched the commit that *edited the workflow file*
(`271255e`), and no run has yet appeared for `8e0f4a3`. `workflow_dispatch` is refused by this
session's token (`403 Resource not accessible by integration`), so the run cannot be forced from
here, and the path filter has since been widened to include the journey's own wiring test
(`6fb49c6`) — but no run had appeared for the current head by the time of this report.

**Therefore: the Website Studio 2.0 workflow result for this head is NOT TESTED, not a pass.** The
last completed run of that workflow (`271255e`) failed only in the standalone journey job that has
since been deleted; its other steps passed.

---

## 4. Visual inspection — what was actually inspected

### 4.1 Retrieval attempt, with the exact limitation

| Artifact | Bytes | Result |
|---|---|---|
| `motion-partial-b9dd943…` | 29,698,027 | **BLOCKED** |
| `motion-families-b9dd943…` | 20,991,332 | **BLOCKED** |
| `motion-routes-b9dd943…` | 2,410,941 | **BLOCKED** |

All three fail identically:
`Get "https://productionresultssa31.blob.core.windows.net/actions-results/…": TLS/SSL connection has been closed (EOF)`.
Diagnostics performed this cycle, so the limitation is precise rather than assumed:

- DNS resolves the host (`20.209.113.193`).
- TCP 443 **is** reachable.
- `openssl s_client` completes the handshake (`Verify return code: 0 (ok)`).
- An HTTP GET over that same handshake returns **zero bytes**.
- `curl`, Python `urllib` and `gh` all fail at the same point.

Conclusion: an **egress allowlist** permits the connection and blocks the payload. This is a
sandbox-network limit, **not** a missing capability of the workflow, and it cannot be worked around
from here.

### 4.2 What was inspected (thumbnails, explicitly not acceptance)

Six viewport images were retrieved through the annotation channel and inspected. **Their measured
dimensions prove they are not native resolution**, so they are recorded as *partial* evidence only:

| Viewport | Actual pixels | Barely legible in the image |
|---|---|---|
| 320×568 | 100×178 | page frame intact, dark hero, CTA band, action bar with 4 controls |
| 360×800 | 90×200 | same |
| 390×844 | 100×216 | same, taller content |
| 430×932 | 100×217 | same |
| 768×1024 | 140×187 | two-column transition, hero left, media right |
| 1366×768 | 180×101 | desktop two-column, hero left, plates right |

**Observations that survive at this scale:** no blank or white-screen render; no visible horizontal
overflow; the bottom action bar is present with four controls at every width; layout intent is
discernible at desktop and tablet. **Not observable at this scale, therefore NOT TESTED:** text
clipping, exact spacing and alignment, touch-target dimensions, OpenPage editor visual quality, and
any pixel-level comparison. **Visual acceptance is NOT claimed.**

---

## 5. Action-bar geometry (measured, not eyeballed)

Two **independent** measurements — deliberately not conflated, as instructed.

### Classic `.jata-public` sticky bar (`.jata-contact-actions--sticky`)
Real Chrome, `deviceScaleFactor: 2`, CSS pixels (run `42988827162`):

| Width | first control | Share (last) | symmetry | min target | page overflow |
|---|---|---|---|---|---|
| 320 | 12 px | 12 px | 0 px | 46.08 px | 0 |
| 360 | 12 px | 12 px | 0 px | 46.08 px | 0 |
| 390 | 12 px | 12 px | 0 px | 46.08 px | 0 |
| 430 | 12 px | 12 px | 0 px | 46.08 px | 0 |

### Experience storefront `.eb-actionbar`
Real Chrome (run `130197190288`): `innermost=14.4px symmetry=0px pageOverflowX=0px` at
320/360/375/390/430 px.

**These validate different components.** Neither implies anything about the other. No CSS was
changed, because no defect was confirmed.

---

## 6. Website Studio functional acceptance — status per requirement

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | New business starts from a prompt | **Wired, unverified this cycle** | Journey drives `/dev/website-studio-preview`; run pending (§3a) |
| 2 | Existing business reopens its draft | **Wired, unverified** | Same journey; draft-version concurrency proven by PostgreSQL suites |
| 3 | Three materially distinct layouts | **Wired, unverified** | Journey asserts exactly 3 `[data-studio-preview]` cards |
| 4 | Photos and media retained | **Wired, unverified** | Journey asserts hero+gallery asset URLs survive generation |
| 5 | Refinement saves and persists after reopen | **Wired, unverified** | Journey asserts "Draft saved (version 4)"; persistence proven by `draft_version_conflict` suite |
| 6 | Desktop and mobile previews | **Wired, unverified** | Journey clicks the mobile preview control |
| 7 | Publication uses the guarded flow | **Proven (server side)** | `studio-publication-state-machine-postgres` + payment-gated refusal suites pass |
| 8 | Legacy URLs redirect | **Proven** | `storefront-per-site-publication-postgres` + legacy route suites pass |
| 9 | Existing business tools accessible | **Proven** | Authenticated studio + Business Hub journeys pass |
| 10 | Tenant isolation | **Proven** | Cross-tenant suites pass; `M418 DIAG XTENANT` positive controls recorded |

Items 7–10 are proven by PostgreSQL/vitest suites that ran and passed. Items 1–6 depend on the
browser journey whose run is outstanding (§3a) — the check itself **stubs authenticated API calls**,
so even when it passes it proves the UI journey and asset retention, **not** server truth. That
limitation is stated in the step name so it is visible on the checks list.

---

## 7. POS / ERP verification

- `Migrations and PostgreSQL suite`, `Prisma, tenant tests, typecheck and production build`,
  `Journey against a real database` — **PASS** on `6fa2a94`, which includes the POS journey and the
  ERP authorisation/tenant-isolation and task-board HTTP suites.
- **Not verified:** real POS hardware, real payment provider settlement, and ERP behaviour on
  production data. Those need provider and physical-device access this environment does not have,
  and are **NOT TESTED** — not passed.

---

## 8. Remaining programme findings (24, unchanged)

Readiness is **`NOT READY (24)`**, gate exit code **1**. **No classification was changed**, because
no new evidence closed a finding. The journey wiring added this cycle is evidence *towards*
MOTION-002 but does not by itself satisfy its acceptance.

| ID | Status | Evidence required | Evidence obtained | Remaining action | Owner auth? |
|---|---|---|---|---|---|
| **ADMIN-005** | BLOCKED | Six-viewport independent inspection; authoritative panels | Console reads authoritative rows; PII and MRR withheld by policy (OWNER-DECISIONS #1, #2). Six-viewport public/dashboard captures exist. | Owner answers #1 and #2; then implement panels and capture. | Yes |
| **ADMIN-006** | BLOCKED | Financial authority and verified payment | Read-only commission views plus a tested evaluator that ships no rate (OWNER-DECISIONS #4). | Owner answers #4 or re-scopes commission out of this release. | Yes |
| **ADMIN-007** | BLOCKED | Scope decision | Nothing implemented: no config, flag, kill-switch or service-health module exists. | Owner confirms scope; then implement. | Yes |
| **ADMIN-009** | BLOCKED | Authorized network position for headers/DNS/redirects | /control refuses anonymous visitors in CI; headers/DNS/redirect matrix unverifiable from this sandbox. | Run header/DNS/redirect checks from an authorized network position. | Yes |
| **ADMIN-010** | BLOCKED | Provisioned operator; ADMIN-005/007 closed | All-DENY policy returns 403 POLICY_PENDING in CI (deny path proven). Positive path impossible (OWNER-DECISIONS #3). | Owner authorizes #3; provision one operator in disposable CI. | Yes |
| **ADMIN-013** | BLOCKED | Approved commission policy | Synthetic engineering and the authenticated browser journey pass in CI. | Owner answers #4; then activation and reconciliation. | Yes |
| **ADMIN-014** | BLOCKED | Backup/restore and non-reversible-action rehearsal | Migration rehearsal on disposable PostgreSQL 18 passes on this head. | Add a backup/restore rehearsal against a disposable environment. | Yes |
| **ADMIN-015** | BLOCKED | Independent inspection of every console capture | Six-viewport captures for public, dashboard, ERP and the deny path; console positive path blocked by #3. | Owner authorizes #3; then inspect every console capture. | Yes |
| **MOTION-002** | BLOCKED | Studio generation/preview/publish on this head | Storefront inheritance covered; Studio paths now exercised by the prompt-to-website journey added this cycle. | Capture Studio generation/preview/publish; confirm the re-inheritance list. | Yes |
| **MOTION-003** | NOT_TESTED | Baseline screenshots for THIS head | Inventory and reuse plan only; earlier-commit artifacts are not retrievable and are not this head's baseline. | Retain a baseline for this head in a reachable channel. | No |
| **MOTION-004** | NOT_TESTED | Retained baseline comparison | Primitives, unit tests and real-Chrome family coverage pass. | Retain a baseline and compare rendered output. | No |
| **MOTION-005** | NOT_TESTED | Universal motion coverage inspection | Shared tokens and reduced-motion tests pass; universal claim deferred. | Complete page/chart/loading/transaction/Studio coverage. | No |
| **MOTION-006** | BLOCKED | Authenticated before/after recordings | No workflow in this repository produces recordings for these entrances. | Produce real recordings, or owner accepts screenshots explicitly. | Yes |
| **MOTION-007** | BLOCKED | Owner specification revision | Owner-provided specification is not in the repository. | Owner supplies the current specification revision. | Yes |
| **MOTION-008** | BLOCKED | Owner specification (register 032) | Owner-provided register 032; no agent may invent it. | Owner supplies the register 032 specification. | Yes |
| **MOTION-011** | BLOCKED | AI Front Desk renderer and coverage matrix | Not verified on this head. | Verify the AI Front Desk renderer on this head. | Yes |
| **MOTION-012** | BLOCKED | Enumerated family/route matrix | Real-Chrome workflows on disposable PostgreSQL exist. | Owner confirms the route enumeration. | Yes |
| **MOTION-013** | BLOCKED | Complete route matrix, inspectable | Visual-evidence channel exists but requires a branch rewrite. | Owner confirms the accepted capture set or authorizes a branch rewrite. | Yes |
| **MOTION-014** | BLOCKED | Independent inspection of the final-head capture | 6/6 thumbnails retrieved and inspected this cycle (100x178, 90x200, 100x216, 100x217, 140x187, 180x101). Full resolution BLOCKED at the artifact host. | Owner authorizes the visual-evidence channel, or explicitly accepts thumbnail scope. | No |
| **MOTION-015** | BLOCKED | Live motion behaviour proof | Queue/cancellation instrumentation exists; inspectable evidence blocked. | Produce inspectable queue/re-entry/cancellation evidence. | No |
| **MOTION-016** | BLOCKED | Spec plus historical baseline plus commerce coverage | Depends on MOTION-007/008 plus a baseline. | Owner supplies specification and baseline. | Yes |
| **MOTION-017** | BLOCKED | Genuine historical baseline | None available. | Owner supplies a historical baseline. | No |
| **MOTION-018** | BLOCKED | Queue/cleanup browser evidence | Clean reproducible suite passes on this head. | Produce queue/cleanup browser evidence. | No |
| **RELEASE-001** | BLOCKED | P0 domain/email verification and payment authority | P1 controls, tenant isolation and authenticated journeys evidenced in CI. | Owner authorizes each P0 action individually. | Yes |

### Totals by status

| Status | Count |
|---|---|
| BLOCKED | 21 |
| NOT_TESTED | 3 |
| PASS | 0 of the 24 (unchanged) |

**Owner authorization is required for 18 of the 24**; the remainder need a network position, a
reachable baseline channel, or recorded browser evidence this environment cannot produce.

---

## 9. Owner decisions still pending

All four remain **open**. Recommendations were added at the owner's request and are labelled as
recommendations; **nothing was implemented on the strength of one**.

| # | Decision | Recommendation offered | Implemented? |
|---|---|---|---|
| 1 | PII/financial visibility in the console | MASKED for business-scoped grants; VISIBLE only for platform grants carrying explicit `payments.read`/`audit.read` | **No** |
| 2 | MRR/ARR definition | 30-day normalised `Σ(priceKES × 30 / durationDays)` over ACTIVE, labelled, plus a separate cash-collected figure | **No** |
| 3 | `CONTROL_ROLE_ACCESS_ENABLED` activation | Yes, narrowly: compile-time test seam gated to the disposable harness; **no runtime env override** | **No — constant untouched** |
| 4 | Commission policy | Scope out of this release; keep the evaluator dormant | **No — no rate invented** |

---

## 10. Vercel and production state

- Production deployment **unchanged**: `dpl_HvtDkkz4TXnEFnQXaCfoatrftJ8d`, `READY`, built from
  `main` @ `0f22ec7` (PR #108). Verified via the Vercel connector this cycle.
- No deployment was created, promoted or rolled back. Nothing from this branch shipped.
- No production SQL, migration, payment, subscription or customer-data mutation was performed.

---

## 11. Explicit merge readiness

# NOT READY

Supporting evidence, not a summary impression:

1. **Programme gate fails by design** — `NOT READY (24)`, exit 1. Merging would bypass it.
2. **Four owner decisions are open**, and three of them block findings outright.
3. **Visual acceptance is unproven** — full-resolution artifacts are unreachable (§4.1); only
   thumbnails were inspected, and they are explicitly not acceptance.
4. **Website Studio items 1–6 are unverified** — the journey step is wired but its run is
   outstanding (§3a), and it stubs the authenticated API.
5. **18 of 24 findings need owner authorization** before anyone can close them.
6. **One job fails, and it fails on `main` too** — `Migrations + schema on PostgreSQL 18` /
   *Unit, integration and security suites*, reproduced from an ungenerated Prisma Client
   (`Prisma.dmmf` undefined). Inherited, not introduced, but a red gate is a red gate until it is
   fixed on its own branch.
7. **Website Studio 2.0 has no result for this head** (§3b) — NOT TESTED.

What *is* verified: Release Validation (including the aggregate gate) passes; Prisma validation is
fixed without bypass; the schema, migrations, tenant-isolation, publication, POS and ERP suites pass;
both action bars are measured and sound; production is untouched.

**Recommendation: hold the merge.** The engineering work in this cycle is complete and reviewed; the
remaining blockers are owner decisions and verification access, not code. The single highest-value
unblock is **Decision #3**, which converts ADMIN-010/ADMIN-015 from permanently untestable into
testable.
