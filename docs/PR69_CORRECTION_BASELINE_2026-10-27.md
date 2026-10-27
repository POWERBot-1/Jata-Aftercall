# PR #69 owner-directed correction — Phase 1 baseline report (2026-10-27)

Owner directive: restore the ORIGINAL JATA AFTERCALL design (not merely colours), declutter only
within that design, preserve valid work (mobile-overflow fix, tests, screenshot workflow),
complete the KES 149 / KES 999 business-page experience, and integrate with JATA Qi using verified
patterns. No merge, no deploy, no production changes.

## 1. Repository / PR / branch state (verified)

- Repository: `POWERBot-1/Jata-Aftercall` (confirmed via `git remote -v`).
- PR #69: **OPEN**, base `main`, head `arena/b45b361f-jata-aftercall`, head SHA
  `d05def859a5c378ca1284d50b99ccf0187ababd4`, `MERGEABLE`. All 13 CI checks pass on that SHA
  (static, migrations, production build on PostgreSQL 18, real-DB journey, Real-Chrome capture,
  Vercel preview, release gate).
- Baseline revision for "original design": `main` = `b716247` (merge of PR #68).
- Local branch was realigned to `d05def8` with a non-destructive mixed reset after a sandbox
  pointer reset; every working-tree file was proven byte-identical to the PR head first. No
  force-push, no history rewrite of the remote branch in this correction.
- Working tree otherwise clean; `verification/` evidence directory is git-excluded.

## 2. What PR #69 actually changed (21 files, +1,964/−339)

| File | Nature | Disposition |
| --- | --- | --- |
| `app/globals.css` (+482/−272) | Rebrand: espresso/cream/amber → graphite/electric-lime; serif display → Inter 700; refinement layers; **plus the verified phone-overflow fix** | **Revert to `b716247`, re-apply only the overflow fix** |
| `app/page.tsx` (3/3) | Comment-only change; plan-card **markup untouched** | Revert comments (design source stays identical anyway) |
| `components/DashboardClient.tsx` (1/1) | Overview chart "Directions" series colour `#c2410c` → `#4d6b12` | **Revert** to original ember `#c2410c` |
| `components/DashboardNav.tsx` (2/2) | Comment wording only ("amber pill" → "lime pill") | Revert |
| `lib/pricing.ts` (24/17) | Homepage card order only; prices/keys/entitlements untouched | **Keep current order** — see §5 |
| `scripts/browser/pricing-grid.check.mjs` | Order expectations for current sequence | Keep; palette assertions updated in harness instead |
| `.github/workflows/premium-screenshots.yml`, `scripts/browser/premium-screenshots.check.mjs` | Real-Chrome six-viewport evidence pipeline | **Preserve**; update palette assertions to original design |
| `tests/unit/premium-redesign-2026.test.ts` | Pins the rejected graphite/lime design | **Replace** with an original-design restoration contract test |
| `tests/unit/workspace-design.test.ts` | One added regression test (overflow rules) | Restore main file, re-add the overflow test |
| `tests/unit/landing-*`, `homepage-*`, `pos-entitlement` | Palette expectation swaps + order updates | Restore main expectations; keep only order updates needed by §5 |
| `tests/unit/seeded-account-audit.test.ts`, `docs/security/*`, `docs/domain/*` | Phase 4/5 audits, design-neutral | **Preserve unchanged** |
| `package.json` | One script entry | Keep |

No changes exist anywhere in PR #69 to Paystack routes/webhooks, `lib/paystack.ts`, the Prisma
schema/migrations, `package-lock.json`, or `.env*` (boundary guard re-verified).

## 3. Original design evidence (from `b716247`)

- Landing tokens (`.lp-page`): espresso ink `#14110f`, ink-soft `#1d1815`, cream `#f7f2e8`,
  cream-2 `#efe7d7`, paper `#fffdf8`, text `#171310`, muted `#5a5148`, amber `#f0a03c`,
  amber-deep `#b45309`, ember `#c2410c`, jade `#0f766e`; display face
  `ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif`; cream page background.
- Workspace tokens (`.ws-shell`): the same espresso/cream/amber values restated for the
  authenticated surface; `--ws-on-ink: #f7f2e8`; warm line `#e3d8c8`; plan tint `#fff8ec`.
- Root tokens: `--jata-accent: #d97706`; zinc neutrals; Inter for body/sans only.
- Layout/composition: dark espresso hero band with photographic scrim, cream content sections,
  dark feature band, dark pricing band, light FAQ, dark closing CTA + footer; card structures,
  border radii, shadows and the `.lp-plan` row system are defined by the original CSS and were not
  altered by the PR (markup identical).
- Customer storefront theme engine (`lib/themes.ts`, `.eb-*`, product themes incl. pre-existing
  "Lime Spark / Graphite") is untouched by the PR and remains out of scope.

## 4. Plan-icon identity lock (source evidence)

`lib/landing.ts` is **unchanged by PR #69** (zero diff). Original mapping, icon rendered by
`LandingIcon` inside `.lp-plan__icon` at the top of each card (`aria-hidden`, name is the label):

| Plan key | Card | Icon key | Position |
| --- | --- | --- | --- |
| `MONTHLY` (KES 149/30d) | page plan | `phone` | top icon slot, 1st card |
| `ANNUAL` (KES 999/365d, featured) | page plan | `calendar` | top icon slot, 2nd card |
| `AI_BUSINESS_FRONT_DESK` (499/30d) | page plan | `bot` | top icon slot, 3rd card |
| `JATA_AUTOPILOT` (2,499/30d) | owner card `AUTOPILOT_PLAN_CARD` | `spark` | top icon slot, 4th card |
| `INTERACTIVE_BUSINESS` — Website Studio (999/30d) | page plan | `wand` | top icon slot, 5th card |
| `BUSINESS_POS` (499/30d) | owner card `POS_PLAN_CARD` | `store` | top icon slot, 6th card |

No icon component, import, key, mapping, card markup or icon position was changed by PR #69; the
restoration therefore keeps every icon identity intact. Verdict after re-verification will be
reported separately as required.

## 5. Homepage order decision (documented interpretation)

The 2026-10-27 directive Phase 2A enumerates the sequence **Monthly → Yearly → AI Business Front
Desk → JATA Auto Pilot → Website Studio → Business POS**, which matches the current PR head
order (`HOMEPAGE_PLAN_ORDER`), not the pre-PR main order (which had Website Studio → POS →
Autopilot last). Because the later, more specific instruction names this exact sequence and asks
that these cards "retain their existing … order", the current order is **retained**, while every
visual/design decision is restored to `b716247`. This is presentation rank only; plan keys,
prices, intervals, `PRIVATE_PLAN_KEYS` gating and Paystack behaviour are untouched. Reversible on
owner word.

## 6. Existing Phase 3 capabilities (verified in source — no rebuild)

- Schema already has `Business.phone`, `Business.whatsapp`, `location`, `lat`, `lng`,
  `logoUrl`, `coverUrl` — **no migration required** for the nominated number.
- `lib/phone.ts`: `normalizeKePhone` / `isValidKePhone` / `getWhatsAppUrl` — the Kenyan
  07/01 ↔ 254 conventions to reuse; invalid numbers yield `null` (no wa.me generated).
- `app/api/business/route.ts`: POST creates with server-side `validatePhone`, owner scoping and
  audit; PATCH updates with `guardTenantMutation` tenant isolation — **but PATCH accepts
  `phone`/`whatsapp` without re-running phone validation** (gap to close).
- `components/BusinessPage.tsx`: WhatsApp (`wa.me` + encoded message), `tel:` (normalized
  fallback), Share (`navigator.share` → clipboard → manual-copy text), Directions via
  `lib/location.ts#getDirectionsUrl` (coords → address → `null`); actions render only when a
  valid destination exists (honest fallbacks already present).
- Demo businesses (`prisma/seed.ts`, `lib/demoData.ts`) currently use placeholders
  `0700000001…0700000004`; none use `0724317010` yet.
- Images: `app/api/media` + `lib/storage/*` (inline fail-closed, R2 adapter, quota, safe keys),
  `components/dashboard/{MediaLibrary,MediaPicker,PhotoLab,HeroImagePanel}.tsx`,
  `components/media/CategoryImagePicker.tsx`; `lib/categoryImagery.ts` curated per-category
  illustrations with honest "illustrative" alt text and provenance;
  `categoryImageForUrl()` and `photoForCategory()` already provide fallback selection.
- Production durable storage remains unactivated (no env vars); production persistence stays
  **BLOCKED** pending owner provisioning per `R2_SETUP.md`.

## 7. JATA Qi / TANYA AI / SOMA AI findings (Phase 4 access evidence)

- `POWERBot-1/JATA-Qi` is accessible (cloned, inspected): a ~45-package in-process Node AI OS
  (`@jataqi/core-kernel`, `loop-host`, `authentication`, `commercial-control-plane`,
  `external-connectors`, …). Integration surfaces verified in source:
  - `WorkIngressModule`/`work-ingress.ts`: presented credential → principal boundary →
    `AuthenticatedPrincipal`; `WorkSubmission` carries `objective`, optional `tenantId`
    (**must equal the principal's tenant or be rejected — never authoritative**),
    `requestedRoles` (narrowing only), `correlationId`, `idempotencyKey`.
  - Auth modes: `static-token` / `oidc` / `test-only`; credential material only via
    `JATAQI_AUTH_TOKEN` env; mode `none` fails closed.
  - `ExternalConnector` contract: tenant binding, `credentialReference` (never raw secrets),
    health/capabilities/execute/verify/rollback, capability-manifest binding (fail-closed).
- **`@jataqi/*` is not published to npm** (registry 404) and Qi ships no HTTP server
  (no `createServer` in packages; ingress is an in-process library + `jataqi host:enqueue` CLI).
- **No TANYA AI or SOMA AI repository, branch or integration code is accessible**: the six
  repos in the org contain none; Qi docs mention TANYA only as portfolio prose. Pattern
  inspection against those two products is therefore **BLOCKED on access** and will not be
  fabricated. The integration will mirror Qi's own verified contracts instead, and this
  limitation is carried into the Phase 4 report.
- AFTERCALL's own `AUDIT.md` records required isolation from JATA Qi (§27): the correction adds a
  narrow server-side adapter seam only — no new dependency, no credential in client code,
  fail-closed when unconfigured, mocked-contract tests, live activation BLOCKED.

## 8. Test/verification baseline

- Local: `npx vitest run` = 2,988 passed / 121 skipped / 1 failed — the single failure is the
  pre-existing offline-Prisma DMMF test (`autopilot-phase1-hardening`), CI-green where engines
  download. Lint 0 errors (41 pre-existing warnings). Build compiles; local type-check fails only
  on the four known offline Prisma-stub errors, identical at `b716247`.
- Screenshot pipeline preserved (`.github/workflows/premium-screenshots.yml`); AFTER-correction
  runs will use the same six viewports and publish the same artifact.

## 9. Work plan (smallest safe corrections, in order)

1. Restore `globals.css` from `b716247`; re-apply only `.ws-stack { grid-template-columns:
   minmax(0,1fr) }` and `.ws-rail-wrap { min-width:0; overflow-x:clip }` with their regression
   test. Revert the two component colour/comment edits.
2. Replace the rebrand contract test with an original-design restoration test; restore main
   palette expectations in the touched tests; retain current homepage-order expectations.
3. Phase 3: close the PATCH phone-validation gap; set demo businesses to `0724317010` (demo
   records only, with tests proving real records are never rewritten); verify/extend contact-
   action and image-fallback behaviour with isolated tests.
4. Phase 4: add the Qi adapter seam + contract tests (mocked transport), live activation BLOCKED.
5. Re-run all gates, capture real-Chrome before/after evidence on the revised branch, update PR
   #69, stop for owner screenshot review. No merge, no deploy.
