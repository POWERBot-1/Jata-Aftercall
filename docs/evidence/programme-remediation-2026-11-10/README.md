# Programme completeness remediation — finding classification and disposition

**Date:** 2026-11-10
**Branch:** `arena/3ecfbb83-jata-aftercall`
**PR:** #109 `arena/website-studio-openpage-cutover` — **OPEN, UNMERGED, base `main`**
**Starting head (dispatched):** `13a5d38e2184a537f9a8e352eed1ade73dcb8d2a`
**Commits added in this cycle:** `4828463`, `66d53b8`

---

## 0. Method

This cycle began by reading the authoritative register, not the failure list. For every one of the
24 findings the following were inspected before any change:

1. The canonical owner requirement in `docs/ADMIN_BUILDING_INSTRUCTIONS.md` (§005–§043).
2. The readiness row in `docs/agents/PROGRAMME_READINESS.json` — status, `testResult`, `blocker`,
   `verificationMethod`, `verificationCommit`, evidence arrays.
3. The code, workflow or document the requirement names (`implementationLocation`).
4. What evidence the requirement demands that does not yet exist.

Findings are classified as directed: **ENGINEERING-REMEDIABLE**, **OWNER-DECISION-REQUIRED**,
**EXTERNAL-DEPENDENCY** or **NOT-TESTED**. A finding is only ENGINEERING-REMEDIABLE when the missing
thing is code, test or evidence machinery — not when the missing thing is a decision, a credential
or a provider action.

**Nothing was marked PASS.** The register is unchanged: `NOT READY (24)` before and after this cycle,
by design. Section 5 explains why every remaining row stays non-PASS.

---

## 1. The gate failure that *was* engineering — and is now fixed

`release-validation.yml` → `Static (install, generate, lint, typecheck, audit)` had **one** failing
step: `The evidence manifest verifies`.

- **Root cause:** commits `117203a` and `13a5d38` edited `docs/agents/PROGRAMME_READINESS.json`
  (adding the RELEASE-004 record) without regenerating `docs/release/EVIDENCE-MANIFEST.sha256`.
  The manifest covers that file, so its recorded digest
  `ddd7731e…a0b7` no longer matched the actual `ea2e4d73…fe7b0`.
- **Not a gate weakening.** `verify-evidence-manifest.mjs` compares the manifest to the files; it
  refuses a mismatch. The artefact changed, the manifest was stale, the check correctly failed.
- **Fix (`4828463`):** regenerate the manifest. The diff is exactly one line. No artifact content,
  register status, acceptance text or gate was touched.
- **Proof:** `node scripts/ci/verify-evidence-manifest.mjs` → exit 0, `PASS: 69 artifacts match`;
  `generate-evidence-manifest.mjs --check` → exit 0.

The first exact-head CI run after the push, at `4828463`, therefore returns:

| Check | Result |
|---|---|
| Static (install, generate, lint, typecheck, audit) | **pass** |
| Release gate (aggregate) | **pass** |
| Journey against a real database | **pass** |
| Real-Chrome six-viewport capture on a disposable database | **pass** |
| Prisma, tenant tests, typecheck and production build | **pass** |
| Migrations + schema on PostgreSQL 18 | **pass** |
| Exact candidate applies on disposable PostgreSQL 18 | **pass** |
| Production build path on PostgreSQL 18 | **pass** |
| Schema reconciliation proposal closes the drift | **pass** |
| Failure paths actually fail | **pass** |
| Migration target guard | **pass** |
| full-suite | **pass** |
| instruction-integrity | **pass** |
| programme-completeness | **fail (24)** — unchanged and intended |

**19 checks: 17 pass, 1 fail, 1 skipped (`Read-only smoke`, by design on a PR).** The
`programme-completeness` failure is the truthful state of the register, not a defect to be cleared.

---

## 2. The motion evidence channel was broken — found, fixed and proven

