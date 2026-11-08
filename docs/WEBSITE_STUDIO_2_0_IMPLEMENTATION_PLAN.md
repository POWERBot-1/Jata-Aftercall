# JATA AFTERCALL — Website Studio 2.0
## Multi-Tenant Website & Commerce Experience Engine

**Status:** implementation in phased PRs; NOT release-ready, NOT merged, NOT deployed.
**Scope boundary:** Website Studio only. Existing JATA AFTERCALL plans and all other product surfaces remain unchanged.

## Product direction

Website Studio becomes an AI-native, multi-tenant business website and commerce experience engine—not a standalone replacement builder. It stays inside the existing Next.js, Neon PostgreSQL, Prisma and Vercel application.

A business owner can manage multiple independent businesses. Each business owns an isolated workspace and website. The platform supports tenant-specific design systems, page structures, layouts, motion effects, content, media, domains, analytics and team access. Where the approved Website Studio tier permits more than one website for a business, each site has independent draft/published state and history.

## Verified inherited foundations

- Existing `Business` / `BusinessMember` ownership and role boundaries.
- Existing `BusinessExperience` draft/published documents, version history, themes, template families, editors and AI tools.
- Existing product, service, booking, order, inventory and POS records remain authoritative.
- Existing Website Studio plan key is `INTERACTIVE_BUSINESS`, customer-facing name Website Studio, currently KES 999 / 30 days.
- Existing AI quota, payment/subscription, media and publication gates are reused; no parallel billing or commerce records.
- Existing Cloudflare R2 architecture is the target for durable tenant media. The provider/original-media activation decision remains deferred: no real original uploads, provider activation, paid provisioning or spending is enabled by this work.

## Commercial packaging direction

| Website Studio tier | Proposed price | Positioning |
|---|---:|---|
| Starter | KES 999 / month | One professional website |
| Growth | KES 1,999 / month | Commerce, bookings and growth capabilities |
| Pro | KES 3,999 / month | Multiple websites and advanced AI |
| Agency | KES 7,999 / month | Client workspaces, teams and white-label capability |

These are the previously proposed Website Studio-only tiers. Exact numeric allowances for website count, team seats, AI generations, storage, custom domains and advanced features have **not** been agreed. The current production catalogue remains unchanged. Starter retains its existing one-website-per-business allowance. New tier rows and their quotas must be separately approved before any production PlanConfig, checkout, subscription or payment change. Unknown plan keys and unconfigured capabilities fail closed.

Existing BusinessMember permissions remain authoritative for business access. Existing AI quota and media-storage policies remain authoritative for usage and storage until a separately approved tier-entitlement matrix replaces them. Do not create duplicate usage, storage, subscription or payment ledgers.

## Experience modes and design architecture

### Rendering modes

1. **Lite:** server-rendered, accessible, fast, low-JavaScript baseline; must remain fully usable on low-end Android and slow connections.
2. **Motion:** progressive CSS transitions and Web Animations first; add GSAP only where measured interaction complexity justifies it. Respect `prefers-reduced-motion`.
3. **Immersive:** optional Three.js/WebGL scenes, with a WebGPU path only when capability detection proves support. Always retain a functional Lite fallback.

### Design systems and layout engine

- Image-first creative direction: the business's actual hero/product/service imagery leads the composition; use cinematic lighting, material/texture treatment, art direction and deliberate negative space without allowing decorative effects to obscure real business content or conversion actions.
- Per-tenant brand tokens: typography, palette, spacing, radii, surfaces, shadows, icon family and image treatment.
- Multiple structures and layouts: editorial, storefront, menu-board, booking-led, portfolio, service catalogue, professional enquiry and campaign landing patterns.
- Reusable, schema-validated sections and components; safe scene graph/configuration rather than executable AI-generated code.
- Responsive desktop/tablet/mobile composition and preview, including narrow 320px layouts.
- Tenant-specific motion profiles, interaction effects, transitions, image treatments and component variants.
- Versioned design recipes with manual owner overrides.
- Anti-similarity/diversity engine: avoid identical section order, composition and visual treatment across unrelated tenants while preserving the tenant's actual brand.
- Visual editor with select/move/reorder/duplicate/visibility controls, breakpoint preview, reusable blocks, undo/redo, revision history and safe publish/rollback.

### Performance guardrails

Initial engineering targets from the earlier design direction: approximately 250 KB route JavaScript, approximately 1 MB initial image payload, and 2–4 MB hero media upper range, subject to measured device/network budgets. Defer immersive assets, lazy-load below-the-fold media, use responsive image variants and never make WebGL a prerequisite for content or conversion.

## AI-native creation

- Contextual generation uses only verified business profile, products, services, prices, hours, location, media and owner-supplied facts.
- Missing facts remain explicit placeholders or questions; AI never invents a phone number, price, opening hour, location, service or claim.
- AI proposes structured schema changes, not arbitrary code.
- Every AI change has **Apply**, **Preview** and **Undo**; preview is isolated from the live website and apply uses draft version compare-and-swap.
- JATA Image Studio is a provider-abstracted image-generation/enhancement layer for brand-aware art direction, image treatment, crops and derivatives. AI-generated imagery is labelled with provenance and cannot be represented as an actual product/customer photograph. Provider calls and original-media persistence remain disabled until the owner-approved media activation gate is satisfied.
- Existing AI usage quotas remain authoritative; future tier limits are not invented.

