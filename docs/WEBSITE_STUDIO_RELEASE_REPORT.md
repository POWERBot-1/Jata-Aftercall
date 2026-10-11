# Website Studio — release report

Updated 2026-10-11 UTC. **IN PROGRESS — full product NOT COMPLETE. Production NOT DEPLOYED.**

## Git identity

- Repository: https://github.com/POWERBot-1/Jata-Aftercall
- Exact implementation base: `77e35cec6a5726f569ab3febd3e7766300b14890`.
- Feature branch: `arena/7b28a123-jata-aftercall`.
- Branch URL (exists after verified push): https://github.com/POWERBot-1/Jata-Aftercall/tree/arena/7b28a123-jata-aftercall
- Proposed target: `main`; audit target/merge-base SHA `9c36bd1026e50a5ab6e66f7446ae730c71f5963a`.
- Inherited 17 commits / 156 changed files vs main must be reviewed; not already merged.
- Final implementation SHA: not recorded yet. Final documentation SHA will be recorded on the PR/handoff because a commit cannot contain its own SHA.
- M0 committed and pushed: `23726edb94d8734b26cac0ea1c9f145c2dd6f3c6`; `git rev-parse HEAD` matched `git ls-remote origin refs/heads/arena/7b28a123-jata-aftercall` after push. Later milestones must independently verify their own SHA.
- Draft PR: https://github.com/POWERBot-1/Jata-Aftercall/pull/41 (proposed base main; no merge authorized).
- Merged / resulting target SHA: NOT MERGED / not applicable.
- Production: **NOT DEPLOYED**; no deployment approved or invoked. Vercel may automatically produce GitHub previews; those are not production authorization.

## Audit and specification

Read-only baseline reported before any source edits. Working tree was clean; no conflicts, no user changes deleted. Full specification preserved in WEBSITE_STUDIO_MASTER_SPECIFICATION.md (all 0–107 blocks and execution directive). Plan records every stage, preservation boundary, conflict, migration risk and release gate. History unshallowed after baseline with no branch switch.

## Dependency evidence

Actual command **`npm install motion`**, repository root, session branch, completed exit 0 on 2026-10-11. **motion 14.1.0** verified in package.json and npm lockfile v3; `npm ls motion framer-motion motion-dom motion-utils react react-dom next three --depth=2` exits 0. Peers support React/React DOM ^18 or ^19; installed React 18.3.1 and React DOM 18.3.1 deduplicated under motion and Next 15.5.26. Exactly four lock entries added (motion, framer-motion, motion-dom, motion-utils); all pre-existing package entries byte-for-byte unchanged. Only one dependency line + 61 lockfile lines added. No unrelated dependency upgrade. Bundle measurement follows actual on-demand integration, not package installation alone. No GSAP was installed; rationale and remaining GSAP-specific requirement are in the release plan. No forced audit fix or unrelated upgrade authorized. npm reports 19 advisories (3 moderate / 16 high); triage separately rather than automatic broad dependency upgrades.

## Baseline tests (before new source integration)

| Status | Check | Evidence / qualification |
|---|---|---|
| PASSED | npm ci | 496 packages from existing lockfile; postinstall swallowed native Prisma download failure |
| PASSED | lint | One existing CartProvider img warning |
| PASSED | typecheck | Re-run with schema-generated types in final gate |
| PASSED | unit/mocked integration/security suites | 146 files / 1740 tests passed |
| SKIPPED | DB/e2e suites | 10 files / 94 tests skipped; DATABASE_URL and PRISMA_TEST_DATABASE_URL absent |
| PASSED | Prisma schema validation | Pinned CLI, dummy validation-only DATABASE_URL; no DB connection |
| PASSED | Prisma type generation | Prisma 5.22.0 --no-engine; real schema-derived types, **no runtime query engine** |
| PASSED | offline production compilation | Repository npm run build, engine-less generated client, no DB/migrations; not deployed or connected production |
| BLOCKED | Native Prisma client download | binaries.prisma.sh not permitted by sandbox outbound policy; CLI reports TLS connection failure |
| BLOCKED | Local DB migration / native real-DB suites | No local/approved test DB; CI isolated Postgres is required |
| NOT RUN | Browser / physical Android | No native browser or device at baseline; new browser checks may be run through an npm-distributed test browser and must be distinguished from physical devices |
| BLOCKED | Durable storage / actual external image providers / Paystack provider HTTP | No credentials; provider hosts outside allowed sandbox network; mocks are not live evidence |
| FAILED | None of the baseline tests that ran | Native client generation failure is reported separately, not hidden by postinstall exit 0 |

