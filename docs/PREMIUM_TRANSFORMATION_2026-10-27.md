# Premium Transformation — evidence register (2026-10-27)

Branch: `arena/b45b361f-jata-aftercall` · base: `origin/main` @ `b716247` · PR: review-only,
no merge/deploy/migration.

This is the hub document for the seven-phase directive. It records what changed, why, how it
was verified, and the honest status of everything the sandbox cannot prove. It references the
two audit documents rather than duplicating them:

- Storage (Phase 3): `R2_SETUP.md`, `STORAGE_DECISION.md`, `lib/storage/*`
- Seeded accounts (Phase 4): `docs/security/SEEDED_ACCOUNT_AUDIT_2026-10-27.md`
- Domain (Phase 5): `docs/domain/JATA_AFTERCALL_DOMAIN_CHECKLIST_2026-10-27.md`

## 1. Art direction

One cohesive system replaces the warm espresso/cream/amber look:

- **Graphite** (`#16181d`, steps `#22262e` / `#2a2f38`; dark theme `#23262f` / `#2d313b` /
  `#454b58`).
- **Electric lime** `#b6ff2e` (hover `#c8ff5c`) — the same primary the "Lime Spark / Graphite"
  product theme already owned — with **deep lime `#4d6b12`** as the AA-safe expression on light
  paper and tint `#eefad2` for chips/washes.
- **Premium-light paper**: cool off-white `#f5f7f4`, white cards `#ffffff`, neutral hairlines.
- **Typography**: the editorial serif display face is retired; marketing and product now share
  Inter with weight-700 headings and tight tracking.
- **Discipline**: lime is the brand/CTA colour only. Amber remains exclusively the *semantic
  warning* colour (`--jata-warning`, `bg-amber-*` alerts), so status meaning never muddies the
  brand.

All work was done through the existing token architecture (`--lp-*`, `--ws-*`, `--jata-*`), so
the ~50 surfaces that consume tokens inherit the transformation without per-page rewrites, and
both product themes keep working.

## 2. Surface-by-surface register

| Surface | Before | After (this branch) | Mechanism / evidence |
 | --- | --- | --- | --- |
| Homepage plan order | Monthly, Annual, AI FD, Website Studio, POS, Autopilot | **Monthly KES 149 → Annual KES 999/yr → AI Business Front Desk → JATA Auto Pilot → Website Studio → Business POS** (owner mandate) | `HOMEPAGE_PLAN_ORDER` in `lib/pricing.ts`; order-only change, IDs/prices/entitlements untouched |
| Landing — palette | Espresso `#14110f`, cream, amber `#f0a03c` | Graphite + lime + light paper; every warm literal swept from the landing stylesheet span | `app/globals.css` `.lp-*` block; `premium-redesign-2026.test.ts` asserts no warm literal remains |
| Landing — type | Serif display (`ui-serif … Palatino/Georgia`) | Inter, 700-weight headings | `--lp-display` token; test asserts no `ui-serif` in the landing block |
| Landing — hero/pricing/nav/footer | Dark warm bands, amber CTAs | Graphite bands, lime CTAs with graphite labels, dual-tone focus, featured pricing card with lime ring + hover lift | Refinement layer in the `.lp-*` section (additive, same selectors) |
| Landing — light sections | Warm cream cards, orange kickers | Cool paper, lime-tint kicker chips, hairline + soft-lift story/step cards | Same |
| Demo showcase band | Espresso scrims, amber accents | Graphite scrims, lime accents; Inter headline | `.jata-showcase*` rules |
| Dashboard shell (all 47 pages) | Light theme + warm amber accent; dark theme mixed warm charcoal + amber buttons | Cool premium-light tokens; lime-spark dark theme now truly cool graphite with **lime primaries** matching its `--color-*` contract | `.ws-shell` token retune + lime-spark override block; `--ws-on-ink` literal preserved per existing test |
| Workspace headings | Serif, weight 600 | Inter, weight 700 across hero/panel/plan/door/empty/auth titles | Premium workspace refinement block |
| Cards, stat tiles, tables, doors | Flat grey hovers | One hover-elevation language; lime-tinted table row hover; lime kicker chips | Same block; reduced-motion coverage extended |
| Overview chart | Directions series in burnt orange `#c2410c` | Deep lime `#4d6b12` (Views stays bright lime) | `components/DashboardClient.tsx` |
| AI Front Desk cockpit | Inherited warm workspace tokens | Inherits the full graphite/lime retune; mobile snap stepper and 44px controls unchanged | Token cascade; `ai-front-desk-accessibility` tests still green |
| Autopilot / Studio / POS / Subscription | Warm token look | Full retune via `ws-*` tokens; zero hard-coded colours found in these pages | Source grep + cascade |
| Auth / onboarding / recovery | Warm split layout | Graphite aside + lime accents via `.ws-auth` tokens | Token cascade |
| Shared empty/loading/error/skeleton | Warm-grey primitives | Cool neutral + lime focus via `jata-*` tokens | `components/ui/StateBlocks.tsx` unchanged; tokens retuned |
| AI config legacy screen (`/onboarding/ai`, `AIConfigForm`) | Slate-950 + amber-300 | **Deliberately retained** — its amber is caution semantics (pause/failed checks); out of brand-scope | Documented decision |
| Customer storefront/business pages (`--eb-*`, `lib/themes.ts`) | Owned customer themes | Untouched — customer products keep their palettes | Boundary discipline |

