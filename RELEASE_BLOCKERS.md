# Release blockers: status and evidence

Status: **BLOCKED.** Not production-ready. Do not merge or deploy from this branch until every item marked
*open* below is closed or explicitly accepted by an owner. Evidence in this file is tied to the SHA named in
each section; a passing result at an older SHA is not evidence for a later one.

## Blocking items

| # | Item | Status | Evidence / action |
|---|------|--------|-------------------|
| 1 | Database-backed CI (`interactive-business-e2e.yml`) on the release SHA | **Open (blocked)** | `workflow_dispatch` returned HTTP 403 \"Resource not accessible by integration\" at `286636d` and `99f458b`. Maintainer action: Actions → \"Interactive Business E2E\" → Run workflow → branch `arena/33ebb805-jata-aftercall` → confirm the head SHA equals the final SHA. A 403 is not a pass. |
| 2 | Preorder price integrity (`POST /api/preorders`, AI `create_preorder`) | **Closed in code, pending CI** | Prices come only from the catalogue (`unitPriceFor`, the storefront rule, then the owner's bulk rule). Unlisted items are refused. A client price or product name is ignored. A deposit must be an integer from 0 to the server total. Tests: `tests/integration/preorder-price-integrity.test.ts` (19). |
| 3 | Guest cart and tenant audit (`POST /api/cart`) | **Closed in code, pending CI** | Anonymous carts are refused (401). Guest shopping is served by the storefront checkout, which requires a published business and prices server-side. Nothing in the app creates or reads carts except this route. Cart lines must be catalogue products of the same business. A client price, a service line, or a client delivery fee is refused or ignored. Tests: `tests/integration/cart-guest-and-pricing.test.ts` (8). |
| 4 | Operation PATCH version enforcement (`PATCH /api/experience`) | **Closed in code, pending CI** | Every draft write (section op, studio fix, theme or brand, whole document) requires `expectedDraftVersion`: missing or malformed gives 428; stale gives 409; the write is a compare-and-swap on the version. See the section below. Tests: `tests/integration/experience-version-guard.test.ts`. |
| 5 | Publish and authorization recheck | **Closed in code, pending CI** | Session and ownership, then 428 for a missing version, then payment, entitlement, and validation, then 409 for a stale version, then a CAS on version and content. Unpublish needs no version. Existing tests: `tests/integration/experience-publish.test.ts`, `tests/security/*`. |
| 6 | Storage: binary media in Neon | **Open (owner decision)** | See \"Storage\" below. Current uploads store the image bytes as a `data:` URL in `MediaAsset.url` (Neon). This conflicts with the stated rule. Not changed here: moving it needs an approved durable provider. |
| 7 | Sale-price rule conflict | **Open (owner decision)** | `prisma/schema.prisma` says `basePriceKES` is authoritative and `salePriceKES` is display only. `lib/experience/pricing.ts` `unitPriceFor` (used by checkout) charges the sale price when set. Preorders now follow checkout. Resolve the schema comment or the rule. |
| 8 | Browser checks for the dashboard flows | **Not run this turn** | No Chrome in this sandbox (`CHROME_PATH` unset). See \"Browser verification\". |

## Guest cart and tenant audit

Helpers used: `canAccessBusiness` (fails closed), `assertBusinessRole`, `guardTenantMutation`, `assertBusinessOwnership`.

Fixed earlier (`tests/security/ai-front-desk-route-authorization.test.ts`):

- `GET /api/cart`: `businessId` is required and checked.
- `POST /api/intelligence/questions`: a session and ownership are required.
- `POST /api/ai/leads`: an anonymous lead is accepted only for a published business.

Fixed in this turn:

- `POST /api/cart` no longer accepts anonymous callers. The decision: guest shopping is the storefront checkout, which
  is published-only and server-priced. A cart is a business-side tool. This is an owner-visible change: if a
  customer-facing cart UI is planned, it must go through the checkout pricing path and not this route.
- Cart lines that are not catalogue products of the same business are refused, and a client `unitPriceKES` is never stored.
- A client `deliveryFeeKES` is ignored. The fee comes only from a configured delivery zone.

Still accepted, not changed:

- Leads: the anonymous path is allowed for published businesses only. Owner question: should it also require an entitled business?

## Operation-based `PATCH /api/experience` (item 4)

Decision: enforced now, with no compatibility window.

Reason: every in-repo caller already sends the version it read (table below). No external client is documented, and
the route requires a session. A window that accepted unversioned writes would keep the stale-overwrite risk open.

| Caller | Sends `expectedDraftVersion` |
|---|---|
| `StudioCopilot` (undo) | always |
| `LayoutVariantPanel` | always (`baseDraftVersion`) |
| `WebsiteHealth` (studio-fix) | always (`draftVersion` or `null`, which gets a 428) |
| `SectionEditor` | always |
| `DesignPanel`, `ThemeEditor` | always |
| `CreateExperienceForm` (create) | not applicable (creates a draft) |

Unversioned route not under this gate: `PATCH /api/media` (`MediaLibrary`) edits a media asset's metadata. It does not
touch the experience draft, so it is last-write-wins by design. Owner should confirm that is acceptable.

## Storage (item 6)

- `POST /api/media` accepts a `data:` URL up to the upload cap (5 MB of bytes) and stores the full string in
  `MediaAsset.url` (a Neon `TEXT` column). This means binary image data is in Neon today.
- `STORAGE_DECISION.md` says binary media never goes into Neon and that `assertCanStore` must be called before any
  write. No production call site calls it yet.
- The default provider (`inline-data-url`) is documented as non-durable. Durable storage (Vercel Blob or another provider)
  is not approved, so it is not implemented. Storage approval and a migration of existing rows need an owner decision.
- Customer-facing 3D stays off: `ImmersiveStage` is reached only from the dev harness, and `JATA_IMMERSIVE_ENABLED` is unset by default.

## Immersive harness (`/dev/immersive-preview`)

- Returns 404 when `NODE_ENV` is `production` (checked in the page). Model URLs are a fixed allowlist, and query values are matched against fixed lists.
- The route is still listed in the production build output. Bundle exclusion is not verified; the runtime 404 is the only guard.

## Publish (item 5)

Owner decision (recorded, implemented as the safe default): a publish that does not name the reviewed draft version is refused with 428.
A conflict returns 409 and the panel refreshes. Payment, entitlement, and validation checks run before the version check's write.

Observed, not changed: publish sets `draftVersion` to the same number it had (`nextVersion = max(1, draftVersion)`), so the
version does not advance on publish. Content still changes only through a versioned write, so no stale write is accepted,
but the numbering differs from what the history UI may assume. Low risk; verify against the history tests before changing it.

## Evidence (this turn)

Checked on the working tree that contains the changes above. The commit SHA is recorded in the final report, not here.

- `tsc --noEmit`: exit 0.
- `npm run lint`: exit 0, 1 warning (existing, `components/storefront/CartProvider.tsx` `<img>`).
- `vitest run`: 139 files passed, 5 skipped; 1640 tests passed, 51 skipped (previous turn: 137 / 5 skipped, 1607 / 51 skipped).
- `npm run build`: exit 0. Prisma engine download failed offline, so the build used the fallback client. Re-check in CI.
- Browser checks: `scripts/browser/fixture-layout.check.mjs` exits 2 (`CHROME_PATH` not set). Not run. The immersive check is also not run. Previous results (14/14, 7/7) are for an older SHA.

## Browser verification (item 8)

Headless Chromium on a fixture page; not a real device. No real Android device was tested.

- Previously (at `99f458b`): `immersive-preview.check.mjs` 14 passed; `fixture-layout.check.mjs` 7 passed. Not re-run at the final SHA.
- Not run: dashboard conflict handling, upload, publish end to end, motion-mode reveal. These need a database and a logged-in owner.
- WebP browser support: not verified on real devices.

## Owner decisions still open

1. Storage: approve a durable provider and a migration for existing `data:` URLs in Neon (item 6).
2. Sale price: whether `salePriceKES` is charged (checkout today) or `basePriceKES` is authoritative (schema comment) (item 7).
3. Whether leads should also require an entitled business.
4. Whether `PATCH /api/media` should be version-gated.
5. Motion library (unchanged): none added. Storage provider: unchanged, not approved.
