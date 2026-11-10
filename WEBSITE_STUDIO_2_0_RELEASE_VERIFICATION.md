# Website Studio 2.0 — per-site publication cutover: verification report

Statuses in this report are exactly one of **PASS**, **FAIL**, **BLOCKED**, **NOT TESTED**.
Nothing below is claimed as PASS without an executable command or a specific external artefact.

- Date: 2026-11-09
- PR: #104 `Website Studio: per-site publication cutover, history and rollback`
- Implementation branch: `arena/studio-publication-cutover`
- Base: `main` @ `8a59ecf912838109d1844fc86e60db9c19bbc6d1`
- Candidate commits authored by this review: `c4b5c3f5`, `7bd1aadb`, `dd03f8de`

## 1. Scope of this review

The cutover was reviewed end to end against the release directive: per-site public rendering,
tenant isolation, publication state, concurrency, history/rollback, database integrity, media,
customer acceptance, the outstanding programme findings, CI, merge and deployment.

Work was done **on the existing `arena/studio-publication-cutover` branch**, because that branch
is PR #104 itself and the directive requires #104 to be the release vehicle. The reviewer's own
session branch (`arena/7799e43c-jata-aftercall`) is branched from `main` and is not the PR, so
merging it in place would have released a different change set than the one under review.

## 2. Defects found and corrected

All four were found by executing the real route handlers and the real public loader against a
migrated PostgreSQL database. None was visible to the unit suites that were green beforehand.

### D-1 — a provisioned tenant's live website disappeared (FAIL → fixed)

**Root cause.** The legacy `BusinessExperience` fallback was gated on *"no Studio website row
exists"*. `ensureStudioWebsiteContent` copies the legacy document into
`StudioWebsiteContent.publishedJson` at provisioning time, so from the first Studio page load
onwards `sitePublished` was a truthy copy of the *old* document and the fallback never applied.
The published version number then drifted (`publishedVersion` came from the copied row), so the
site published a snapshot that was never reviewed.

**Fix.** `lib/experience/publication-state.ts` decides publication from the site's *state*, not
from whether a snapshot happens to exist. A migrated copy is not a publication: only `PUBLISHED`
is public, and only `DRAFT`/never-published may use the legacy row.

**Evidence.** `tests/integration/studio-publication-state-machine-postgres.test.ts` →
*"does not resurrect a legacy snapshot when a provisioned site has never published"*;
`tests/unit/storefront-public-content.test.ts` → *"preserves legacy publication for a newly
provisioned default site until Studio publication"*.

### D-2 — unpublishing one site blanked its siblings (FAIL → fixed)

**Root cause.** Unpublishing a website set `business.isPublished = false`, and the loader used
that same business-wide flag for *secondary* sites. `business.isPublished` therefore stood in for
per-site publication state, exactly what the directive forbids. Unpublishing the default site
took every other live site of that tenant offline.

**Fix.** The tenant flag is now cleared only when no website of the business remains `PUBLISHED`.
Unpublishing a secondary site never clears it; unpublishing the default site leaves it set while
a sibling is live; unpublishing the last live site closes the tenant's public routes.

**Evidence.** *"keeps a published sibling live when the DEFAULT site is unpublished"*,
*"keeps the default site live when a SECONDARY site is unpublished"*,
*"clears tenant visibility only when the last published site is unpublished"*.

### D-3 — publication and rollback failed with a unique-constraint error (FAIL → fixed)

**Root cause.** Publish, rollback, draft save and revision restore wrote deterministic primary
keys (`swv_<site>_<n>`, `swdr_<site>_<n>`). The migration seeds exactly those ids from the legacy
row, so the first Studio publication of a migrated site collided and returned HTTP 500. Separately
rollback derived its next draft revision from the content cursor alone, ignoring revisions already
stored, which also violated `(websiteId, draftVersion)`.

**Fix.** All history writes use database-generated ids. Rollback numbers its new revision above
both the cursor and the highest stored revision. History is still append-only.

**Evidence.** *"publishes each site independently…"*, and
`tests/integration/website-studio-multisite-api.test.ts` → *"serializes concurrent unpublish and
restores a default publication with immutable rollback history"*.

### D-4 — concurrent provisioning returned 500 instead of a conflict (FAIL → fixed)

**Root cause.** `ensureStudioWebsiteContent` did read-then-create and seeded history with an
explicit id. Two concurrent callers both saw no row and both inserted; the loser failed on the
primary key, so a legal request returned 500 rather than the 200/409 the state machine promises.

