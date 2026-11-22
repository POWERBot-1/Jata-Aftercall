# Phase 9 CI failure classification — 2026-11-22

## Summary

The latest PR #155 head `fa072d5f31b0541bca54be0bc11bfd551005981b` has two independently failing acceptance surfaces:

1. Vercel Preview deployment failed in the Preview environment isolation guard before Next.js compilation.
2. GitHub's aggregate `Admin instruction integrity` workflow failed because the repository-wide programme-completeness gate correctly rejected unresolved requirements. The workflow's separate `instruction-integrity` job passed.

No failure was addressed by weakening a gate or changing acceptance status.

## GitHub Actions evidence

| Workflow/job | Run | Job | Result |
|---|---:|---:|---|
| Admin instruction integrity / programme-completeness | `45063401350` | `137334119000` | FAIL |
| Admin instruction integrity / instruction-integrity | `45063401350` | `137334119226` | PASS |
| POS / ERP - PRO verify | `45063401362` | `137334119283` | In progress at time of inspection |

The failed programme-completeness job:
- Passed both test suites: `scripts/admin/tests/programme-readiness.test.mjs` and `scripts/admin/tests/website-studio-readiness.test.mjs`.
- Failed only at `Require verified repository-wide programme acceptance`.
- Executed `node scripts/admin/check-programme-readiness.mjs`.
- Reported `NOT READY (24)`, consisting of unresolved BLOCKED and NOT_TESTED requirement IDs.
- The checker listed unresolved ADMIN and MOTION requirements, including `MOTION-011` and `RELEASE-001`.

The separate instruction-integrity job completed successfully. Therefore, it is inaccurate to describe the aggregate failure as an instruction-integrity defect: the instruction-integrity subcheck passed; the repository-wide readiness gate failed for its intended reason.

The canonical readiness manifest remains 47 requirements: 23 PASS, 21 BLOCKED, 3 NOT_TESTED. The 24-item checker output is the unresolved set (21 + 3), not a separate total.

## Vercel Preview failure remains confirmed

Latest PR #155 head deployment:
- Deployment ID: `dpl_Gju362FSHemjy1eCwmo9t8wGLc4k`
- Commit: `fa072d5f31b0541bca54be0bc11bfd551005981b`
- State: `ERROR`
- Error: `BUILD_UTILS_SPAWN_1`; `npm run build` exited 1.

The build log again shows the Preview isolation guard rejecting missing `DATABASE_URL`, `DIRECT_URL`, `JATA_STAGING_DATABASE_HOST`, `AUTH_SECRET`, `NEXTAUTH_SECRET`, `PUBLIC_BASE_URL` and `NEXTAUTH_URL`. Prisma Client generation completed before this guard; Next.js compilation did not start.

## Required next work

1. Owner-controlled Preview configuration must provide a dedicated Neon `jata_staging` endpoint, test-mode Paystack credentials, the approved isolated Cloudflare R2 preview bucket, independent preview auth secrets and non-production public/auth URLs.
2. Re-run the Preview build without bypassing the isolation checker. Capture the successful exact-commit deployment evidence.
3. Resolve each blocked/not-tested requirement through its actual implementation and acceptance evidence. Do not edit status labels or acceptance criteria to clear the gate.
4. Reconcile the POS / ERP - PRO workflow when its current run completes; this record does not infer its final result.

## Change boundary

Documentation-only. No source implementation, readiness status, checker, tests, environment variables, secrets, infrastructure, database, customer records, payments, provider configuration, merge or production deployment was changed.
