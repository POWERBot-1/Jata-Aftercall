# Full dependency audit disposition — picomatch ReDoS

Status: **BLOCKED — no waiver, suppression, unsafe downgrade or unreviewed fork applied.**

## Exact audit evidence

- Candidate SHA: `4cd6dd59b41a8f25e44820bf691a1394685bebc9`
- Release Validation workflow: [run 44167665373](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44167665373)
- Full audit artifact: `pr125-static-logs.zip`, artifact ID `14365947805`, file `audit-full.json`
- Full dependency audit: 16 HIGH package-level findings; 0 critical, 0 moderate, 0 low.
- Production-only audit: 0 findings.
- All 16 package-level findings propagate through the same GHSA: [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), a high-severity ReDoS in single-branch repeated extglobs.

## Vulnerable dependency instances

The lockfile contains four affected installations:

| Lockfile path | Version |
|---|---:|
| `node_modules/picomatch` | 2.3.2 |
| `node_modules/tinyglobby/node_modules/picomatch` | 4.0.7 |
| `node_modules/vite/node_modules/picomatch` | 4.0.7 |
| `node_modules/vitest/node_modules/picomatch` | 4.0.7 |

The 16 HIGH entries are the affected dependency nodes and their transitive consumers, including `fdir`, `tinyglobby`, `micromatch`, `fast-glob`, Vite, Vitest, ESLint and TypeScript-ESLint packages. They are in the development/build/test toolchain; the production-only dependency audit confirms none is in the production dependency tree.

## Upstream status and unsafe alternatives

- Upstream v4 remediation: [picomatch PR #238](https://github.com/micromatch/picomatch/pull/238), still unmerged at the time of this review.
- Upstream v2 remediation: [picomatch PR #246](https://github.com/micromatch/picomatch/pull/246), still unmerged at the time of this review.
- [PR #194](https://github.com/micromatch/picomatch/pull/194) is a separate parser correction; it is not the fix for this advisory.
- The npm audit metadata proposes major downgrades of `eslint-config-next`, Vite and Vitest as indirect ways to remove vulnerable dependency paths. These are not applied: they would change the selected framework/test-toolchain majors and require compatibility review.
- No patched npm release was available in the audited lockfile. No guessed version, Git branch override, advisory ignore, lockfile falsification or local version masquerade was introduced.

## Disposition and release gate

1. Keep the full dependency audit finding **OPEN/BLOCKED**.
2. Keep the production-only audit result **PASS**; do not confuse it with a clean full dependency tree.
3. Do not merge or deploy while the full security gate is red.
4. When the maintainer publishes a patched release for both affected lines, update the lockfile to the supported release(s), run the full test matrix, and require `npm audit` to report zero HIGH/CRITICAL findings.
5. If a locally maintained patch is ever considered, require a separately reviewed patch, regression tests for the published exploit patterns, compatibility tests for every dependent tool, provenance and maintenance ownership. It must not be represented as an official upstream release.

This is a precise disposition of the current evidence, not a risk acceptance or security waiver.
