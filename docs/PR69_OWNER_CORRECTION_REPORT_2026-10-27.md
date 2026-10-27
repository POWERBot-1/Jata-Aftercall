# PR #69 Owner Correction — Final Report (2026-10-27)

**Branch:** `arena/b45b361f-jata-aftercall` · **PR:** https://github.com/POWERBot-1/Jata-Aftercall/pull/69
**Base:** `main` @ `b716247` · **Head:** `9198891` · **PR state:** OPEN, MERGEABLE — **not merged, not deployed, no production action taken**
**Controlling directive:** eight-phase owner correction, 2026-10-27 (restore original design; plan icon lock; complete business-page experience; JATA Qi seam; real-browser evidence; full verification; push only; stop for review).

Verdict legend: **PASS** = executed and verified · **FAIL** = executed and failed · **BLOCKED** = cannot be executed in this environment, with the blocker named · **NOT TESTED** = not executed (distinct from blocked).

---

## 1. Executive summary

| Phase | Requirement | Verdict |
|---|---|---|
| 1 | Baseline, evidence and work plan | **PASS** — `docs/PR69_CORRECTION_BASELINE_2026-10-27.md` |
| 2 | Original design restored from Git history, not merely re-coloured | **PASS** — byte-identical restoration plus two evidence-backed overflow rules; 330/330 real-Chrome gates |
| 2 | Plan icon lock (identity, component, mapping, order, position) | **PASS** — source unchanged; restoration contract test enforces it |
| 3A | Nominated contact number: KE validation/normalization, tenant isolation, server validation, single source of truth | **PASS** |
| 3B | Four demo businesses use 0724317010; real numbers never overwritten | **PASS** in code/data definitions · **BLOCKED** for live DB rows (approval-gated script, not run) |
| 3C | WhatsApp/tel/Directions/Share genuinely functional with honest fallbacks | **PASS** (unit contract + real-Chrome contact gates); Share fallback chain code-verified, manual tap NOT TESTED locally (no browser) |
| 3D | Photo upload validation, tenant isolation, replace/remove, category fallback imagery | **PASS** (existing suite strengthened) · durable R2 storage **BLOCKED** (no production credentials; fail-closed by design) |
| 3E | Prices, keys, intervals, entitlements, Paystack and publication rules unchanged | **PASS** — no relevant source files changed |
| 4 | JATA Qi integration using verified patterns, secrets server-side, fail-closed | **BLOCKED** for live integration (access blockers named in §12) · **PASS** for the mocked, fail-closed seam |
| 5 | Mandatory real-browser before/after screenshots, labelled | **PASS** for automated capture/gates · **NOT TESTED** for author eyeball inspection (artifact host blocked); owner screenshot approval remains a separate gate |
| 6 | Full test/lint/typecheck/build/CI verification | **PASS** in CI (all 12 check-runs green); local offline-Prisma limitations documented honestly |
| 7 | Push to existing PR branch only; no force-push/reset/discard; update PR; stop | **PASS** — five fast-forward commits; stopped here for review |
| 8 | This 17-section report | **PASS** |

No new dependency, paid service, schema change, migration, lockfile change, Paystack change, production config change or customer-record change is part of this work.

---

## 2. Standing constraints honoured

- Next.js + Prisma + Neon + Vercel + Paystack architecture untouched; no package added or removed (`package.json` gains one test-runner script only).
- No force-push, branch reset, history discard, unrelated-commit overwrite, or work outside the existing branch. Every push was a fast-forward (`d05def8 → 139026b → 83b4060 → 6a6437a → 218d887 → e8c9ebd → 9198891`).
- No merge, deploy, production migration, storage activation, env/DNS/credential change, or modification of JATA Qi/TANYA/SOMA repositories.
- The verified phone-overflow fix and its regression tests, the screenshot workflow, and all useful declutter/usability work from the earlier branch are preserved.
- `jataaftercall.co.ke` untouched; Gmail never accessed; no secret values are stored, logged or returned by any new code.
- Demo (fictional) and real records are kept strictly separate; the demo number is never a fallback for real businesses.

---

## 3. Baseline before the correction

Recorded in full in `docs/PR69_CORRECTION_BASELINE_2026-10-27.md`. Headline facts: PR #69 head `d05def8` carried a withdrawn graphite/electric-lime redesign across `globals.css`, `page.tsx`, dashboard components and a pinning test; the original espresso/cream/amber design and serif display type existed byte-for-byte at main `b716247`; the schema already contained `phone/whatsapp/location/lat/lng/logoUrl/coverUrl` (no migration needed); PATCH `/api/business` accepted phone/whatsapp with trim-only handling; demo placeholders were `0700000001…0700000004`; no JATA Qi code, credentials or HTTP endpoint existed anywhere accessible.

