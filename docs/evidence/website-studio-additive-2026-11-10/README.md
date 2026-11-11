# Website Studio additive remediation — 2026-11-10

**Code commit:** `176b0d8f7555afb3e734087db558894b3d127138`  
**Session branch:** `arena/3ecfbb83-jata-aftercall`  
**Base:** `main` at `0f22ec7f75d09a5f8e3da845dd8ddc93c1bf4b4d` (merged PR #108)  
**Target PR:** #109, still at `f5e206774eb7c5c1af1bf8eb4948aaa59a160cde`

## What was restored

PR #109 redirected the legacy owner surfaces before OpenPage had replacement controls. The
remediation restores the merged #108 tree for every removed surface, then keeps OpenPage as the
primary AI entry:

| Surface | Restored component | State |
| --- | --- | --- |
| `/dashboard/businesses/[id]` | `PublishPanel`, `WebsiteHealth`, `EnquiryBoard`, `CreateExperienceForm`, statistics, `#publish` | Restored |
| `/dashboard/businesses/[id]/design` | `DesignPanel`, brand description and colours | Restored |
| `/dashboard/businesses/[id]/sections` | `SectionEditor`, business-recipe detail and layout | Restored |
| `/dashboard/businesses/[id]/canvas` | Canvas editor | Restored |
| `/dashboard/businesses/[id]/create` | Create flow | Restored |
| `StudioTabs` | Home, Website Studio, Canvas, Website, Create, Design, Publish | Restored |
| `/dashboard/studio` | OpenPage promoted to primary CTA; classic workspace retained | Additive |

The only net changes against `main` are the OpenPage-primary entry points and a source-level
invariant test (`tests/unit/website-studio-additive-cutover.test.ts`). No schema, API, tenant,
entitlement, payment, media or storefront file changed.

## Local gates

| Gate | Result | Exit |
| --- | --- | --- |
| `npm run lint` | 0 errors, 51 pre-existing warnings | 0 |
| `npx tsc --noEmit` | Only the three known offline-Prisma test errors | 2 |
| `npm run build` (tests temporarily excluded; restored) | Build completed | 0 |
| `npx vitest run` | 4,523 passed / 1 known offline-Prisma failure / 343 skipped (418 files) | 1 |
| Focused additive tests | 52 passed (47 route/naming + 5 new invariant) | 0 |
| `node scripts/admin/check-programme-readiness.mjs` | `NOT READY (25)` | 1 |
| `node --test scripts/admin/tests/website-studio-readiness.test.mjs` | 4 passed | 0 |

The single vitest failure is `tests/unit/autopilot-phase1-hardening.test.ts` reading
`Prisma.dmmf`; Prisma generation is offline in this sandbox. The three typecheck errors are the
same offline-Prisma tests. These are unchanged from #108.

## CI and delivery status

- `git push --dry-run origin HEAD:refs/heads/arena/website-studio-openpage-cutover` reported
  `f5e2067..7a12350` and exited 0. GitHub accepts the fast-forward; this is **not** a branch
  protection refusal.
- `gh workflow run interactive-business-e2e.yml --ref arena/3ecfbb83-jata-aftercall` returned
  **HTTP 403 Resource not accessible by integration**; this token has no Actions dispatch write.
- `npm run test:browser:studio-authenticated` refused before starting a server with
  **exit 2**: first `Isolated browser fixture writes not opted in`, then, with
  `STUDIO_BROWSER_TEST_WRITE=1`, `Dedicated test database URLs missing or unequal`. No fixtures,
  browser or passing journey were claimed.
- Pushing the session branch does not trigger the `pull_request` workflows, and Arena branch policy
  forbids pushing the target PR branch from this session.
- Therefore the **exact-head authenticated real-database journey is NOT TESTED** on `176b0d8`.
- PR #109 remains at `f5e2067` and still shows **17 pass / 2 fail / 1 skip**; its Journey failure is
  the stale `#publish` selector that this remediation removes.
- Vercel preview deployment `dpl_7bsf47HZtxGXH3gxFEbziXoDdxzG` for `176b0d8` is **READY**.
- The latest production deployment remains `dpl_HvtDkkz4TXnEFnQXaCfoatrftJ8d` for `main` at
  `0f22ec7`; no production deployment was created by this work.

## Remaining blockers

1. PR #109 must be fast-forwarded to this branch; a new PR is not needed.
2. The exact-head Journey must run on the updated PR and pass.
3. `programme-completeness` remains `NOT READY (25)`:
   - 24 substantive ADMIN/MOTION/RELEASE records with missing independent evidence/owner decisions.
   - `RELEASE-004` is a missing manifest record whose acceptance document already exists; it is a
     separate clerical correction and would only reduce the count to 24.

No production data, subscription, payment, migration or published website was changed.