While inspecting what the "Real-Chrome six-viewport capture" job actually produced, the six-viewport
pixel evidence turned out to be **substantially missing**. This is the one place where an acceptance
requirement was reporting success while the evidence it depends on did not exist.

### What was measured, not assumed

Check run **130128893526** (`capture` in `motion-evidence.yml`) publishes viewport thumbnails as check
annotations because the artifact blob host is unreachable here. Reassembling them:

| Viewport | Published | Result |
|---|---|---|
| 320×568 | 8 of 8 parts | **complete 16,268-byte JPEG** |
| 360×800 | 2 of **11** parts | truncated |
| 390×844 | none | never published |
| 430×932 | none | never published |
| 768×1024 | none | never published |
| 1366×768 | none | never published |

**1 of the 6 mandated viewports had inspectable pixel evidence.** Two independent defects:

1. **Annotation-budget overflow.** The emitter chunked a full-size JPEG into ~3000-character parts with
   no total accounting: 8 parts for 320×568, 11 for 360×800. Check run 130128893526 retained **16**
   annotations totalling **~29,824 characters**; the budget was exhausted inside the second image and
   the remaining four viewports were dropped entirely. An earlier note in this document said "GitHub
   keeps 10 annotations per check run" — that was **wrong**, produced by reading the default
   10-item API page and mistaking it for the limit. The observed constraint is a ~30,000-character
   budget per check run plus GitHub's documented 4096-byte per-annotation limit.
2. **No completeness check.** Nothing verified the reassembled bytes were a whole image, so a
   truncated stream was indistinguishable from a published one until someone tried to open it.

### The fix (`66d53b8`)

- `scripts/motion/visual-annotation.mjs` — a unit-tested policy module: chunking, a per-viewport
  budget derived from the real cap, an ordered thumbnail ladder, and a decoder that **refuses any
  stream without a JPEG SOI/EOI** rather than returning a plausible short prefix.
- `scripts/motion/disposable-browser-evidence.mjs` — shrink the thumbnail *per viewport* until the
  **whole** image fits its budget, instead of chunking a full-size capture into the cap.
- `scripts/motion/retrieve-visual-evidence.mjs` — materialise all six viewports and report a
  truncation or a missing viewport as a **failure**, never as a saved corrupt file.

### Proof the fix works — and its measured limit

Measured against the real caps (`MAX_ANNOTATIONS_PER_CHECK = 10`, 3500-char parts), and then against a
**real** storefront capture rather than a synthetic target (photographic hero, 16,268 bytes at 320 px):

```
w=240 q=40 -> 14732B  b64=19644  does not fit
w=160 q=22 ->  5103B  b64= 6804  does not fit
w=120 q=18 ->  2639B  b64= 3520  does not fit
w=100 q=16 ->  1842B  b64= 2456  FITS: 1 part, complete JPEG
```

**The first two versions of this fix published nothing, and each failure was caught rather than
shipped.**

- At `14d4fe4` (check run `130143153630`) the run emitted **zero** `MOTION_VISUAL_*` annotations: a
  one-part budget is tight for a photographic page, and the ladder ended at 100 px. The new retrieval
  script reported `BLOCKED`.
- At `6eb1009` (check run `130152615805`) the run emitted six explicit
  `::error MOTION_VISUAL_MISSING_<viewport>` failures for the same reason — and revealed the actual
  bug: **the tier loop never used the tier width**, it only lowered JPEG `quality`, so every "tier" was
  the same full pixel size and could never fit. The `quality`-only screenshots were 10,868–35,479 bytes.
- At `b9ecbe7` (check run `130159647906`) the run again emitted six `MOTION_VISUAL_MISSING_*` errors,
  and the byte sizes gave the third and final cause: **`page.screenshot` re-applies Puppeteer's own
  tracked viewport and silently undoes a CDP metrics override**. 1366×768 stayed ~35,400 bytes at
  every tier; the downscale never reached the encoder.
