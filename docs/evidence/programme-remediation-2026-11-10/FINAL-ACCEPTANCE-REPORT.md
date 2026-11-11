# PR #109 — consolidated acceptance evidence report

**Branch:** `arena/3ecfbb83-jata-aftercall` (PR #109 head: `arena/website-studio-openpage-cutover`)
**Report commit:** this commit; the acceptance evidence it cites is from head `c13634d`
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

### 3a-bis. Current head — the complete workflow picture

Measured, not summarised: `gh api .../commits/c13634d/check-runs` returns 21 check runs.

| Conclusion | Count | Which |
|---|---|---|
| **success** | 17 | Release Validation (incl. *Release gate (aggregate)*), *Migrations and PostgreSQL suite*, *Migrations + schema on PostgreSQL 18*, *Schema reconciliation proposal closes the drift*, *Exact candidate applies on disposable PostgreSQL 18*, *Production build path on PostgreSQL 18*, *Failure paths actually fail*, *Migration target guard*, *Static*, *Prisma, tenant tests, typecheck and production build*, *Schema, types, unit suite, build*, *full-suite*, *Journey against a real database*, *Real-Chrome six-viewport capture*, *D2 build/audit/controls*, *Vercel Preview Comments*, *instruction-integrity* |
| **failure** | 1 | `programme-completeness` — by design while 24 findings are open (§8) |
| **skipped** | 2 | `Read-only smoke` ×2 (production smoke, read-only, non-blocking) |
| **not usable** | 1 | Motion `capture` — stalled 37 min on an apt call, **fixed** in `4cbbdb4` (§3c) |

Per-workflow, with what each result actually proves:

| Workflow | Run | Head | Conclusion | Failed / skipped steps | What it proves |
|---|---|---|---|---|---|
| Release Validation | `43042978468` | `c13634d` | **success** | *Report diagnostics to the pull request* (skipped, diagnostic-only) | The candidate applies to a fresh PG18, reconciliation closes, negative controls really fail, and the aggregate gate passes. It does **not** prove product behaviour. |
| Interactive Business E2E | `43042978559` | `c13634d` | **success** | *Report failing output* (skipped) | The authenticated business journey works against a real PostgreSQL. Artifacts exist (`business-hub-journey…`, 7.3 MB) but are **unretrievable here** (§4.1). |
| Website Studio 2.0 | `43042978344` | `c13634d` | **success** | none (22/22 steps) | Authored acceptance **and** the prompt-to-website journey both ran, including `Validate Prisma schema` → **Prisma validation is green in CI**. The journey stubs authenticated API calls, so it proves the UI journey, not server truth. |
| POS / ERP — PRO verify | `43042978338` | `c13634d` | **success** | none | POS/ERP authorization, tenant isolation, migration expectations and the ledger guard suite on PostgreSQL. |
| Premium Screenshots | `43042978525` | `c13634d` | **success** | *Publish visual evidence into the session branch* (skipped — label-gated) | Real Chrome produced captures at six/seven viewports and both upload steps ran. It proves **capture happened**, not that anything in the images is acceptable — and the images are unretrievable here. |
| Motion isolated browser evidence | `43042978401` / re-run `43049628273` | `c13634d` / `4cbbdb4` | **stalled**, then **failure** | *Ensure video encoder* (**failed**: ffmpeg unavailable), *Capture classic and AI preview evidence* (**failed**: needs recordings) | On the re-run: 480/480 generated-family rows and 42/42 route rows observed, lite-mode and cancellation PASS, **6/6 viewport thumbnails published** — but **0/48 motion observations** and **0 recordings**, because no encoder exists on the runner (`spawnSync ffmpeg ENOENT`). Pixel evidence obtained; recording evidence NOT OBTAINED (§3c). |
| Admin instruction integrity | `43042978677` | `c13634d` | instruction-integrity **success**, programme-completeness **failure** | programme-completeness (by design) | The append-only register is intact and the gate still refuses to call 24 open findings green. |

### 3c. Why the Motion workflow produced no result, and the fix

At 15:31Z run `43042978401` had been `in_progress` since 14:57Z, with every setup step green and the
server up, sitting on **Ensure video encoder is available on the disposable runner**. That step ran an
unbounded `sudo apt-get update` inside a 50-minute job, so the budget went to one network call and the
three capture steps never started — no pass, no failure, no evidence.

`4cbbdb4` bounds it: 240 s per network call, an 8-minute step cap, an explicit
`::error title=MOTION_ENCODER_BLOCKED` instead of silence, and 15-minute caps on each capture step.

**That fix worked, and exposed the real reason the runner cannot record.** Run `43049628273`
(`4cbbdb4`) completed in ~20 minutes instead of hanging, and failed honestly:

| Signal | Value |
|---|---|
| `ffmpeg` install | **failed within the deadline** → `::error title=MOTION_ENCODER_BLOCKED::ffmpeg is unavailable and could not be installed within the deadline. No recording evidence is claimed for this head.` |
| Motion observations | **0 observed / 48 failed**, `recordingErrors: ["Error: spawnSync ffmpeg ENOENT"]` |
| Route behaviour | 42 rows, **0 errors**; 30 normal-motion rows pass, 12 lite rows pass, **`aiRowsPass: true`** |
| Generated families | **480 rows expected / 480 observed / 0 failures**, 0 provisioning errors |
| Repeated preference transitions | **PASS** (motion→lite→motion×, `renderMode` and `data-motion-reason` flip correctly each time) |
| Real reduced-motion cancellation | **PASS** — 4 animations started, 4 running → **0 running**, 1 disconnect, 4 cancel events |
| Thumbnails published | **6 of 6** viewports |

So the pixel and behavioural evidence *did* arrive; only the **video recordings** are missing, and they
are missing for an infrastructural reason (no encoder on the runner), not a product reason. The job is
still a **failure**, and `MOTION-*` findings are still open, because `row.result` requires a non-empty
recording per row. **Recordings: NOT OBTAINED, BLOCKED on ffmpeg availability.**

### 3b. Outstanding workflow, historical note

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

### 4.1a The sandbox has no browser at all (second, independent block)

Even with the artifacts in hand, **this environment cannot produce a fresh full-resolution capture**:
there is no Chrome/Chromium binary anywhere on the filesystem (`command -v google-chrome`,
`chromium`, `chromium-browser` all empty; no `ms-playwright` cache; no `puppeteer` browser download).
`puppeteer-core` is installed, but by design it needs an external `CHROME_PATH`.

Every measurement script in this repository is built to say so rather than pretend:

| Script | Behaviour without Chrome |
|---|---|
| `scripts/browser/actionbar-layout.check.mjs` | prints `BLOCKED / NOT RUN: set CHROME_PATH …` and **exit 2** |
| `scripts/browser/classic-sticky-gutter.check.mjs` | same contract, exit 2 |

Exit 2 is reserved for BLOCKED and can never be reported as a pass, so the geometry numbers in §5 come
from the CI runs that *did* have Chrome — never from a local run that silently skipped.

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

**How they were obtained, and why they are thumbnails by construction.** The images arrive as base64 in
check-run annotations (`MOTION_VISUAL_<w>x<h>_1_OF_1`, 2–3 KB each), which I decoded and inspected.
They are not the artifact files: `scripts/motion/disposable-browser-evidence.mjs` deliberately shrinks
each capture through CDP `Emulation.setDeviceMetricsOverride` until it fits GitHub's 10-annotation cap
per step, and the repository's own comment says so ("an image that cannot be published WHOLE is shrunk
(THUMBNAIL_TIERS) until it fits"). **The channel is thumbnail-only, which is exactly why it cannot be
used for visual acceptance.**

**Observations that survive at this scale:** the hero renders with a real photograph and headline at
every width; no blank or white-screen render; no visible horizontal overflow; the bottom action bar is
present with four controls at every width including 320; at 430×932 and 390×844 the trust/contact rows
and a long section stack cleanly; at 1366×768 the desktop two-column intent is clear. **Not observable
at this scale, therefore NOT TESTED:** text clipping, exact spacing and alignment, touch-target
dimensions, OpenPage editor visual quality, and any pixel-level comparison. **Visual acceptance is NOT
claimed.**

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
changed, because no defect was confirmed. The classic measurement was produced by
`classic-sticky-gutter.check.mjs` against `.jata-contact-actions--sticky` on the **classic**
`.jata-public` page; the storefront measurement by `actionbar-layout.check.mjs` against
`.eb-actionbar` on `/dev/motion-preview`. The first harness exists precisely because an earlier
thumbnail of the classic page was wrongly read as storefront evidence, and it says so in its header.

### 5a. The ledger guards were executed on a real PostgreSQL engine this cycle

Not a mock and not a parse check: the repository's own migrations
(`20250915000000_init` → `20261027000000_pos_erp_pro` → `20261127000001_ledger_immutability`) were
applied to PostgreSQL 17 (pglite) and the guards were then **attacked**. Measured results:

| Attempt | Result |
|---|---|
| Delete a journal that still has lines | **BLOCKED** — "still has lines and cannot be deleted" |
| Add a second line to a DRAFT journal | allowed (correct: drafts are editable) |
| Post the journal (DRAFT → POSTED) | allowed (correct lifecycle step) |
| Change a POSTED journal's number | **BLOCKED** — "immutable once POSTED: only reversal markers may change" |
| Move POSTED back to DRAFT | **BLOCKED** — "cannot return from POSTED to DRAFT; reverse it instead" |
| Delete a POSTED journal | **BLOCKED** — "posted journal cannot be deleted; reverse it instead" |
| Add a line to a POSTED journal | **BLOCKED** — "parent journal is POSTED" |
| `ErpJournalIntegrity` view | returns the sealed journal with `balanced=false`, `empty=false`, `lineCount=1` |

This is why the rollback rehearsal's recovery can re-install the guards safely (§7a): the only
pre-existing journal in that fixture is a DRAFT, and drafts are editable by design.

**Still NOT TESTED here:** the same guards on the pinned native Prisma engine / Neon, and the
`assertPeriodOpen` path against real `ErpPeriod` rows (the pglite suite covers the trigger bodies,
not period-close semantics).

---

## 6. Website Studio functional acceptance — status per requirement

**The journey now runs and passes in CI on this head.** Run `43042978344` (`c13634d`), job
*Prisma, tenant tests, typecheck and production build*, 22/22 steps, including
*Authenticated Website Studio browser acceptance* and *Prompt-to-website browser journey*. Artifacts:
`website-studio-2-0-acceptance…` (29,709 B) and `prompt-to-website-journey…` (2,618,746 B) — both
**unretrievable from this sandbox** (§4.1), so the run is verified from its check-run result and log
output, **not** from the screenshots.

**What the harness actually does, read from `scripts/browser/website-studio-openpage.check.mjs`:** it
loads `/dev/website-studio-preview` (which `notFound()`s in production), imports its deterministic
fixture, and then **intercepts and stubs every mutating API** — `understand`, `generate`, `refine`,
`experience`, `publish`. It throws if any browser console error occurs, and asserts exact counts and
strings.

| # | Requirement | Status | What the run proves | What it does not prove |
|---|---|---|---|---|
| 1 | New business starts from a prompt | **PASS (UI)** | A typed prompt reaches "What JATA understood" through the real page | Server-side understanding on a real database — the POST was stubbed |
| 2 | Existing business reopens its draft | **PARTIAL** | `hasExperience: true` is consumed and version 3→4 flows through the editor | No close/reopen cycle is performed; persistence is proven separately by the PostgreSQL draft-version suites |
| 3 | Three materially distinct layouts | **PASS (UI)** | Exactly 3 `[data-studio-preview]` cards render, and the run fails if not 3 | That the three are *materially* different — the fixture asserts that, the browser does not compare them |
| 4 | Photos and media retained | **PASS (UI)** | Hero (`grocery-1200.webp`) and gallery (`grocery-720.jpg`) URLs survive generation in every card | Real tenant media; these are repository fixture assets |
| 5 | Refinement saves and persists after reopen | **PARTIAL** | Refinement reaches "Draft saved (version 4)"; the PATCH stub returns `saved: true` | The save itself — the PATCH was answered by the harness, so the visible version number is not server truth |
| 6 | Desktop and mobile previews | **PASS (UI)** | Both preview modes are rendered and captured (`03`, `04`) | Visual quality of either mode — the images are unretrievable (§4.1) |
| 7 | Publication uses the guarded flow | **PASS (controls) / server-side separate** | The publish confirmation path is exercised and a `PUBLISHED` fixture is rendered | That a publication guard fired — the publish POST was stubbed. The guard itself is proven by the `studio-publication-state-machine-postgres` and payment-gated refusal suites |
| 8 | Legacy URLs redirect | **PASS (servers)** | `storefront-per-site-publication-postgres` + legacy route suites pass on this head | Nothing outstanding in this environment |
| 9 | Existing business tools accessible | **PASS** | Authenticated studio and Business Hub journeys pass in `43042978559` | — |
| 10 | Tenant isolation | **PASS** | Cross-tenant suites pass; `M418 DIAG XTENANT` positive controls recorded | — |

**Nothing was published to a live storefront.** The journey targets the dev preview route, which
`notFound()`s in production, with disposable fixtures and stubbed APIs; no customer site was touched.

**Honest total: 5 PASS, 2 PARTIAL (UI-only), 3 PASS on server truth — 0 of the 10 rests on a screenshot
this sandbox inspected.**

---

## 7. POS / ERP verification

**PASS on `c13634d`**, from four independent workflows rather than one aggregate green tick:

| Evidence | Head | Result |
|---|---|---|
| `POS / ERP - PRO verify` run `43042978338` | `c13634d` | **success** — schema, types, unit suite, production build, migrations and the PostgreSQL suites |
| *Migrations and PostgreSQL suite* check | `c13634d` | **success** (was failing all cycle; see §7a) |
| *Migrations + schema on PostgreSQL 18* / *Exact candidate applies on disposable PG18* | `c13634d` | **success** |
| *Real-Chrome six-viewport capture* (includes POS profile journeys, POS photo controls, ERP screens at seven viewports) | `c13634d` | **success** — the *capture* succeeded; the images are unretrievable here (§4.1) |
| Ledger guard behaviour | local, PostgreSQL 17 | independently attacked and confirmed (§5a) |

### 7a. What was actually wrong with the rollback rehearsal (four real defects, in order)

The check had been failing all cycle. Each fix moved the failure forward and exposed the next one,
which is why the diagnosis is trustworthy rather than a guess:

1. **Guards blocked the DDL.** `DROP TABLE` never fires row-level `BEFORE DELETE` triggers, but
   `ErpJournal_delete_guard` raises on *any* delete of a POSTED/REVERSED journal or one with lines,
   and `ErpJournalIntegrity` is a view, not a table. The rehearsal now asserts both are present, then
   removes them deliberately. Reordering the 48 tables could never have worked.
2. **Recovery left the safeguards off.** After dropping the guards, recovery re-applied only the seven
   ERP migrations, so a "recovered" database ran with **no** ledger immutability. Recovery now also
   re-applies `20261127000001` and `20261127000002`, and asserts 3 triggers, the view, and the
   `ErpJournalLine → ErpJournal` foreign key are back.
3. **Recovery aborted on an existing function.** `20261127000001` opens with a plain
   `CREATE FUNCTION` (no `IF NOT EXISTS`), so re-running it with the functions still installed fails
   with *"function erp_journal_line_guard() already exists"*. The teardown now drops the three
   functions as well as the triggers.
4. **The restore fired guards against a half-loaded database.** `pg_restore` loads tables in dump
   order; the line guard's `SELECT … FROM "ErpJournal"` ran before headers existed. The data-only
   restore now uses `--disable-triggers`, with its reason written into the script: the restore proves
   the **export** is complete and reloadable, while the guards are proven separately on proper data
   (§5a). No constraint, migration or ordering rule was weakened to obtain green.

Each failure now also emits a bounded `::error title=ERP_*::` annotation with the log tail, because
step logs are unreachable from this sandbox (§4.1) and a bare `FAIL` annotation cost several cycles.

- **Still not verified:** real POS hardware, real payment-provider settlement, ERP behaviour on
  production data, and period-close semantics. Those need provider and physical-device access this
  environment does not have, and are **NOT TESTED** — not passed.

---

## 8. Remaining programme findings (24, unchanged)

Readiness is **`NOT READY (24)`**, gate exit code **1**, re-executed on this head:

```
$ node scripts/admin/check-programme-readiness.mjs
NOT READY (24): ADMIN-005 BLOCKED, ADMIN-006 BLOCKED, ADMIN-007 BLOCKED, ADMIN-009 BLOCKED,
ADMIN-010 BLOCKED, MOTION-002 BLOCKED, MOTION-003 NOT_TESTED, ADMIN-013 BLOCKED, ADMIN-014 BLOCKED,
ADMIN-015 BLOCKED, MOTION-004 NOT_TESTED, MOTION-005 NOT_TESTED, MOTION-006 BLOCKED, MOTION-007 BLOCKED,
MOTION-008 BLOCKED, MOTION-011 BLOCKED, MOTION-012 BLOCKED, MOTION-013 BLOCKED, MOTION-014 BLOCKED,
MOTION-015 BLOCKED, MOTION-016 BLOCKED, MOTION-017 BLOCKED, MOTION-018 BLOCKED, RELEASE-001 BLOCKED
gate-exit=1
```

**No classification was changed**, because no new evidence closed a finding. The section the gate
reads (`scripts/admin/check-programme-readiness.mjs`, 36 lines) accepts exactly one passing status and
fails closed on everything else — it is not configurable, so it cannot be softened without an obvious
edit, and no such edit was made. CI's `programme-completeness` job fails on this same gate; **that
failure is the correct result and is preserved.**

This cycle added two pieces of evidence that move individual findings *without* closing them:
the prompt-to-website journey now runs in CI on this head (evidence towards MOTION-002), and the
ledger guards were executed and attacked on a real PostgreSQL engine (§5a, evidence towards
ADMIN-014's migration half). Neither satisfies its full acceptance.

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

Supporting evidence, not a summary impression. Items 1, 5 and 6 are unchanged and are the whole
reason; everything else on this list has moved from "broken" to "verified".

1. **The programme gate fails by design** — `NOT READY (24)`, exit 1, re-executed on this head (§8).
   Merging would bypass the only control that says the release is incomplete.
2. **Four owner decisions remain open** (§9), and three of them block findings outright.
3. **Visual acceptance is unproven.** Full-resolution artifacts are unreachable (§4.1), no browser
   exists in this sandbox (§4.1a), and only thumbnails were inspected — explicitly not acceptance.
4. **Website Studio is 5 PASS / 2 PARTIAL / 3 server-side PASS** (§6). The two PARTIALs are UI-only
   because the harness stubs the mutating API; that is a property of the harness, not a regression.
5. **18 of 24 findings need owner authorization** before anyone can close them (§8).
6. **The Motion workflow still has no result on this head** (§3c). Its 37-minute stall is fixed, but
   a stall fixed is not evidence obtained.

**What is now verified on `c13634d`** — all of it re-checked this cycle, none inferred:

| Area | Result |
|---|---|
| Release Validation incl. *Release gate (aggregate)* | **PASS** |
| `Migrations and PostgreSQL suite` (failing all cycle) | **PASS** — four real defects found and fixed, §7a |
| `Schema reconciliation proposal closes the drift` | **PASS** — 11/11, 0 skipped |
| Prisma schema validation (CI) | **PASS**, no bypass reintroduced |
| POS / ERP PRO verify | **PASS** |
| Interactive Business E2E | **PASS** |
| Website Studio 2.0 acceptance + prompt-to-website journey | **PASS** (22/22 steps) |
| Full no-database suite / Static / build / PG18 paths | **PASS** |
| Ledger immutability guards | **executed and attacked** on PostgreSQL 17, §5a |
| Classic `.jata-public` bar and storefront `.eb-actionbar` | measured **independently**, both sound, §5 |
| Production / Vercel | **untouched**, nothing deployed |

**Recommendation: hold the merge.** The engineering work in this cycle is complete: the two CI
failures this session was asked to target are green, and the one remaining red gate is the programme
gate the directive explicitly forbids weakening. The outstanding items are owner decisions and
verification access, not code. The single highest-value unblock remains **Decision #3**, which turns
ADMIN-010 and ADMIN-015 from permanently untestable into testable.