**Fix.** Every seeded write is `ON CONFLICT DO NOTHING`, read back afterwards; provisioning is
idempotent by construction and leaves no partial history row.

**Evidence.** The concurrent-unpublish scenario returned `[200, 500]` before this change and
`[200, 409]` after it.

### D-5 — stale `business.isPublished` gate on the secondary route (FAIL → fixed)

`app/b/[slug]/[siteSlug]/page.tsx` re-checked `business.isPublished` before loading, so it
inherited D-2's coupling. Tenant gating now lives solely in the state machine, and the secondary
route declares its own canonical URL (`/b/<slug>/<siteSlug>`) instead of inheriting the default
site's, which would have made every secondary site a duplicate in search.

## 3. Publication state machine

Implemented in `lib/experience/publication-state.ts`; documented in
`docs/WEBSITE_STUDIO_PUBLICATION_STATE_MACHINE.md`.

| From | To | Trigger |
| --- | --- | --- |
| absent | DRAFT | first authorized Studio provisioning |
| DRAFT | PUBLISHED | publish a reviewed draft |
| PUBLISHED | PUBLISHED | publish a newer draft, or rollback (new immutable version) |
| PUBLISHED | UNPUBLISHED | owner unpublish (terminal for legacy fallback) |
| UNPUBLISHED | PUBLISHED | re-publish a reviewed draft |
| DRAFT / PUBLISHED / UNPUBLISHED | SUSPENDED | operator suspension |
| SUSPENDED | DRAFT / UNPUBLISHED | operator reinstatement |

Anything else is rejected. An unrecognised stored status fails closed to `SUSPENDED`; a tenant
with no site row at all is pre-cutover, not an error. `SUSPENDED → PUBLISHED` is denied, so an
owner cannot silently republish a site an operator has held.

## 4. Verification performed

Run against `dd03f8de` on an isolated PostgreSQL 16 instance created for this review, migrated by
replaying the complete committed migration history.

| Check | Command | Result | Status |
| --- | --- | --- | --- |
| Migration replay from empty database | 63 `migration.sql` files applied in order via `psql` | 0 failures, 193 tables | PASS |
| Website Studio PostgreSQL suites | `WEBSITE_STUDIO_POSTGRES_TESTS=1 vitest run --config vitest.website-studio-postgres.config.ts` | 31/31 passed | PASS |
| Full no-database suite | `vitest run` | 373 files, 4405 passed, 0 failed | PASS |
| Typecheck | `tsc --noEmit` | clean | PASS |
| Lint | `npm run lint` | 0 errors, 51 warnings (pre-existing) | PASS |
| Production build | `next build --webpack` | compiled, routes emitted | PASS |

Engine note: `binaries.prisma.sh` is outside this environment's egress allowlist, so the query
engine ran as Prisma's own WASM engine via `@prisma/adapter-pg`, generated from the committed
schema by the repository's existing `scripts/erp/build-wasm-harness.sh`. It is the same Prisma
query engine, not a mock, but it is **not** the pinned native engine — the native path is covered
only by CI. This is stated so the evidence is not read as native-engine proof.

## 5. Requirement-by-requirement status

| Requirement | Evidence | Status |
| --- | --- | --- |
| Per-site public rendering (default + secondary) | 15 database tests, real `loadStorefront` | PASS |
| Secondary route never substitutes the default site | *"never substitutes the default site for …"* (missing, unpublished, suspended) | PASS |
| Draft invisibility to anonymous visitors | *"never shows a draft…"*, *"does not leak a draft of a secondary site…"* | PASS |
| Suspended tenant / suspended site rejection | *"rejects a suspended business for both routes"*, *"treats a SUSPENDED site as not resolvable…"* | PASS |
| Legacy fallback bounded and deterministic | state-machine unit suite + 2 database tests | PASS |
| No legacy revival after default-site unpublish | *"…never revives the legacy page"* | PASS |
| Per-site publication state machine | 13 unit tests + 8 route-driven database tests | PASS |
| Tenant isolation on publish/unpublish/rollback | `studio-website-publication-isolation.test.ts` (mocked), `website-studio-tenant-postgres.test.ts` (real DB) | PASS |
| Stale-write / compare-and-swap | stale draft, stale unpublish, simultaneous unpublish (`[200, 409]`) | PASS |
| Immutable publication history | versions `[1,2]` preserved, revision snapshots equal, history appended | PASS |
| Rollback creates a new version + revision | rollback scenario above | PASS |
| Cross-tenant rollback of another site's version | `websiteId_version` lookup scoped by `websiteId`; foreign version → 404 | PASS (code + DB) |
| Media / Cloudflare R2 persistence | no R2 credentials or bucket configuration in this environment | BLOCKED |
| Authenticated browser acceptance | no browser runtime and no Chrome binary available here | BLOCKED |
| Production deployment and official-domain verification | `jataaftercall.co.ke` unreachable from this environment; Vercel CLI is logged out | BLOCKED |
| Programme completeness gate (`ADMIN-*`, `MOTION-*`, `RELEASE-001`) | `check-programme-readiness.mjs` reports 24 non-PASS records on `main` | FAIL |
| Merge of PR #104 | see §7 | BLOCKED |