Baseline gzip entry-file totals: business home **115,794 B**, Studio design **144,384 B**, homepage **106,682 B**. Not total per-journey payload or real device performance.

## Implemented changes / acceptance / limitations

IN PROGRESS. M0 installed the dependency and preserved the directive. M1 implements the strict configuration/restore/publication foundation and closes service-read and unpublished-storefront boundaries (below). The complete recipe library, AI art director, public immersive, persistent-original media, provider photo generation, full end-to-end journey and adaptive intelligence are not delivered by these milestones. Installed motion is not yet imported by application code.

## Database / security / migration evidence

No new migration or production data change. Existing schema validated; migrations not locally deployed. Service-read visibility and explicit schema-version/publication boundaries are now fixed with mock/unit tests; eight new real-Prisma tests are written but locally skipped. Media provenance/ownership gaps remain open. No asset-ownership proof is claimed from URL shape validation. Existing entitlements/payment gates, authentication, AI Front Desk, POS and M-PESA provider logic must be preserved. Old CI/test reports are not verification of this final branch.

## Required owner decisions / release blockers

1. Confirm target main and review the 17 inherited commits against it before merge.
2. Approve a durable media provider and cost cap (smallest candidate: Vercel Blob), migration/backfill and tokens supplied via deployment environment—not chat. No storage persistence claims until exercised.
3. Configure and test external image/text providers in an authorized environment; real product consistency and campaign quality acceptance required.
4. Complete physical low-end/mid/modern Android and supported HEIC device acceptance.
5. Complete full Section 80/102 journey and all current native-Prisma/browser/CI checks.
6. Approve any distinct GSAP requirement before adding a second JavaScript animation library.
7. Explicit merge authorization after all gates. Separate explicit production deployment approval.

## Milestone evidence

### M0 — audit/specification preservation + actual motion dependency install

- Source scope: package.json, package-lock.json, .gitignore (ignore verification artifacts), full master specification, section-by-section plan, release report and preservation/dependency regression test. No application or Prisma schema change yet.
- After installation: full existing suite **1740 passed / 94 skipped**, lint passes with existing warning, typecheck passes with real generated schema types; offline repository build passes (business first-load JS still 116 kB; no motion import in app yet).
- New `website-studio-master-spec.test.ts`: **4 passed**, verifies full source-spec SHA256, all 108 numbered blocks/register rows, execution directive and actual resolvable motion/mini + locked stack. Typecheck repeated after test addition passes.
- Schema validation passed; native Prisma/DB/browser/provider/device gates still blocked or not run as above. No new migration.
- `git diff --check` passed. Dependency lock inspection: no existing entries changed. Entire M0 staged diff was reviewed before commit.
- M0 commit / verified remote SHA: `23726edb94d8734b26cac0ea1c9f145c2dd6f3c6`. No PR, merge or deployment occurred in M0.

Source and documents are committed on the session branch; ignored tool caches are not release dependencies.

### M1 — strict v1 foundation and tenant/public read boundaries

