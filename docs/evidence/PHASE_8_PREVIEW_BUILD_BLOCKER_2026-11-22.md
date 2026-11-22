# Phase 8 preview build blocker and bounded visual review — 2026-11-22

## Disposition

**PREVIEW BUILD BLOCKED — DO NOT BYPASS THE ISOLATION GATE.**

This addendum records a repeatable Vercel Preview build failure on the exact candidate and the bounded image review completed during Phase 8. It does not promote MOTION-011, RELEASE-001 or overall programme readiness.

## Exact-head Vercel evidence

| Item | Value |
|---|---|
| PR #154 candidate | `b5706a1dbc3c3daa721d4c083b3818b875d06c2f` |
| PR #154 branch | `arena/mobile-hero-clearance-remediation-v5-20261122` |
| Vercel deployment | `dpl_6zYvkGA3brrmLueeyTyi5RLZkbF2` |
| Deployment URL | `jata-aftercall-r3fiyxj0k-powerbot-1.vercel.app` |
| Vercel state | `ERROR` |
| Error | `BUILD_UTILS_SPAWN_1`; `npm run build` exited 1 |
| PR #155 head | `3485cd584bd38946c1e2dd81ce1fcef933d46956` |
| PR #155 deployment | `dpl_7QAV4inEvdAU2iMXbqTDGGv8Umj8` |
| PR #155 deployment URL | `jata-aftercall-m79yoxa8k-powerbot-1.vercel.app` |
| PR #155 Vercel state | `ERROR`; same build-gate failure |

Both deployments reached `scripts/build.sh`, which invoked `scripts/ci/check-preview-environment-isolation.mjs` for Vercel Preview. The guard exited before the Next.js compilation step because the Preview environment was not isolated/configured.

The Vercel build log explicitly reports these missing keys (names only; no values are recorded):

- `DATABASE_URL`
- `DIRECT_URL`
- `JATA_STAGING_DATABASE_HOST`
- `AUTH_SECRET`
- `NEXTAUTH_SECRET`
- `PUBLIC_BASE_URL`
- `NEXTAUTH_URL`

The isolation checker additionally validates that the database URLs target the dedicated Neon `jata_staging` database and expected staging endpoint; Paystack credentials are test-mode only; storage is the designated Cloudflare R2 preview bucket; and public/auth origins are not the production domain. A successful build must pass these checks, not skip them.

### Root cause classification

**Confirmed:** missing Preview environment configuration causes the build gate to fail.

**Not established:** whether any currently configured values (including Paystack test credentials or R2 configuration) pass all semantic isolation checks. The logs do not show those as missing/invalid, but their values were not inspected and must not be disclosed.

**Non-cause:** the Node.js 26 selection warning is present because the package engine range allows Node 26 despite the project setting showing 24.x. It is a warning in this log, not the reported exit condition.

### Required owner-controlled resolution

1. Provision or designate a dedicated non-production Neon database named `jata_staging`; confirm the pooled and direct URLs resolve to its approved staging endpoint.
2. Configure the seven missing values in Vercel's **Preview** environment scope only. Use independently generated preview authentication secrets and preview-only public/auth URLs.
3. Confirm the configured Paystack credentials are test keys and R2 uses the isolated preview bucket required by the checker.
4. Verify that no Preview variable points to production databases, production payment credentials, production storage or the production domain.
5. Redeploy the same exact commit and retain the successful Vercel build logs as evidence.

This requires owner-controlled infrastructure credentials and Vercel environment changes. No values are requested in chat or committed to the repository. No production environment variable, secret, database, payment provider or storage resource was changed. The isolation guard must not be weakened or skipped to make CI green.

## Bounded visual inspection

The exact-head family artifact `14762941539` contains 480 observations across 20 template families, six viewport sizes, draft/published states and normal/reduced-motion preferences.

During this phase, contact sheets were generated and visually screened for:
- all 20 published families at 320×568 normal motion;
- all 20 published families at 320×568 reduced motion;
- individual 320×568 examples for the experimental and spatial families.

The reviewed samples show the expected storefront content structure, readable page flow and consistent bottom contact/action region. The install-app prompt is visible above the storefront in the reviewed samples and consumes substantial vertical space; this is recorded as a review consideration, not declared a defect without interaction and dismissal testing.

This is a **bounded screening review only**. It is not a complete inspection of all 480 images, all six viewports, all draft/published pairs, all route videos, keyboard/focus behaviour or matched historical/current screenshots. No 480-row visual PASS is claimed.

## Readiness and release effect

The canonical readiness register on the PR #154 candidate still contains 47 requirements:
- PASS: 23
- BLOCKED: 21
- NOT_TESTED: 3

MOTION-011 and RELEASE-001 remain BLOCKED. The programme-completeness gate remains authoritative and must not be bypassed. The successful isolated Chrome capture workflow does not override the failed Vercel Preview deployment check.

## Change boundary

This is documentation-only evidence. No source implementation, readiness status, checker, production database, customer record, entitlement, payment, provider, secret, Vercel environment, DNS, merge or deployment was changed.