- **Current code (`b9dd943`, check run `130167430117`): 6/6 viewports published and retrieved as
  complete JPEGs**, one annotation each (2,053–2,598 bytes), 7 viewports-worth of annotations total,
  well inside the budget.** Inspected: 320×568 and 1366×768 both show the real Nyumbani Kitchen
  storefront with the fictional-demo disclosure banner, the restaurant hero and headline, the sample
  offer block and the graphite/lime action bar — mobile and desktop layouts both intact, no clipping
  or overflow visible at this scale.
- Implementation: capture through **CDP `Page.captureScreenshot`** after
  `Emulation.setDeviceMetricsOverride`, so the downscale actually lands, restore the original metrics
  after the loop, and record every tier's byte size in the row. If two consecutive tiers produce
  identical bytes the run reports `the browser ignored the downscale (tier byte sizes: …)` instead of
  looping ten no-ops and calling the budget "too tight". Verified against the real capture: 240→120 px
  do not fit, 100 px fits in one annotation as a complete JPEG. `sharp` was deliberately **not** used —
  it is only a transitive dependency of Next.js, and importing it in CI would depend on a package the
  repository does not declare.
- Silence was made a failure. A viewport that publishes nothing emits `::error`, because "published
  nothing" and "published fine" looked identical, and that ambiguity is what hid the original defect
  for an entire cycle.

### The limit this fix does NOT remove

At 100 px the published image is enough to prove *layout and colour* — the demo disclosure banner, the
restaurant brand identity, the sample offer block, and the graphite/lime action bar are all legible —
but it is **not review-grade**. Type and icons are no longer resolvable, so it cannot satisfy
MOTION-015's "independently inspected six-viewport" criterion on its own. That criterion needs a
full-resolution channel, and the repository already has one: `premium-screenshots.yml` commits
full-page PNGs to the branch when the PR carries the `visual-evidence` label. This cycle did not add
that label, because it changes the branch under review and is the owner's call.

### What this does NOT do

Retrieving pixels accepts nothing. `MOTION-012`, `-015`, `-017` and `-018` demand *independently
inspected* six-viewport evidence and before/after recordings; materialising six images is the
precondition for that review, not the review. Those rows stay non-PASS.

**Observed while inspecting (recorded, not fixed):** in the 320×568 capture the `Share` action sits
directly against the right edge with no visible gutter, unlike WhatsApp/Call/Directions. The
published thumbnail is 320 px wide at low quality, so this must be confirmed at native resolution
before any layout change — a blind fix to a measured-looking defect in a downscaled JPEG would be
exactly the kind of unevidenced change this programme forbids.

---

## 3. Classification of all 24 findings

Legend: **E** = ENGINEERING-REMEDIABLE · **O** = OWNER-DECISION-REQUIRED · **X** =
EXTERNAL-DEPENDENCY · **NT** = NOT-TESTED (evidence requires an environment this sandbox cannot provide)