## 4. Phase 2 — original design restoration

- `app/globals.css`, `app/page.tsx`, `components/DashboardNav.tsx` restored **byte-for-byte from `b716247`** (`git diff b716247` for the two latter files is empty). `components/DashboardClient.tsx` equals main plus the Phase 3 contact edits in §7.
- Restored design decisions, not just paint: original layout, components, cards, buttons, section hierarchy, serif display face (`--lp-display`), espresso ink `#14110f`, cream `#f7f2e8`, amber `#f0a03c`, deep amber `#b45309`, ember `#c2410c`, root accent `#d97706`, CTA label ink `#1a140d`.
- The only CSS retained on top of the original stylesheet is the two evidence-backed phone-overflow rules: `.ws-stack { grid-template-columns: minmax(0, 1fr) }` and `.ws-rail-wrap { min-width: 0; overflow-x: clip }`, each carrying its real-Chrome evidence comment. The overflow regression test is retained.
- Banned rebrand literals (`#b6ff2e`, `#4d6b12`, `#16181d`, `#1b1e24`) — **zero occurrences** in `app/`, `components/`, `lib/`.
- The rebrand-pinning test was deleted and replaced by `tests/unit/original-design-restoration-2026.test.ts` (tokens, serif face, banned-literal guard, icon identities/markup/order, ember chart colour, AA contrast, overflow rules).
- Storefront/customer themes were not altered as a side effect; theme resolution and the three storefront themes are unchanged.
- The withdrawn-direction document now carries a SUPERSEDED banner rather than being deleted, preserving the historical record.

## 5. Plan icon lock — formal verdict: **PASS**

Every requirement verified at source (`lib/landing.ts`) and pinned by the restoration test:

| Plan | Icon identity | Rendering |
|---|---|---|
| MONTHLY KES 149 | phone | `span.lp-plan__icon[aria-hidden] > LandingIcon`, before `.lp-plan__name` |
| ANNUAL KES 999 | calendar | same markup; remains the sole featured card |
| AI Business Front Desk | bot | same |
| JATA AutoPilot | spark (`AUTOPILOT_PLAN_CARD`) | same |
| Website Studio | wand (`INTERACTIVE_BUSINESS`) | same |
| Business POS | store (`POS_PLAN_CARD`) | same |

No icon component, mapping, order or position was changed; no icon library or dependency was introduced or removed.

## 6. Homepage and plan order — decision recorded

The PR-head sequence is retained because the 2026-10-27 directive Phase 2A enumerates exactly this order ("retain their existing order"); only the visuals reverted. Sequence, enforced in `lib/pricing.ts#HOMEPAGE_PLAN_ORDER`, the homepage tests and the real-Chrome gate `EXPECTED_PLAN_ORDER`: **MONTHLY → ANNUAL → AI_BUSINESS_FRONT_DESK → JATA_AUTOPILOT → INTERACTIVE_BUSINESS → BUSINESS_POS**. Main's older sequence (Studio/POS first, AutoPilot last) was not restored. This is reversible on a direct owner word; rationale is in baseline report §5.

## 7. Phase 3A — nominated contact number

**Single source of truth.** One authenticated surface edits the number: dashboard *Edit → Profile, contact & location* → PATCH `/api/business` → the existing `Business.phone/whatsapp` columns. Onboarding collects no phone, so no parallel source exists. No table, endpoint or schema was added.

**Server validation (the authoritative boundary).** A shared `parseContactNumber` helper in `app/api/business/route.ts` now runs on both POST and PATCH for phone **and** WhatsApp: the existing length gate (`validatePhone`) plus the canonical Kenyan rule (`isValidKePhone` from `lib/phone`, the same module that builds public wa.me/tel links). Empty input clears the field; any other invalid value is a hard 400; non-string payloads are rejected rather than coerced. The owner's display format is preserved at rest; normalization to `254XXXXXXXXX` remains at point of use, as before. Tenant guarding (`guardTenantMutation`) runs before every write; publish still requires verified payment.

**UI.** The field is now explicitly labelled *Nominated contact number* with a KE hint and `0724 317 010` placeholder; WhatsApp explains it defaults to the nominated number. A client-side mirror of the same rule gives instant feedback; the API remains the boundary for direct requests.