### Mobile-first guarantees (source-level)

- No fixed pixel widths introduced; existing guards remain: AFD tests forbid `w-[NNNpx]`/
  `min-w-[NNNpx]` and require `min-h-11` controls.
- Horizontal-scroll containers keep scroll-snap and hidden scrollbars (pricing/nav rail, AFD
  stepper, demo tabs); tables keep their scroll wraps (`.jata-table-wrap`, `.ws-table-wrap`).
- Every new transition is covered by the two reduced-motion blocks (landing `.lp-page *`
  wholesale; workspace block extended with `.ws-stat`/`.jata-card`).
- All new colour pairs are asserted at WCAG AA 4.5:1 in `premium-redesign-2026.test.ts`, and
  the pre-existing contrast suites remain green.

## 3. Verification — exact commands and honest results

| Command | Result | Notes |
 | --- | --- | --- |
| `npm run lint` | **PASS** — 0 errors, 41 warnings | Identical warning set to baseline (verified by stashing); none from changed files |
| `npx tsc --noEmit` | **PASS for app/components/lib**; 4 errors in `tests/prisma` + one unit test | Pre-existing offline-Prisma-stub errors only; identical at baseline (see §5) |
| `npx vitest run` | **PASS (with 1 known offline failure)** — 2,987 passed, 121 skipped, 1 failed | Sole failure: `autopilot-phase1-hardening` DMMF test, requires downloaded Prisma engine; CI-green per prior release evidence |
| `npm run build` | **Compiles successfully**; gate exits 1 at type-check on the same four Prisma-stub errors | Exit code and diagnostics identical at baseline; webpack/Tailwind/PostCSS compile the new CSS cleanly |
| `node --check scripts/browser/pricing-grid.check.mjs` | **PASS** | Browser run itself stays NOT RUN (no engine) |
| New: `npx vitest run tests/unit/premium-redesign-2026.test.ts` | **PASS — 15 tests** | Tokens, no-warm-literal guards, AA contrast, refinement mechanics |
| New: `npx vitest run tests/unit/seeded-account-audit.test.ts` | **PASS — 14 tests** | Phase 4 regression guard |
| Full storage suites (`r2-storage`, `storage-provider`, `storage-quota`, `media-persistence-policy`, `durable-asset-store`) | **PASS — 43 tests** | Phase 3 evidence |

### Viewport matrix (320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768)

| Viewport | Visual/screenshot status |
 | --- | --- |
| All six | **NOT TESTED** — the sandbox has no Chrome/Chromium/Firefox binary, no display, and browser downloads are network-blocked. `scripts/browser/*.check.mjs` honestly exit 2 (`NOT RUN`) without `CHROME_PATH`. No screenshots were fabricated. Source inspection confirms responsive mechanisms but is not visual evidence. Owner/CI capture is required before launch sign-off. |

## 4. Phase 3 — durable object storage (R2): implemented, not activated

The full stack already exists in the tree (landed via PR #68) and was re-verified on this
branch; nothing in the payment/data path was changed to deliver it:

- Adapter `lib/storage/r2.ts` (AWS SDK v3, already in `package.json` — no new dependency),
  safe tenant keys `lib/storage/keys.ts`, fail-closed selection `lib/storage/index.ts`, inline
  provider that refuses writes, media-route integration with quota + audit + orphan cleanup.
- Server-only env names documented in `.env.example` and `R2_SETUP.md`:
  `JATA_STORAGE_PROVIDER`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (plus optional `R2_ENDPOINT`). No values exist in the repo
  and none were added.
- Failure handling: missing/incomplete config → 503 with an honest message; no data URLs in
  Neon; generic errors that never leak endpoints/credentials.
- **Activation state:** unchanged — no production env changes, no bucket provisioning, no real
  uploads, no paid resources. Enablement remains the separately-gated owner runbook.

## 5. Known pre-existing environment limitation (not introduced here)

`prisma generate` cannot download its engine offline in the sandbox, so a stub client is used.
That produces four fixed type errors and one DMMF unit-test failure locally. Both were proven
identical at the untouched baseline by running the same commands against a stashed tree. CI,
where the engine download succeeds, is the authoritative gate and was green for the baseline
release (PR #68).

## 6. Boundary guards (run on the final diff)

`git diff --name-only origin/main` contains **no** files matching Paystack routes/webhooks,
`lib/paystack.ts`, `prisma/schema.prisma`, migrations, `package-lock.json`, or `.env*`.
Plan keys, prices, billing intervals, entitlements, auth/tenant logic and the public/customer
theme systems are untouched. The homepage reorder changes presentation rank only.

## 7. Explicit non-actions

Nothing was merged, deployed, migrated, provisioned or activated. No production secrets were
read or requested. Seeded accounts were not modified (audit-only). No DNS/Vercel domain/TLS
setting was touched. No real payments or paid AI/R2 actions were taken.

## 8. Recommended owner follow-ups (separate approvals)

1. Capture the six-viewport screenshot pass (or wire a CI browser) and attach to the PR.
2. Decide seeded-account retention against `docs/security/SEEDED_ACCOUNT_AUDIT_2026-10-27.md` §4.
3. Schedule R2 preview activation per `R2_SETUP.md`, then the separate production gate.
4. Execute the branded-domain runbook in
   `docs/domain/JATA_AFTERCALL_DOMAIN_CHECKLIST_2026-10-27.md` when ready.