| ID | Class | Requirement, in the owner's terms | What exists | What is genuinely missing |
|---|---|---|---|---|
| ADMIN-005 | O | Operational overview: business/customer/merchant/agent, hierarchy, payment, **MRR/ARR**, subscription, trial, usage, AI, system, incident metrics; search, suspend/reinstate with reasons and audit | `app/api/control/overview`, `businesses`, `records`, `audit`; `ControlConsole.tsx`; suspend/reinstate with mandatory 12–500-char reason, `FOR SHARE` grant re-check and immutable audit; six-viewport capture workflow | **Owner must approve the PII/financial display policy and the metric set.** The console deliberately withholds amounts, references and owner identity pending that decision. MRR/ARR is undefined without it. No amount of engineering may invent it. |
| ADMIN-006 | O+X | Agent/finance/payment/subscription oversight, commission, ledger, Paystack verification, reconciliation, reversals | `lib/agents/**` (commission calculation, reconciliation, referral reports), `/api/admin/payments`, ledger reads with amounts withheld | **Exact commission terms, qualifying events and payout schedule are not in the repository.** The register itself says "do not invent". Owner decision first; Paystack live verification is external. |
| ADMIN-007 | O+X | Centralised validated configuration, feature flags, provider health, scoped AI kill switches | `/api/control/overview` `system`/`providers` sections; `lib/autopilot/policy.ts` global kill switch; ERP `featureFlagsJson` kill switches | **Owner must name which flags may be changed from the console and who may change them.** Provider health requires live provider credentials (external). |
| ADMIN-009 | X | Canonical domain `https://jataaftercall.co.ke`, `/control`, HTTPS, redirects, secure cookies | Verified read-only this cycle: `https://jataaftercall.co.ke/` serves the product; `https://www.jataaftercall.co.ke/` serves it with the **same** `<title>` and canonical links; `/control` redirects to `/control/sign-in` and presents the control-plane sign-in both on the apex and on `jata-aftercall.vercel.app` | **Authoritative DNS/mail export and confirmation from HOSTAFRICA is an owner/operator action.** Direct TLS inspection is blocked for this sandbox (`curl` → `SSL_ERROR_SYSCALL`; fetch succeeds through the proxy only). No DNS, domain or env change was made. |
| ADMIN-010 | O | A functional console with independent screenshots at six viewports, PASS/FAIL/BLOCKED/NOT TESTED | Console implemented; denial screenshots captured in CI | Blocked by ADMIN-005/007 (the console cannot show the metrics it is being asked to show) and by independent six-viewport review of the **console** (the motion workflow captures storefronts, not `/control`). |
| ADMIN-013 | O+X | Connected agent lifecycle: phone ownership → eligibility → activation → referral → verified payment → idempotent commission → reversal → reconciliation, >5,000-member reports | Disconnected libraries and models exist and are tested in isolation | **Same missing commission policy as ADMIN-006**, plus real message/payment providers. Explicitly "synthetic engineering remains possible" — but the connected journey cannot be *accepted* without the policy. |
| ADMIN-014 | X+NT | Native Prisma + **disposable PostgreSQL 18**: fresh install, supported upgrade, failure handling, rollback, forward recovery, **backup/restore**, data integrity | `scripts/ci/rehearse-candidate-migrations.mjs` (1,349 lines) proves fresh apply, ledger completeness, psql equivalence, idempotent re-apply, deliberate-failure detection and client/typecheck/test against the migrated DB. **CI: "Exact candidate applies on disposable PostgreSQL 18" and "Migrations + schema on PostgreSQL 18" both pass at `4828463`.** | **A container is not Neon.** The script says so explicitly. Backup/restore, PITR and provider-side restore are `docs/NEON-RECOVERY-READINESS.md` owner actions requiring console access. Local `psql`/`pg_dump`/`postgres` are absent from this sandbox. |
| ADMIN-015 | NT | Genuine authenticated **and** unauthorized** browser journeys at 320×568 … 1366×768, motion, reduced motion, independent inspection | `premium-screenshots.yml`, `motion-evidence.yml`, journey jobs all pass at `4828463`; six-viewport retrieval now works end to end | **Independent inspection of every image** is a human act, and authenticated **console** journeys cannot run until control access is enabled (owner decision). |
| MOTION-002 | O+NT | Every Studio-generated site inherits the motion engine but **not** JATA branding; per-site preferences, tenant isolation, OS reduced-motion precedence | `attachStorefrontMotion` mounted via `RenderModeProbe` in `StorefrontShell`, `BusinessPage` and `AIFrontDeskCustomerClient`; 20-family inheritance test; route-behaviour evidence: 42 rows, 30 motion / 12 lite, `aiRowsPass: true`, Chrome 156 at `4828463` | Per-site preference **UI** is an owner product decision; every family must be exercised through real generate/preview/publish, and untested families must be declared NOT TESTED. |
| MOTION-003 | E (partly) → NT | Pre-implementation inventory, baseline screenshots, reuse plan, explicit NOT TESTED list | `docs/agents/CONTROL_AND_MOTION_AUDIT.md` inventory; generation-path inventory; six-viewport machinery | **Baseline screenshots at this head were the missing evidence** and the channel that should have produced them published 1 of 6. Fixed in `66d53b8`; the images still need capture at the next head and inspection. |
| MOTION-004 | NT | Shared primitives and universal coverage across surfaces | Motion tokens, recipes, runtime and CSS all tested | Universal coverage requires per-surface browser evidence, not source presence. |
| MOTION-005 | NT | Workspace navigation/status motion using shared tokens, text immediately visible, reduced-motion overrides | CSS + scheduler tests pass locally | Real keyboard/mobile/desktop inspection not performed. |
| MOTION-006 | NT | Real accessible motion across dashboard and agent sections, before/after, six viewports, reduced motion | `DashboardClient`, `/agents/dashboard`, `AnalyticsChart` implemented; focused tests pass | **Before/after recordings and six-viewport authenticated capture** are not produced. |
| MOTION-007 | O+NT | Complete advanced fintech motion engine; every supported Studio family through the real pipeline; recordings; six viewports | Runtime, policy and ~141 focused tests | The referenced "detailed specification immediately above" is **not recoverable** from the register; the register says it "must not be invented". Plus the full evidence suite. |
| MOTION-008 | O+NT | The verbatim advanced-engine specification (20 sections) | Long-form spec present in the register | Owner must confirm the referenced external specification; full evidence suite outstanding. |
| MOTION-011 | NT | AI Front Desk motion in SSR, hydration, preview, published and fallback; coverage matrix | `docs/agents/MOTION_011_COVERAGE_MATRIX.md`; AI preview and denial covered in real browser | Every family × route × publishing mode in a real browser. |
| MOTION-012 | NT | Obtain real browser acceptance evidence; six viewports; recordings | **Unblocked this cycle:** six-viewport retrieval works (was 1/6, now 6/6 by construction) | Captures at the new head + independent inspection. |
| MOTION-013 | NT | Evidence at exact head | Retrieval machinery now functional | Same as above. |
| MOTION-014 | NT | Evidence at exact head | Same | Same. |
| MOTION-015 | NT | Behavioural proof: 8-animation concurrency, queueing, cancellation, cleanup, re-navigation, reduced motion, no leaks | `MAX_ACTIVE_REVEALS = 8` with queue drain, focus-in cancellation, unmount teardown, epoch fencing — all covered by unit tests | **Event-level browser proof** of queue pressure and re-entry. Unit tests are not that proof, and the register says so. |
| MOTION-016 | NT | Remediation of six outstanding acceptance areas | Targeted cancellation evidence in CI | Recordings, historical baseline comparison, full commerce and published-AI coverage. |
| MOTION-017 | O+NT | Concurrent queue saturation/ordering/dedup/interruption/re-entry; genuine historical baseline | Fetching the named baseline commit `a28c1a4…` **now succeeds**, so a baseline is reachable | The baseline must be **reproduced** under identical route/viewport/data/preferences, which needs a browser + disposable DB run, and owner confirmation that this commit is the correct pre-motion reference. |
| MOTION-018 | NT | Full acceptance plus Prisma test-environment recovery | `scripts/test/check-prisma-client.cjs` + `full-local-suite.yml` pass in CI at `4828463` | Locally, `prisma generate` is **blocked** in this sandbox: `binaries.prisma.sh` is unreachable (`npm ci` succeeds, generation fails). This is the documented environmental limitation, not a defect. |
| RELEASE-001 | O+X | Turn every documented audit blocker into implemented, testable work | `docs/audits/REMEDIATION_REGISTER.md`; P0 domain/media/payment/tenant work tracked per finding | The audit's own blockers D-05 (HOSTAFRICA DNS/mail), M-01 (approved non-production storage) and F-01/S-01 acceptance gates are **owner/provider actions**. RELEASE-001 is the umbrella row over all of them; it cannot pass while any child is open. |

