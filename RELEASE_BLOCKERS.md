# Release blockers: status and evidence

Status: **BLOCKED.** Not production-ready. Do not merge or deploy from this branch until every item marked
*open* below is closed or explicitly accepted by an owner.

## Blocking items

| # | Item | Status | Evidence / action |
|---|------|--------|-------------------|
| 1 | Database-backed CI (`interactive-business-e2e.yml`) on the release SHA | **Open (blocked)** | `workflow_dispatch` returns HTTP 403 "Resource not accessible by integration". Maintainer action: run the workflow from the Actions tab on `arena/33ebb805-jata-aftercall` and confirm the head SHA matches the release SHA. Triggers are `workflow_dispatch`, PRs to `main`, and pushes to `main` only. |
| 2 | Security review of `ai/*`, `intelligence/*`, notifications, cart, merchant-payment, preorders | **Partly closed** | Every route traced to its helper (see the tenant audit below). Gaps fixed with regression tests. Not a full external review. |
| 3 | Publish stale-tab concurrency | **Closed in code** | Publish requires `expectedDraftVersion` (428 if missing) and writes with a compare-and-swap on version and content (409 on loss). Tests: `tests/integration/experience-publish.test.ts`. |

## Tenant audit (step 4)

Helpers used: `canAccessBusiness` (fails closed, admin bypass, owner or member), `assertBusinessRole` (role weight per action, fails closed), `guardTenantMutation` (session plus ownership).

Gaps found and fixed (regression tests in `tests/security/ai-front-desk-route-authorization.test.ts`):

- `GET /api/cart`: the tenant check ran only when `businessId` was supplied. Now `businessId` is required. No UI calls this route.
- `POST /api/intelligence/questions`: plain-question writes were anonymous. Now a session is required, and ownership is checked.
- `POST /api/ai/leads`: anonymous lead capture ran for any business, published or not. Now anonymous callers may only leave a lead with a published business (the same gate as the public AI chat).

Accepted, documented, not changed:

- `POST /api/cart` is anonymous by design (storefront checkout). It does not check publication. Owner decision: apply the same published gate as leads.
- `POST /api/preorders` requires a session but trusts the client-supplied `fullPriceKES`. This is a pricing-integrity question, not tenant isolation. Owner decision needed.
- `GET /api/cart` with a `businessId` still returns the cart to anyone who holds its id plus the business id. Cart ids are cuids. Accepted as a bearer-id model.

## Operation-based `PATCH /api/experience` (step 5)

Whole-document writes require a version (428). Operation writes (`op`, `theme`, `layout`) send a version when the page supplies one.

| Caller | Sends `expectedDraftVersion` |
|---|---|
| `StudioCopilot` (undo) | always |
| `LayoutVariantPanel` | always (`baseDraftVersion`) |
| `WebsiteHealth` (studio-fix) | when the health report carries a version (always, since the route now returns it) |
| `SectionEditor` | when its page passes `draftVersion` (always in the sections page) |
| `DesignPanel`, `ThemeEditor` | when their page passes `draftVersion` (always in the design and theme pages) |
| `CreateExperienceForm` (POST create) | not applicable (creates a draft) |

Proposed compatibility-safe enforcement (owner decision, not implemented): return 428 for operation writes without a version, after one release that logs unversioned writes. All current UI callers already send a version, so the UI is unaffected. External API scripts would need to send it.

## Publish (step 3)

Owner decision (recorded, implemented as the safe default): a publish that does not name the reviewed draft version is refused with 428. The publish button sends the version shown on the panel. A conflict returns 409 and refreshes the panel. Payment, entitlement, and validation checks still run first. Unpublish still needs no version.

## Browser verification (step 6)

Headless Chromium (bundled, not a real device). No real Android device was tested.

- `scripts/browser/immersive-preview.check.mjs` (fixture page, dev server): 14 passed, 0 failed.
- `scripts/browser/fixture-layout.check.mjs` (fixture page, dev server): 7 passed, 0 failed. Covers overflow, visibility, and reduced motion only.
- Production server: `/dev/immersive-preview` returns 404. `/api/studio/health` without a session returns 401.

Not run: conflict handling in the dashboard, upload behaviour, publish, and motion-mode reveal. These need a database and a logged-in owner.

## Owner decisions still open

1. Whether anonymous cart creation and anonymous leads should also require an entitled (not just published) business.
2. Whether preorder prices should be taken from the catalogue rather than the client.
3. Whether to make the operation-PATCH version requirement mandatory (after a logging release).
4. Storage provider and motion library (unchanged from earlier decisions).
