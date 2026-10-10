# Release blockers: status and evidence

Status: **BLOCKED.** Not production-ready. Do not merge or deploy from this branch until every item marked
*open* below is closed or explicitly accepted by an owner. Evidence in this file is tied to the SHA named in
each section; a passing result at an older SHA is not evidence for a later one.

Decision proposals for items 6 and 7 are in `RELEASE_DECISIONS.md`.

## Blocking items

| # | Item | Status | Evidence / action |
|---|------|--------|-------------------|
| 1 | Database-backed CI (`interactive-business-e2e.yml`) on the release SHA | **Open (blocked)** | `workflow_dispatch` returned HTTP 403 "Resource not accessible by integration" at `286636d`, `99f458b`, and `685e6e7`. Maintainer action: Actions → "Interactive Business E2E" → Run workflow → branch `arena/33ebb805-jata-aftercall` → confirm the head SHA equals the final SHA. A 403 is not a pass. |
| 2 | Preorder price integrity (`POST /api/preorders`, AI `create_preorder`) | **Closed in code, pending CI** | Prices come only from the catalogue (`unitPriceFor`, then the owner's bulk rule). Unlisted items are refused. A client price or name is ignored. A deposit must be an integer from 0 to the server total. Tests: `tests/integration/preorder-price-integrity.test.ts` (19). Whether the sale price applies is item 7. |
| 3 | Guest cart and tenant audit (`POST /api/cart`) | **Closed in code, pending CI** | Anonymous carts are refused (401). Guest shopping is served by the storefront checkout, which requires a published business and prices server-side. Cart lines must be catalogue products of the same business. A client price, a service line, or a client delivery fee is refused or ignored. Tests: `tests/integration/cart-guest-and-pricing.test.ts` (8). |
| 4 | Operation PATCH version enforcement (`PATCH /api/experience`) | **Closed in code, pending CI** | Every draft write requires `expectedDraftVersion`: missing or malformed gives 428; stale gives 409; the write is a compare-and-swap on the version. Tests: `tests/integration/experience-version-guard.test.ts`. |
| 5 | Publish and authorization recheck | **Closed in code, pending CI** | Session and ownership, then 428 for a missing version, then payment, entitlement, and validation, then 409 for a stale version, then a compare-and-swap on version and content. Unpublish needs no version. |
| 6 | Storage: binary media in Neon | **Open (owner decision)** | Image bytes are stored as `data:` URLs in `MediaAsset.url` and copied into draft, published, version, history, and product rows. Deleting an asset does not remove those copies. Proposal and the exact decision: `RELEASE_DECISIONS.md` §1. Nothing moved or deleted. |
| 7 | Sale-price rule conflict | **Open (owner decision)** | Checkout, pre-orders, and member carts charge the sale price. AI orders, the conversational cart, and the AI conflict check use the base price. No sale window exists. The schema comment says the base price is authoritative. Full map and options: `RELEASE_DECISIONS.md` §2. Current behaviour is unchanged. |
| 8 | Browser checks for the dashboard and storefront flows | **Blocked (no browser)** | No Chrome or Chromium in this sandbox, and it cannot be downloaded. See "Browser verification". |
| 9 | Database-backed tests (`tests/e2e/*`, DB-backed suites) | **Not run here** | No `DATABASE_URL` and no Prisma query engine in this sandbox. Covered only by CI item 1. |

## Guest cart and tenant audit

Helpers used: `canAccessBusiness` (fails closed), `assertBusinessRole`, `guardTenantMutation`, `assertBusinessOwnership`.

Fixed earlier (`tests/security/ai-front-desk-route-authorization.test.ts`):

- `GET /api/cart`: `businessId` is required and checked.
- `POST /api/intelligence/questions`: a session and ownership are required.
- `POST /api/ai/leads`: an anonymous lead is accepted only for a published business.

Fixed in `685e6e7`:

- `POST /api/cart` no longer accepts anonymous callers. The decision: guest shopping is the storefront checkout, which
  is published-only and server-priced. A cart is a business-side tool. If a customer-facing cart UI is planned, it must
  go through the checkout pricing path, not this route.
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

## Publish (item 5)

Owner decision (recorded, implemented as the safe default): a publish that does not name the reviewed draft version is
refused with 428. A conflict returns 409 and the panel refreshes. Payment, entitlement, and validation checks run before the write.

Observed, not changed: publish sets `draftVersion` to the same number it had (`nextVersion = max(1, draftVersion)`), so the
version does not advance on publish. Content still changes only through a versioned write, so no stale write is accepted,
but the numbering may not match what the history UI assumes. Low risk; verify against the history tests before changing it.

## Storage (item 6) — summary

- `POST /api/media` accepts a `data:` URL up to 4,000,000 characters (about 3 MB of image) and stores the full string in
  `MediaAsset.url` (a Neon `TEXT` column). The same copy is then written into the experience documents, version snapshots,
  draft history (up to 30 per business), and `Product.imageUrl`.
- `STORAGE_DECISION.md` says binary media never goes into Neon and that `assertCanStore` must be called before any write.
  No production call site calls it yet.
- The default provider (`inline-data-url`) is documented as non-durable. Durable storage is not approved, so it is not implemented.
- Customer-facing 3D stays off: `ImmersiveStage` is reached only from the dev harness, and `JATA_IMMERSIVE_ENABLED` is unset by default.

## Immersive harness (`/dev/immersive-preview`)

- Returns 404 when `NODE_ENV` is `production` (checked in the page). Model URLs are a fixed allowlist.
- The route is still listed in the production build output. Bundle exclusion is not verified; the runtime 404 is the only guard.
- Verified this turn on the production server: `GET /dev/immersive-preview` returns 404.

## Evidence (this turn)

Checked on the branch head at the start of this turn, `685e6e7` (equal to `origin/arena/33ebb805-jata-aftercall`),
plus one pricing fix in the commit that adds this section. The final SHA is in the report.

- **Prisma client:** the sandbox cannot reach `binaries.prisma.sh`, so the normal engine could not be downloaded. The first
  generated client was an offline stub with no model types, so the earlier type-check did not cover database calls.
  This turn, types were generated with `prisma generate --no-engine` against placeholder engine files outside the repo.
  Runtime queries cannot run here: there is no engine and no `DATABASE_URL`. Result: **real types, no runtime engine.**
- `tsc --noEmit` (real types): exit 0, 0 errors.
- `npm run lint`: exit 0, 1 existing warning (`components/storefront/CartProvider.tsx`, `<img>`).
- `vitest run` (real types): 139 files passed, 5 skipped; 1640 tests passed, 51 skipped.
- Bug found by the real client: `getPlanByKey` (`lib/pricing.ts`) had no error handling, so with no database the AI
  package lookup threw. The stub had returned `undefined`, which hid it. Fixed: a database error now reads as "no stored
  plan", matching `getPlanConfig`. Affected tests: `tests/unit/pricing-ai.test.ts` and `tests/unit/phase1-foundation.test.ts`, now passing.
- `npm run build` with placeholder engine env vars: exit 0, "Compiled successfully". Static generation logged two
  `PrismaClientInitializationError` lines (no engine, no database), so the build is a partial signal only.
- Production server (`next start`, built output), HTTP checks without a browser:
  - `GET /dev/immersive-preview` (with and without `?model=ok`): **404**.
  - Anonymous `POST /api/cart`: **401** "Authentication required."
  - Anonymous `POST /api/preorders`: **401** "Authentication required."
  - Anonymous `PATCH /api/experience` (no version): **401** "Please sign in to continue."
  - Anonymous `POST /api/media`: **401**. Anonymous `GET /api/studio/health`: **401**.
  These are session gates only. They do not exercise the version or tenant gates on real data.

## Browser verification (item 8)

- **Blocked this turn.** No Chrome or Chromium is installed, and the sandbox cannot download one. `scripts/browser/fixture-layout.check.mjs` exits 2 (`CHROME_PATH` not set). The immersive check was not run.
- Previously (at `99f458b`): `immersive-preview.check.mjs` 14 passed; `fixture-layout.check.mjs` 7 passed. These are for an older SHA and are not evidence for this one.
- Not run at any SHA: dashboard conflict handling, upload, publish end to end, motion-mode reveal. These need a database and a logged-in owner.
- No real Android device was tested. WebP browser support is not verified on real devices.

## Owner decisions still open

1. Storage: approve a provider, a plan, and a migration for existing `data:` URLs (`RELEASE_DECISIONS.md` §1.11).
2. Sale price: choose option A, B, or C (`RELEASE_DECISIONS.md` §2.6).
3. Whether leads should also require an entitled business.
4. Whether `PATCH /api/media` should be version-gated.
5. Motion library: none added. Storage provider: not approved.