### Totals

| Classification | IDs | Count |
|---|---|---|
| ENGINEERING-REMEDIABLE, now done | evidence-manifest staleness; six-viewport evidence channel | 2 defects, **fixed** |
| OWNER-DECISION-REQUIRED (sole or joint blocker) | ADMIN-005, 006, 007, 010, 013, MOTION-002, 007, 008, 017, RELEASE-001 | 10 |
| EXTERNAL-DEPENDENCY (sole or joint blocker) | ADMIN-006, 007, 009, 013, 014, RELEASE-001 | 6 |
| NOT-TESTED (needs a browser/DB/reviewer this sandbox lacks) | ADMIN-015, MOTION-003…006, 011…018 | 13 |

No finding moved to PASS. **24 outstanding, as before.**

---

## 4. Owner decisions required

These cannot be answered by engineering. Each one is a hard blocker on the named rows.

1. **PII and financial display policy** — what owner/tenant identity and what amounts may an
   authorised operator see in `/control`? Blocks ADMIN-005, ADMIN-010.
2. **The metric set** — which of MRR/ARR, trial, usage, AI, job and incident metrics are required,
   and from which authoritative source. Approximation is forbidden by §005. Blocks ADMIN-005.
3. **Agent commission policy** — rates, qualifying events, attribution windows, reversal terms,
   payout schedule. The register states these were never located and must not be invented. Blocks
   ADMIN-006, ADMIN-013.