## Commerce and integrations

- Website products, prices and stock read from existing JATA POS/product/inventory records.
- ASK JATA / AI Business Front Desk can answer from the owning business's verified knowledge and route customer enquiries into existing lead/order/booking flows; Website Studio does not create a competing AI customer or commerce ledger.
- Orders, bookings and enquiries use existing authoritative services and records.
- Website Studio must not duplicate customer, product, inventory, booking, order, payment or subscription records.
- Existing checkout, Paystack and payment verification remain authoritative.
- WhatsApp, call, directions, lead capture and enquiry actions are tenant-scoped.
- A website's storefront presentation is independent; its underlying commercial records remain shared with the owning business and its authorised JATA modules.

## Media, domains, SEO and analytics

- Media metadata and ownership are website/business scoped; durable originals belong in the existing Cloudflare R2 architecture, not Neon JSON/blob columns.
- Original media persistence/provider acceptance remains BLOCKED pending the existing owner-approved activation decision.
- Per-site media library, alt text, focal point/crop variants, responsive renditions and provenance.
- Per-site SEO title/description, canonical URL, social preview, sitemap, robots and structured data.
- Per-site custom domain verification, DNS diagnostics, SSL state and publishing diagnostics.
- Tenant-isolated analytics for page views, source, conversion events, enquiries and commerce actions. No cross-tenant aggregation in owner-facing views.
- Domain resolution and SSL are not considered complete until independently tested against real DNS and certificate state.

## Tenant security invariants

- A website is always resolved from its opaque ID and server-side workspace/business relation.
- BusinessMember permissions are the upper bound; workspace and website memberships can only reduce access.
- Every read/write/history/restore/publish/media/domain/analytics operation re-checks tenant ownership server-side.
- Composite workspace/business/site relations prevent cross-tenant attachment.
- Suspended memberships stay suspended; owner-only workspace administration cannot be elevated by a website role.
- Draft and published snapshots are separate. No preview route leaks private draft content.
- Cross-tenant negative tests cover API, media, revision, domain and analytics access.

## Phased delivery and release gates

| Phase | Delivery | PR status |
|---|---|---|
| P1 — Tenant foundation | Workspace/business/site ownership, membership roles, composite constraints, default-site backfill and authorization tests | PR #101 open; core suite and migration rehearsal passed; global acceptance blockers remain |
| P2 — Multi-site data plane | Independent per-site draft/published content, revisions, restore, site listing/creation API, optimistic concurrency and Starter entitlement enforcement | PR #102 draft, stacked on P1; CI and PostgreSQL evidence pending |
| P3 — Experience Engine UI | Visual editor, multi-tenant themes/structures/layouts/effects, responsive preview, reusable components and Lite/Motion/Immersive renderers | Not started |
| P4 — AI and media | Factual contextual generation, Apply/Preview/Undo, AI provenance, media workflow and R2 activation only after approval | Not started; original-media provider gate remains blocked |
| P5 — Commerce, domains and analytics | Existing POS commerce adapters, bookings/enquiries, SEO, domain/SSL verification and tenant analytics | Not started |
| P6 — Plan entitlements | Explicit Website Studio-only tier entitlement matrix for sites, team seats, AI, storage, domains and advanced capabilities | Not started; exact quotas and new PlanConfig rows require approval |
| P7 — Release acceptance | Full tenant isolation, migration rollback, browser/device, public journey, performance, SEO/domain, provider and regression evidence | Not started |

### Phase-by-phase required evidence

For each phase: baseline audit; implementation inventory; additive migration and tested rollback; targeted and full regression tests; cross-tenant positive/negative tests; build and browser evidence; commit references; PASS / FAIL / BLOCKED / NOT TESTED status; separate pull request. No phase is merged merely because a build succeeds.

## Current release blockers

- PR #101's latest recorded checks: full no-database suite PASS; candidate migration rehearsal PASS; release validation PASS; motion and screenshot evidence PASS.
- The same head still has a programme-completeness failure because pre-existing ADMIN/MOTION/RELEASE acceptance IDs remain BLOCKED.
- Interactive Business E2E still reports an inherited M418 hydration gate failure (15/15 required hydration samples passed, but the overall gate reports one failed check). This is not to be relabelled PASS or bypassed.
- Persistent-original media/provider acceptance is explicitly BLOCKED by the existing owner deferral.
- P2 requires its own Prisma validation, migration rehearsal, real PostgreSQL tests, build and review before it can be considered ready.

## Production safety

No production SQL mutation, subscription or plan change, paid activation, provider provisioning, merge or deployment is part of the current implementation phases. The user's separate release authorisation is required only after the complete phase evidence and all release gates are green. Existing public Business Pages and all non-Website-Studio JATA plans must remain operational throughout.
