# PR #7 Independent Verification (Pre-remediation record)

**Verification date:** 2026-09-28
**PR:** #7, open, targeting `main`, unmerged
**Branch:** `arena/01a0e817-jata-aftercall`
**Exact reviewed commit:** `e9ab1d02738c27f4648561360381264b334b47b2`
**Classification at that commit:** D — FAILED

This is the preserved independent verification finding set, recorded before the authorized targeted remediation. It is not an assertion about a later commit.

## Blocking findings

1. `app/api/checkout/route.ts` generated `jata_${UUID-without-hyphens}` references. The Paystack Transaction API documentation retrieved during verification specified alphanumeric characters plus `-`, `.`, `=` for references; underscore was not in the documented character set. The generated format therefore did not meet the documented constraint.
2. `lib/paystack.ts` omitted `currency` from transaction initialization. The app persisted/expects KES (`app/api/checkout/route.ts` and verification evidence matching), but Paystack defaults omitted currency to the integration currency. The production integration default could not be inspected, so KES was not guaranteed by the request.
3. The requested JATA product UI themes were absent. `lib/themes.ts` offered only `clean`, `dark`, and `warm` for public business pages; those are a separate theme system and do not satisfy the product-interface theme requirement.
4. Dependency audit of the reviewed lockfile reported 10 vulnerabilities (3 moderate, 5 high, 2 critical); `npm audit --omit=dev` reported 2 production dependency packages with 1 critical and 1 high finding. The direct production dependency `next@14.2.15` was affected; PostCSS was also flagged. Development dependency findings included Vitest/Vite-related vulnerabilities.

## Independent verification evidence

- `npm ci` completed, but Prisma postinstall could not download the engine due a sandbox TLS/network failure; the package install reported 10 vulnerabilities.
- `npm test`: 21 test files, 160 tests passed. Tests used local/mocked boundaries, not live PostgreSQL or Paystack.
- `npm run lint`: passed with no warnings/errors.
- `npx tsc --noEmit`: passed.
- `env -u DATABASE_URL npm run build`: Next.js build passed through the repository offline Prisma fallback. Migration gate was skipped because `DATABASE_URL` was absent; Prisma generation could not fetch the engine.
- `git diff --check origin/main...HEAD`: passed.
- Vercel and Vercel Preview Comments checks passed; Vercel reported the preview Ready. The preview was protected by Vercel login, preventing app/browser-level inspection. Production config/data and a real transaction were not accessed.
- Static inspection found a pre-existing policy gap: public-page access does not check suspended business status. Comparison to `origin/main` showed that behavior was not introduced by PR #7.

## Decision recorded

Do not merge/deploy the reviewed commit. Preserve payment ownership, server-derived pricing, amount/currency/reference matching, webhook HMAC validation, timing-safe comparison, idempotent settlement, and transaction boundaries. No production operation or real Paystack charge was performed.