4. **Which configuration may be changed from the console, and by which role** — feature flags,
   provider toggles, AI kill-switch scope. Blocks ADMIN-007.
5. **Control-plane access activation** — the owner-approved policy is DENY for all 90 role/capability
   combinations. Until an explicit ALLOW decision and a provisioning authority exist, no positive
   control journey can be exercised. Blocks ADMIN-010, ADMIN-015, and independent console capture.
6. **Confirmation of the MOTION-007/008 external specification** — the text referenced as "immediately
   above" is not recoverable from the register. Blocks MOTION-007, MOTION-008.
7. **Confirmation that `a28c1a4…` is the correct pre-motion baseline** for MOTION-017's comparison.

## 5. External dependencies outstanding

1. **HOSTAFRICA authoritative DNS/mail export and delivery confirmation** (ADMIN-009, RELEASE-001
   D-05). No DNS value may be guessed; no change was made.
2. **Neon console recovery verification** — PITR/branching/restore points and a restore rehearsal
   (ADMIN-014). `docs/NEON-RECOVERY-READINESS.md` lists the owner checklist. No production access.
3. **An approved non-production storage configuration** for durable customer media (RELEASE-001 M-01).
4. **Paystack live/sandbox verification credentials** (ADMIN-006, ADMIN-013).
5. **A browser + disposable PostgreSQL environment for independent inspection** — CI has both
   (PostgreSQL 16/18 services, Chrome 156); this sandbox has neither, and `prisma generate` cannot
   reach `binaries.prisma.sh`. This is why local browser acceptance is NOT TESTED while CI passes.

## 6. Test results

