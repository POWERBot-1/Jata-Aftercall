# Dependency audit and remediation evidence — 2026-11-06

## Executive result

- Baseline production audit: **0 findings**.
- Baseline full dependency-tree audit: **8 moderate package findings, 0 high, 0 critical**.
- The eight package entries were one underlying advisory propagated through the TypeScript-ESLint dependency chain, not eight distinct vulnerabilities.
- Remediation: a narrowly scoped npm override for `@typescript-eslint/typescript-estree -> minimatch@11.0.1`, with the generated lockfile committed to the remediation branch.
- Candidate compatibility verification: **PASS** for production audit, full audit, `npm ci`, lint, TypeScript typecheck, no-database tests, and Next.js production build.
- Exact committed-head revalidation: **PENDING** after lockfile commit `3ab78550da093bf887a46a8e777a639b22e84fa9`.

## Baseline evidence

Workflow run: [42218412975](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/42218412975)

Artifact: [dependency-audit-ff2285ff71336205b3d154142a80cc91bfa8af3c](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/42218412975/artifacts/13502616440)

The captured audit JSON reported:

| Audit scope | Total | Critical | High | Moderate | Low |
|---|---:|---:|---:|---:|---:|
| Production (`npm audit --omit=dev`) | 0 | 0 | 0 | 0 | 0 |
| Full tree (`npm audit`) | 8 | 0 | 0 | 8 | 0 |

The vulnerable dependency path was:

`eslint-config-next@16.4.2` → `typescript-eslint@8.71.2` → `@typescript-eslint/typescript-estree@8.71.2` → `minimatch@10.2.6`.

Root advisory: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), a moderate denial-of-service issue in minimatch. The advisory identifies `11.0.1` as the first patched release. The audit report also showed npm's broad automatic fix proposal as a major downgrade of `eslint-config-next` to `15.5.29`; that downgrade was not applied.

The package-level entries in npm's audit graph were `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `@typescript-eslint/type-utils`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/utils`, `eslint-config-next`, `minimatch`, and `typescript-eslint`. They all traced back to the same minimatch advisory.

## Remediation

Root `package.json` now scopes the override only to the vulnerable TypeScript-ESLint edge:

```json
{
  "overrides": {
    "@typescript-eslint/typescript-estree": {
      "minimatch": "11.0.1"
    }
  }
}
```

No blanket minimatch override was introduced. The regenerated lockfile resolves:

- `node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch` to `11.0.1`.
- The unrelated root `node_modules/minimatch` to `3.1.5`, unchanged.

This scoped remediation preserves unrelated legacy minimatch consumers. Upstream TypeScript-ESLint issue [#13125](https://github.com/typescript-eslint/typescript-eslint/issues/13125) records the same upstream dependency constraint and notes that the TypeScript-ESTree call site uses the retained `minimatch(filePath, pattern, { dot: true })` API.

## Compatibility verification

Workflow run: [42220169508](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/42220169508)

Candidate source SHA before the generated lockfile commit: `7aef83250ef58099a185b5fd77bbbf35bc6b5b67`.

Job: [Verify scoped minimatch 11.0.1 remediation](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/42220169508/job/127899932370)

Results:

- Regenerate lockfile from reviewed scoped override: PASS.
- Install regenerated lockfile using `npm ci`: PASS.
- Production audit: PASS, zero findings.
- Full-tree audit: PASS, zero findings.
- Lint: PASS.
- Typecheck: PASS.
- No-database test suite: PASS.
- Next.js production build: PASS.
- Generated lockfile commit and push: PASS.

The exact generated lockfile was committed to the branch as `3ab78550da093bf887a46a8e777a639b22e84fa9`. Artifact: [minimatch11-lock-d2129e6518133d4059290e307ccb67180bd2cecf](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/42220169508/artifacts/13503526101).

## Remaining verification

The preceding compatibility run generated and tested the lockfile before committing it. All normal CI workflows must now pass against the exact committed branch head. In particular, repeat `npm ci`, both audit scopes, PostgreSQL 18 migration/rehearsal checks, browser capture and the complete programme checker against the final SHA.

This document does **not** claim that the wider 34-item programme gate is closed. The programme readiness register remains BLOCKED until each independent criterion has its own implementation, owner decision or verifiable evidence. No audit finding was suppressed and no test was skipped to obtain a pass.