- Raw configuration whitelist validates supported schema version, registered sections/themes/modes, plain text, safe URLs, approved config, finite ranges, duplicate IDs and bounded JSON before whole-document writes/publication/restore. Missing legacy format version is accepted explicitly; explicit unsupported versions are never clamped. Malformed stored JSON cannot be silently repaired and published. Existing CAS, publication/payment/entitlement and tenant authorization gates remain authoritative.
- Legacy regression was exposed by the unchanged history test: category-only pre-v1 history initially returned 409 instead of 200. Fixed with an **explicit restore-only missing-default migration**, preserving supplied/unknown fields for strict validation. New writes, AI and publication do not opt in. Original 12-test history suite now passes unchanged.
- Storefront readers refuse unreadable/unsupported formats (classic HTML fallback), and unpublished business flags override stale experience `PUBLISHED` status. Trusted server draft preview remains available only through existing authorized callers. Null/empty coordinates no longer become invented zeroes; protocol-relative/backslash/embedded-credential URLs refused.
- Services visibility/ownership checked before catalogue queries. Owner may read draft/inactive services; all other visitors only active services of published non-suspended businesses. Public errors remain safe and result size capped.
- New schema unit suite **26 passed**, service-read mock security suite **8 passed**; publication mock suite **16 passed** including three new schema-refusal checks; existing history mock suite **12 passed**. Focused four-suite result **62 passed**.
- Full latest local suite: **149 files passed / 11 skipped; 1781 tests passed / 102 skipped / 1883 total; no failing tests**. Logs retained in ignored `.cache/verification/foundation-tests.log`. Native-Prisma foundation suite adds **8 tests, all locally SKIPPED**, not DB proof; its isolated synthetic PAID fixture is not a real Paystack verification or charge.
- `npm run lint` PASSED with the existing CartProvider img warning and next-lint deprecation; `npm run typecheck` PASSED; pinned Prisma schema validation PASSED.
- `npm run build` PASSED with no DATABASE_URL and the pinned engine-less generated client/downloader overrides used at baseline. Next reports `/b/[slug]` **5.41 kB / 116 kB first-load**, shared **103 kB**. This proves compilation, not native DB/migration or connected production runtime. No new migration.
- CI now sets **both** DATABASE_URL and PRISMA_TEST_DATABASE_URL to its disposable Postgres 16 service, adds lint/types and production-build gates, and preserves the no-skips gate. CI has not run for M1 yet. Native-Prisma instructions corrected to set the migration URL separately.
- Audit correction: later direct reads of homepage/pricing revealed price-sorted **Monthly → AI → Annual → Interactive Business**, despite the earlier assumption of required branding/order. The required **Monthly → Annual → AI Front Desk → Website Studio → separate POS** display is still OPEN at this milestone; stable `INTERACTIVE_BUSINESS` IDs/prices/payment policies will be preserved.
- `npm audit --json`: **19 advisories (3 moderate, 16 high)**, including suggested Next 15.5.27 patch and unrelated major-upgrade recommendations. No broad audit fix or dependency upgrade applied; triage remains a release blocker.
- Foundation commit / verified remote SHA: `c0818d6b22e097f0b9cc1bdce9572a507e9f95ce`. Gzip app entry totals unchanged: business 115,794 B, design 144,384 B, home 106,682 B. Full product remains **NOT COMPLETE**, production **NOT DEPLOYED**.

### M1.1 — real CI fixture correction (not a weakened test)

- First real PostgreSQL CI run: https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38142480919 on M1 head `c0818d6b22e097f0b9cc1bdce9572a507e9f95ce`, **FAILED**. Pinned native Prisma generate, lint/types, all 15 migration deploys and seed **PASSED**. Full suite failed; journey/POS/build steps **NOT RUN** after that failure.
- CI revealed an invalid new fixture assumption: BusinessStatus has PENDING/ACTIVE/SUSPENDED, not DRAFT (ExperienceStatus has DRAFT). Eight foundation cases failed in fixture setup. Corrected to unpublished PENDING Business + DRAFT experience, with a Prisma `satisfies Pick<...>` compile-time check. Kept all security/publication/restore assertions unchanged. Do not count the failed run as acceptance.
- Direct runner log download is blocked by outbound policy (`results-receiver.actions.githubusercontent.com`); failure/migration evidence obtained through the workflow's actual GitHub PR comment (ID 6109434184). CI output truncation cannot establish an exact full passing count for this failed run. Vercel automatic M1 preview reports Ready; production remains **NOT DEPLOYED**.
- Corrected native test requires a fresh CI run; local engine-less collection remains eight skipped tests, not native execution.
