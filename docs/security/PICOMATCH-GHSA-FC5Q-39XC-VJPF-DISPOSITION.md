# picomatch GHSA-fc5q-39xc-vjpf — disposition

**Status: RESOLVED — advisory withdrawn; exact-head npm audits clean**

Review date: 2026-11-20  
Repository: `POWERBot-1/Jata-Aftercall`  
Reviewed PR #126 head at time of verification: `651a40b9a3c96444a6b53b3599227a268f9aea00`

## Authoritative advisory status

GitHub Advisory Database records GHSA-fc5q-39xc-vjpf (CVE-2026-112366) as **withdrawn on 2026-11-18**. Its withdrawal notice states that the advisory was withdrawn because it is not a security issue.

Primary source: https://github.com/advisories/GHSA-fc5q-39xc-vjpf

The previous finding in the 2026-11-17 remediation report described the advisory as active and awaiting an upstream patched version. That description became stale after the withdrawal and is superseded by this record.

## Dependency inventory

The PR #126 `package-lock.json` at the reviewed head contains these picomatch package entries:

| Lockfile path | Version | Lockfile classification |
|---|---:|---|
| `node_modules/picomatch` | 2.3.2 | `dev: true` |
| `node_modules/tinyglobby/node_modules/picomatch` | 4.0.7 | `dev: true` |
| `node_modules/vite/node_modules/picomatch` | 4.0.7 | `dev: true` |
| `node_modules/vitest/node_modules/picomatch` | 4.0.7 | `dev: true` |

No direct production dependency on picomatch is declared in `package.json`. No picomatch override was added.

## Exact-head audit evidence

Release Validation run: https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44742454584  
Static job: `136309375507`  
Reviewed commit: `651a40b9a3c96444a6b53b3599227a268f9aea00`

The job ran both audit scopes and recorded:

- `npm audit --omit=dev --json`: exit code 0.
- `npm audit --json`: exit code 0.
- Audit summarizer: production tree PASS, 0 findings.
- Audit summarizer: full tree PASS, 0 findings.
- The workflow's production dependency gate passed.

## Remediation decision

No dependency mutation is justified for this withdrawn advisory. In particular, this remediation did **not**:

- add a forced picomatch override;
- downgrade Vite, Vitest, Next.js, or other parent tooling;
- suppress or ignore the advisory;
- edit lockfile integrity metadata;
- fork or vendor picomatch.

The correct remediation is to correct the stale audit/readiness records and retain the exact-head npm audit evidence. Re-run both npm audit scopes after any subsequent dependency or lockfile change.

## Scope and release impact

This closes the picomatch advisory finding only. It does not close the overall PR #126 release gate. The programme register still contains 21 BLOCKED and 3 NOT_TESTED requirements at the reviewed baseline; Vercel Preview/Neon staging and other owner/external acceptance gates remain separate. Do not interpret this advisory closure as approval to merge or deploy.
