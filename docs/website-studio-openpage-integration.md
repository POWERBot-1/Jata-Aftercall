# OpenPage integration into JATA Website Studio

- Upstream: https://github.com/buildingopen/openpage
- Pinned upstream commit: `9818eb43a88e01b23cb55752e19902d8285a853b`
- License: MIT; upstream license and attribution retained in this directory
- Canonical editor document: OpenPage `SiteConfig` JSON
- Supported native block registry: 19 block types
- JATA Website Studio price: **KES 999 / 30 days** (unchanged)
- Production domain: https://jataaftercall.co.ke

## Product boundary

OpenPage's complete editor surface is the Website Studio editor. The pinned upstream source is vendored under `vendor/openpage/src`; JATA mounts its editor layout inside the authenticated business workspace.

The upstream standalone Vite root, project dashboard, settings route, and deployment route are not mounted as a second application. JATA replaces those outer application boundaries with its own authenticated business/workspace routing, tenant authorization, entitlement, server persistence, media library, AI provider, public rendering, and publish/rollback lifecycle. This preserves OpenPage's editing surface while avoiding a second login, browser-local project database, or upstream deploy-key path.

The mounted editor includes the upstream canvas, toolbar, block registry/renderers, left/right sidebars, layers and properties, JSON drawer, themes, templates, keyboard shortcuts, HTML export, generation overlay, and version-history interface. The standalone OpenPage components/demo route is not a second public JATA product surface.

## Implemented integration

### Editor and document lifecycle

- The native OpenPage editor is mounted at the authenticated JATA Website Studio route.
- JATA resolves a default `StudioWebsite` for the selected business and passes its opaque website identity to the editor.
- OpenPage's browser-local project/config persistence is replaced by authenticated server APIs.
- Debounced autosave writes canonical `SiteConfig` JSON with optimistic draft-version compare-and-swap.
- Each successful save creates an immutable `OpenPageSiteRevision` snapshot in the same transaction.
- The Version History panel reads server-backed draft revisions and immutable publication snapshots. Draft restoration uses the normal autosave path; publication restoration creates a new rollback publication.
- The JATA-native publish/unpublish lifecycle requires the authorized website, active entitlement, a saved draft, and exact version checks.

### Multi-tenant authorization

- `StudioWebsite` resolves through its workspace/business relation; the schema enforces the workspace/business pairing.
- Access requires the business role plus active workspace and website memberships. Workspace/site permissions can reduce, but cannot exceed, the business permission ceiling.
- Document, revision, publication, media, generation and publish/rollback operations are scoped to the authorized website/business.
- Cross-tenant read/write/publish/export refusal is a required acceptance gate, not inferred solely from the schema.

### AI, media and rendering

- Site generation is routed through JATA's server-side design engine; provider credentials are not placed in browser code.
- Image fields in the OpenPage properties panel use JATA's tenant-scoped media picker. Video blocks retain their upstream YouTube/Vimeo URL model.
- Public default and nested-page routes resolve the exact published OpenPage snapshot and render it through the pinned upstream block registry and theme system.
- Existing JATA Experience/Business Page data is preserved. The legacy renderer remains the compatibility fallback until a native OpenPage publication is authoritative for that website.
- The upstream AgentPanel remains an editor-side component; its inline block-edit suggestions are distinct from JATA's server-side prompt-to-site generation and from the separate AI Front Desk product.

## Pricing and entitlement

The server-authoritative entitlement constants remain:

- Plan key: `INTERACTIVE_BUSINESS`
- Price: `KES 999`
- Duration: `30 days`

Checkout asserts the stored plan key, price and duration. The OpenPage integration does not change Paystack semantics, create subscriptions, or alter existing customer/payment records.

## Data and migration safety

- Native OpenPage documents, draft revisions and publication snapshots use separate additive models and a dedicated migration.
- Existing business, customer, catalogue, order, booking, payment, subscription, media and legacy Experience records are not deleted or rewritten by this integration.
- Draft JSON is not public. Public routes resolve only the exact website's published snapshot and check the active entitlement.
- No destructive SQL or production data backfill is part of this replacement.

## Release status and remaining gates

Implementation in the candidate branch is not the same as release acceptance. Before merge/deployment, the following evidence must be green on the final commit:

1. Typecheck, lint, production build and dependency audit.
2. Candidate migration rehearsal and PostgreSQL integration/security suites.
3. Authenticated editor acceptance at mobile, tablet and desktop sizes.
4. Tenant A cannot read, save, export, publish or roll back Tenant B's documents.
5. Save/autosave, templates/themes, block editing, JSON, export, preview, publish/unpublish, version history and rollback flows.
6. Existing public-page compatibility and official-domain verification after deployment.
7. Repository-wide required programme acceptance.

Vercel previously reported its daily deployment rate limit; a preview or production deployment must be verified from a successful deployment record, not inferred from a Git commit.

**Current release posture:** candidate implementation is substantially integrated; merge and production deployment remain blocked until all required checks and deployment verification pass. Do not weaken or bypass a failed acceptance gate to obtain a green status.