| Gate | Command | Result | Exit |
|---|---|---|---|
| Lint | `npm run lint` | 0 errors, 51 pre-existing warnings | **0** |
| Annotation policy unit tests | `npx vitest run tests/unit/motion-visual-annotation.test.ts` | 8/8 | **0** |
| Motion unit + inheritance | `npx vitest run tests/unit/storefront-motion.test.ts tests/unit/storefront-motion-inheritance.test.ts` | 58/58 | **0** |
| CI gate self-tests | `node --test scripts/__tests__/*.test.mjs` | 302/302 | **0** |
| Admin/instruction gates | `node --test scripts/admin/tests/*.test.mjs` | 12/12 | **0** |
| Evidence manifest | `node scripts/ci/verify-evidence-manifest.mjs` | 69/69 match | **0** |
| Programme completeness | `node scripts/admin/check-programme-readiness.mjs` | `NOT READY (24)` | **1** |
| Exact-head CI @ `4828463` | 19 checks | 17 pass, 1 fail (programme), 1 skipped | — |
| Six-viewport retrieval, old run | `retrieve-visual-evidence.mjs 130128893526` | **1/6** — demonstrates the defect | 1 |
| Six-viewport retrieval, run at `14d4fe4` | `retrieve-visual-evidence.mjs 130143153630` | **0/6 — BLOCKED**, budget too tight; found by the new script | 2 |
| Six-viewport retrieval, run at `6eb1009` | `retrieve-visual-evidence.mjs 130152615805` | **0/6** — six explicit `MOTION_VISUAL_MISSING_*` errors exposed the unused tier width | 1 |
| Six-viewport retrieval, run at `b9ecbe7` | `retrieve-visual-evidence.mjs 130159647906` | **0/6** — the same errors plus identical tier byte sizes exposed the Puppeteer viewport reset | 1 |
| **Six-viewport retrieval, run at `b9dd943`** | `retrieve-visual-evidence.mjs 130167430117` | **6/6 complete JPEGs**, one annotation each, 2,053–2,598 bytes | **0** |
| Authenticated real-DB browser journey (local) | `npm run test:browser:studio-authenticated` | **BLOCKED** — no isolated DB/Chrome | 2 |
| `prisma generate` (local) | `bash scripts/lib/prisma-generate.sh` | **BLOCKED** — `binaries.prisma.sh` unreachable | 1 |

**PASS:** the two engineering defects above (the annotation publisher after its second iteration); all CI gates at `4828463` except the intended
programme gate. **FAIL:** `programme-completeness (24)` — truthful, not to be bypassed.
**BLOCKED:** local authenticated browser capture; local Prisma generation; ADMIN-009 direct TLS.
**NOT TESTED:** independent six-viewport inspection, all authenticated console journeys, all before/
after recordings, provider verification.

## 7. Updated programme readiness count

**`NOT READY (24)`** — unchanged. 24 rows remain non-PASS: ADMIN-005/006/007/009/010/013/014/015,
MOTION-002–008 and 011–018, RELEASE-001. **RELEASE-004 is PASS** and was already recorded before this
cycle; it is not part of the 24.

No status was changed, no gate was weakened, no manifest entry was removed, and no record was
rewritten. `git diff origin/main -- docs/agents/PROGRAMME_READINESS.json` adds RELEASE-004 and changes
**no existing status**.

## 8. PR and production status

- **PR #109:** OPEN, UNMERGED, base `main`, head `4828463` after this cycle's first push. **Not merged.**
- **Production:** unchanged. No deployment, no migration, no production SQL, no data or subscription
  or payment change, no provider activation, no DNS change.
- **Website Studio / OpenPage:** untouched by this cycle. No route, component, API, schema or pricing
  file was modified; the additive Studio restoration from the previous cycle is intact.

## 9. Recommended next action

1. **Read the six captured viewports** produced by the next `motion-evidence` run
   (`node scripts/motion/retrieve-visual-evidence.mjs <capture-check-run-id>`) and confirm or reject
   the `Share`-button edge observation at native resolution.
2. **Answer owner decision 1–4** (PII/financial display, metric set, commission policy, console-config
   authority). Four answers unblock 10 of the 24 rows; engineering cannot proceed past them.
3. **Then** run the authenticated console journey with control access temporarily enabled in a
   disposable environment, and record six-viewport console evidence.
4. **Only then** consider any status change — and only with the evidence in hand.

No merge, no deployment, no production change was performed.