## 6. Blocked items, precisely

1. **R2 / media persistence — BLOCKED.**
   Missing: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, bucket name and the
   approved storage provider account. Responsible party: repository owner. Action: supply
   credentials scoped to one disposable bucket, or authorise the `STORAGE_DECISION.md` choice.
   Not fabricated and no unapproved charges made.

2. **Authenticated browser acceptance — BLOCKED.**
   Missing: a browser runtime. `cdn.playwright.dev` is outside the egress allowlist and no Chrome
   binary is installed, so the authenticated Studio journey (edit → preview → publish → history →
   rollback → mobile/desktop) cannot be driven. Responsible party: environment owner or CI.
   Action: run `npm run test:browser:studio-authenticated` in CI or a browser-capable runner. The
   unauthenticated HTTP checks in this review are **not** substituted for it.

3. **Production deployment and domain verification — BLOCKED.**
   Missing: network access to `jataaftercall.co.ke` (TLS handshake refused) and an authenticated
   Vercel session (`vercel whoami` → logged out). Responsible party: repository owner. Action:
   provide Vercel credentials or confirm the deployment is triggered by the merge, then re-run
   §15 verification from a network that can reach the domain.

4. **Programme completeness — FAIL.**
   `node scripts/admin/check-programme-readiness.mjs` exits non-zero with 24 records that are
   `BLOCKED` or `NOT_TESTED` (ADMIN-005/006/007/009/010/013/014/015, MOTION-002…018,
   RELEASE-001). This is the same result on `main` at `8a59ecf9`; it is not caused by this
   change, and it is not remediated here. It also blocks merge while it is a required check.

## 7. Merge and deployment

**BLOCKED.** Two independent reasons, both stated rather than worked around:

1. `programme-completeness` is a required check and is red (see §6.4). It is red on `main` too,
   so it cannot be made green by this change, and it must not be made non-required to obtain a
   green result.
2. Another agent held `arena/studio-publication-cutover` during this review and moved its head
   several times (`62b8a11e` → `616ca250` → `a1b4ca55` → `3d489eae` → `93e54ba1`). The exact SHA
   to merge must be the exact SHA that passed the required checks, so the merge decision belongs
   to whoever settles that branch's head.

No force-push, no check disabled, no assertion weakened, no migration run against production.

## 8. What this review did not verify

- Native Prisma engine (only WASM here; CI covers native).
- Real Chrome rendering, motion, responsive breakpoints, accessibility tree.
- R2 upload/read/persistence.
- Production logs, deployment status, DNS aliases, SEO on the live domain.
- Any payment, subscription or customer record — the fixtures create synthetic `PAID` rows in an
  isolated disposable database only.

## 9. Reproduction

```bash
# isolated database
initdb -D /tmp/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 5433 -k /tmp" start
createdb -h /tmp -p 5433 -U postgres jata_review
for d in $(ls prisma/migrations | grep -v migration_lock); do
  psql -h /tmp -p 5433 -U postgres -d jata_review -v ON_ERROR_STOP=1 -q \
    -f "prisma/migrations/$d/migration.sql"; done

# Prisma client (engine download host is blocked here; see §4)
bash scripts/erp/build-wasm-harness.sh

# the suites in this report
WEBSITE_STUDIO_POSTGRES_TESTS=1 \
PRISMA_TEST_DATABASE_URL="postgresql://postgres@localhost:5433/jata_review" \
PRISMA_WASM_HARNESS_DIR=$PWD/node_modules/.erp-wasm-harness \
npx vitest run --config vitest.website-studio-postgres.config.ts
```