**Evidence:** `tests/integration/business-contact-number-route.test.ts` — 22 tests (valid KE formats incl. spaced/`+254`/9-digit, rejections of malformed and non-Kenyan values, clearing semantics, unauthenticated 401, cross-tenant guard ordering, wa.me/tel parity). The earlier PATCH trim-only gap is closed.

## 8. Phase 3B — official demo number 0724317010

- `lib/demoData.ts` and `prisma/seed.ts`: all four fictional demo businesses (Nyumbani Kitchen, Mary's Beauty Studio, Kamau Auto Care, John Kamau Properties) now use `0724317010` for both phone and WhatsApp; it normalizes to `254724317010`.
- Untouched: admin and demo-owner **account** phones, all unrelated test fixtures, and every non-demo business path. The restore boundary still writes only `DEMO_SLUGS`, skips any slug carrying a real payment, and refuses arbitrary owner emails.
- Tests pin the new convention and explicitly assert a real business row is never modified and never receives the demo number (`tests/unit/demo-data-restore.test.ts`).
- **BLOCKED (honest):** no live database was touched. Applying the number to an existing environment still requires running the dry-run-first, demo-slug-only `scripts/restore-demo-businesses.ts --apply`, which remains behind the standing owner approval gate. Nothing in this branch changes production data on merge by itself.

## 9. Phase 3C — contact actions and honest fallbacks

Verified behaviour on the public surfaces:

- **WhatsApp** renders only when the stored number normalizes to a valid KE mobile; the href is a real `https://wa.me/254…` URL with a prefilled enquiry.
- **Call** renders only under the same gate, as `tel:+254…`.
- **Directions** uses coordinates when a complete valid pair exists, otherwise the encoded address query, otherwise the control is absent — never a dead link.
- **Share** uses the native share sheet when available, falls back to clipboard with an announced status, then to a visible link for manual copying; every branch has a user-visible outcome.
- With no actionable target the whole action bar disappears rather than rendering disabled look-alikes; the legacy page shows an explicit "coming soon" message only when no contact exists.

Evidence: new `tests/unit/contact-action-fallbacks.test.ts` (6 SSR contract tests over the real ActionBar); existing `location-payment.test.ts` pins Directions URL ordering; real-Chrome gates on the demo page (§13) prove live destinations end to end. Manual finger-tap testing on a physical device is **NOT TESTED** (no device/browser in the authoring sandbox).

## 10. Phase 3D — uploads, isolation, fallback imagery; storage status

The pre-existing media pipeline was audited and found to already implement the directive's requirements; evidence was strengthened rather than rebuilt:

- **Server-side content validation:** magic-byte parsing (`parseImageDataUrl`/`validateImageBytes`), JPEG/PNG/WebP/GIF only, SVG refused as a script vector, size and quota gates, text-renamed-as-photo and truncation rejection.
- **Tenant isolation:** `configure` role on every mutation; VIEWER read-only; row-level tenant guard before any PATCH/DELETE; tenant-prefixed object keys (`tenants/<businessId>/…`) with runtime verification and deletion of any provider answer that leaks inline data or another tenant's key; orphan cleanup on metadata failure; audit logging.
- **Replace/remove:** optimistic-concurrency PATCH (monotonic version, compare-and-swap) and single/bulk DELETE, all tenant-scoped. New stranger (no-membership) IDOR tests prove read, upload, metadata replace and deletion against another tenant are refused before any write (`tests/security/media-authorization.test.ts`, now 11 tests).
- **Automatic fallback imagery:** the category registry maps every Website Studio experience profile and POS type to honest, dimension-declared WebP/JPEG artwork, never fails on unknown/free-text categories, and is consumed across dashboard, AI workspace, AutoPilot, business detail and POS layouts; the storefront renders owner logos conditionally (no broken images). Covered by `category-imagery.test.ts` and related suites.
- **BLOCKED — durable production storage:** R2-class uploads remain fail-closed. With no provider configured, byte uploads answer 503 with an honest code/message and nothing is written to Neon; no production credentials exist in this environment, and activation is an explicit owner gate (`STORAGE_DECISION`/R2 runbook). This matches the directive that durable R2 uploads are required at launch but are approval-gated.

## 11. Phase 3E — commercial immutability: **PASS**

The branch diff contains no change to pricing modules, plan keys, prices, intervals, entitlements, Paystack code, publication gates, subscriptions or payments (the only `prisma/` file changed is `seed.ts`, demo phone strings only; no schema or migration; no lockfile). Existing pricing-grid, entitlement, publication and settlement suites pass unchanged in CI.

## 12. Phase 4 — JATA Qi: blocked live, mocked seam delivered

**Access blockers (verified, not assumed):** the `@jataqi/*` packages return npm E404 (no public registry package — adding one would breach the no-new-dependency rule and needs approval); JATA Qi exposes no HTTP API (library/CLI only), so there is no endpoint to call without embedding the runtime or deploying a loop host; no TANYA AI/SOMA AI repository, contract or code is accessible under the organization; no Qi credentials exist in this project. A live integration therefore remains **BLOCKED** pending owner-provided pattern access, an embedding/deployment decision and credential handover. No endpoint, credential or result was invented.

**Delivered seam (mocked evidence, honestly labelled):** `lib/qi/` implements the documented T-03 authenticated work-ingress contract with zero dependencies and no network I/O:

- auth modes `static-token | oidc | test-only | none`, default `none` which fails closed; missing credentials fail closed;
- env-only token (`JATAQI_AUTH_TOKEN`) held solely for exact-value scrubbing, never present in redacted config, logs, envelopes or errors (with a credential-pattern scrubber as defence in depth);
- tenant pinning via explicit grants (unknown tenant → `tenant_mismatch`), default-deny capabilities, JSON-safety and idempotency/correlation validation before dispatch;
- no registered transport → `unavailable/transport_failed`, never a fake success; the transport is the single swap point for a future approved runtime;
- dormant by construction — no app route imports it; `.env.example` documents the variables as inactive and approval-gated.

Evidence: `tests/unit/qi-adapter-seam.test.ts` — 20 mocked-contract tests covering every failure mode, secret hygiene and a successful dispatch against an injected mock. These prove the seam's behaviour only; they are not evidence of a live Qi deployment.

## 13. Phase 5 — real-browser screenshot evidence

Workflow: `.github/workflows/premium-screenshots.yml` (unchanged trigger: `pull_request` to main + manual dispatch), running real headless Chrome against a local production build on a disposable PostgreSQL database seeded with the fictional demo dataset — never production.

- **BEFORE (withdrawn design):** run `40434999884`, success — graphite/lime evidence retained as a GitHub Actions artifact (the local `verification/` copy was lost in a sandbox reset; the artifact is authoritative).
- **AFTER (restored design):** run `40468176220` on head `9198891`, success, **PASS=330 FAIL=0**; earlier restored-design run `40466215353` also green. A failed intermediate run (`40467744255`, 328 PASS / 2 FAIL) correctly caught an over-strict assertion (the page renders three legitimate Directions surfaces); the gate was fixed and the full run then passed — the workflow demonstrably fails on real regressions.
- Coverage: six viewports (320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768 — exceeding the three required widths) across four public routes, the seeded demo business page and five authenticated member routes, plus a 390px mobile nav journey. Every page is gated on 200/304, no auth bounce, **no horizontal overflow**, no uncaught errors and no Next.js error overlay; pages wait for load/fonts (no skeleton captures).
- Design gates at 390px and 1366px: root accent `#d97706`, ink `#14110f`, cream `#f7f2e8`, amber `#f0a03c`, deep amber `#b45309`, serif display face, CTA `rgb(240,160,60)` with `rgb(26,20,13)` label, hero `rgb(20,17,15)`, and the six-card plan order.
- Contact-state gates at 390px and 1366px on the demo page: `wa.me/254724317010`, `tel:` containing `254724317010`, only valid Google Maps Directions links to the demo location, Share present and no "coming soon" placeholder.
- Labelling: JPEGs are named `<viewport>__<route>.jpg`; `evidence.json` now carries `designEpoch`, `beforeAfter: "AFTER"` and the exact `GITHUB_SHA`, so AFTER evidence cannot be confused with the BEFORE run. The optional label-gated branch-publishing channel was not used (no `visual-evidence` label; branch contains no evidence commit).
- **NOT TESTED:** the author could not open or visually inspect the JPEGs — artifact/log blob hosts are blocked in this sandbox. Automated gates are green, but the directive is explicit that green CI is not owner screenshot approval; the artifact on run `40468176220` is queued for the owner's separate visual-approval gate.

## 14. Phase 6 — verification gate table

| Gate | Local sandbox | GitHub Actions (authoritative) |
|---|---|---|
| Unit/integration/security tests | **PASS** 3,036 passed, 121 skipped; 1 fail = known offline-Prisma DMMF case only | **PASS** — Release Validation green; E2E journey against real PostgreSQL green |
| ESLint (`npm run lint`, canonical scope app/components/lib) | **PASS** — 0 errors, 41 warnings (identical pre-existing warning set) | **PASS** — Static check green |
| TypeScript | 4 errors, all in pre-existing Prisma-stub tests (`PrismaClientKnownRequestError`, `BusinessUncheckedCreateInput`, `dmmf`) — identical at `b716247`; zero errors in changed production code | **PASS** — Static typecheck runs with the generated client and is green |
| Production build | **PASS** — "Compiled successfully"; only the offline-stub typecheck step fails as documented | **PASS** — Production build path on PostgreSQL 18 green |
| Migrations/schema | Not runnable offline | **PASS** — migration rehearsal, target guard and schema reconciliation all green; branch contains no schema/migration change |
| Real-Chrome visual/contact gates | **BLOCKED** — no browser binary | **PASS** — 330/330, run 40468176220 |
| Dependency audit | No dependency changes to audit | **PASS** — audit step green |

Test growth attributable to this correction: **+52 tests** (22 contact-route, 20 Qi seam, 6 contact fallbacks, 4 media IDOR) plus the rewritten restoration contract and updated demo-data tests. No test was removed to make a gate pass; the one deleted file was the rebrand-pinning test, replaced by the restoration contract.

## 15. CI and pull-request state

All twelve check-runs on head `9198891` are **success**: Release gate (aggregate), Static, Migrations + schema on PostgreSQL 18, Failure paths actually fail, Schema reconciliation, D2 build/audit/controls, Production build path, Exact candidate applies, Migration target guard, Journey against a real database, Real-Chrome six-viewport capture, Vercel Preview Comments. PR #69 is OPEN and MERGEABLE. The PR title/body are updated in the accompanying push to describe the correction rather than the withdrawn redesign. The branch is left exactly here for owner review.

## 16. BLOCKED / NOT TESTED register and owner decisions requested

1. **Owner screenshot approval (separate gate):** inspect the run `40468176220` artifact (or add the `visual-evidence` label to publish evidence onto the branch). Automated gates cannot substitute for this.
2. **Live demo-number application:** approve (or reject) running `scripts/restore-demo-businesses.ts --apply` against the target environment to change the four demo rows; default is no production action.
3. **Durable R2 storage:** provision/activate per the R2 runbook when launch-ready; until then byte uploads honestly fail closed.
4. **JATA Qi live integration:** provide accessible TANYA/SOMA/T-03 reference material, choose in-process embedding vs deployed loop host, and hand over a server-side credential via environment configuration. The seam is ready for that swap; nothing activates automatically.
5. **Homepage order confirmation:** the PR-head six-card order was retained per the directive's enumerated sequence; confirm or supply the alternative.
6. Physical-device tap testing of Share/native sheet behaviour remains NOT TESTED from this sandbox.

## 17. Change manifest and commit guide

Five correction commits on top of `d05def8`:

| Commit | Content |
|---|---|
| `139026b` | Phase 2 design restoration, restoration contract test, screenshot gates re-pointed, baseline report |
| `83b4060` | Phase 3A/3C/3D: contact validation API + UI, fallback contract tests, media IDOR cases |
| `6a6437a` | Phase 3B: demo number 0724317010 in demo data/seed with boundary tests |
| `218d887` | Phase 4: fail-closed `lib/qi` seam, env documentation, 20 mocked tests |
| `e8c9ebd` + `9198891` | Phase 5: demo-page/contact-state capture, AFTER/SHA labelling, Directions gate correction |

New files: `lib/qi/{types,config,client,index}.ts`, `tests/unit/qi-adapter-seam.test.ts`, `tests/integration/business-contact-number-route.test.ts`, `tests/unit/contact-action-fallbacks.test.ts`, `tests/unit/original-design-restoration-2026.test.ts`, `docs/PR69_CORRECTION_BASELINE_2026-10-27.md`, this report. Deleted: `tests/unit/premium-redesign-2026.test.ts` (replaced). Full branch diff vs main: 31 files, +2,587/−90 (the diff includes earlier branch work — the screenshot workflow and audits — which the directive required preserving).

**End of report. Awaiting owner review; no merge, deploy or production action will be taken without explicit approval.**
