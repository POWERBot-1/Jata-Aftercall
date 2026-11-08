# JATA AFTERCALL — Website Studio 2.0
## Multi-Tenant Website & Commerce Experience Engine
**Phase 0: repository audit, architecture decision and independently reviewable delivery plan**

- Repository: POWERBot-1/Jata-Aftercall
- Baseline: main at f29a9acc1ea9eba446a0a0c1a9a17f6ff4c6f022
- Scope: Website Studio only; preserve entitlement key INTERACTIVE_BUSINESS.
- Phase 0 is documentation only. No application code, schema, database, billing, storage configuration, DNS, merge or deployment changed.

---

## 1. Binding scope and release controls

Upgrade the existing JATA AFTERCALL Website Studio into a multi-tenant website creation, design, publishing and commerce experience engine. This is not a new application and must not create a second source of truth for JATA business operations.

**Allowed:** Studio workspace, website data model, Studio routes/components, Studio authorization, Studio media metadata/storage integration, design/rendering, Studio AI, SEO/domain/publishing diagnostics, Studio analytics and Studio-only entitlements.

**Excluded:** JATA Qi, Business Page plan, AI Business Front Desk plan, Business POS plan, BOS, Autopilot, TAPNET, unrelated dashboard products, payment platform, POS ledger/inventory authority, subscription pricing and unrelated public Business Page capabilities. Shared code may change only where necessary for a safe Studio integration, with path-level justification and regression tests proving excluded products are unchanged.

**Separate owner approval required before:** production SQL/migrations, production subscription or entitlement mutation, payment/provider activation, storage credential creation/configuration, real paid AI calls, production DNS/SSL/domain activation, production publishing, merge, production deployment, force push or security-gate bypass.

Each implementation phase gets its own branch and PR. Each PR must contain baseline, implementation inventory, migrations/rollback, targeted and regression tests, exact commit references, and separate PASS / FAIL / BLOCKED / NOT TESTED evidence. No PR merges until its own release acceptance and separate owner authorization.

## 2. Baseline audit — existing system

### Architecture and commercial boundary

- Existing stack: Next.js 16.4.2, React 18.3.1, Prisma 5.22.0, Neon PostgreSQL and Vercel. Preserve it.
- Authentication/session authority: lib/auth.ts. Business authorization: lib/tenant.ts.
- Existing tenant model: Business and BusinessMember. These remain authoritative for existing business data.
- Existing Website Studio plan identity: INTERACTIVE_BUSINESS; customer-facing name Website Studio. Preserve its stable key, existing KES 999 monthly price, duration, payment verification and entitlement logic. Do not alter any other plan.
- Existing public route /b/[slug] and classic Business Page remain operational. Preserve SSR, no-JS/basic rendering, accessibility, mobile behavior and existing customer actions.

### Existing Studio capabilities to extend, not rebuild

Inspected source areas:
- Workspace/data: lib/experience/workspace.ts, document.ts, schema.ts, storefront.ts, entitlement.ts.
- Studio routes: /dashboard/studio and /dashboard/businesses/[id] with sections, design, photos, theme, items, preview, orders, bookings and insights.
- Studio UI: StudioTabs, SectionEditor, DesignPanel, ThemeEditor, PhotoLab, MediaLibrary, LayoutVariantPanel, PreviewClient, PublishPanel, StudioHistory, StudioCopilot and WebsiteHealth.
- Rendering/design: lib/experience/sections.ts, themes.ts, templateFamilies.ts, motionPolicy.ts, motionRuntime.ts, renderMode.ts and storefront renderers.
- AI: lib/studio/copilot.ts, designDirections.ts, lib/ai/provider.ts, imageLab.ts, copyLab.ts, grounding.ts, generation history and Studio AI routes.
- APIs: /api/experience, /api/experience/publish, /api/experience/versions, /api/experience/variant, /api/media, /api/studio/copilot, /api/studio/ai/*, plus existing storefront shop, item, checkout, order, booking and enquiry APIs.
- Existing engine includes controlled sections, themes, 20 template families, art direction, draft/published separation, preview, history, undo/redo, publication validation and business-scoped content.
- Existing catalogue, inventory, services, bookings, orders, payment verification and POS records remain canonical. Websites reference those records; they do not duplicate them.

### Critical structural gap

Prisma BusinessExperience currently has a unique businessId. This is a one-experience-per-business model, not an independent multi-website model. It cannot independently represent multiple websites, domains, drafts, publication versions, settings and analytics for one business without a site identity layer.

There is also no complete Studio organisation/workspace membership layer for collaboration across a selected set of businesses/sites. Existing BusinessMember membership must remain authoritative for business records; workspace membership must not silently grant access to orders, inventory, payment data or AI Front Desk records.

### Storage, domains and external services

- lib/storage/* provides a storage abstraction and Cloudflare R2 adapter. R2 is selected only when server-side configuration is present.
- R2_SETUP.md records the owner's free-first R2 decision and preview-first activation runbook. Code presence is not proof of configured storage or persistent cross-session retrieval.
- R2 activation, credentials, provider billing and production bucket configuration are not performed by Phase 0.
- Domain/SSL management is a required Studio capability, but live Vercel domain attachment, DNS edits, certificate activation and production hostname cutover require separate approval.
- AI adapters are not proof of live provider access. Deterministic/local output must be labelled honestly and never described as photorealistic vendor output.

### Existing safety and acceptance assets

- Business-level server guards and role permissions exist in lib/tenant.ts; existing tests cover tenant isolation, media roles, publication and business routes.
- Draft and published JSON are separate; publication has server-side validation and paid entitlement checks; versions support history/restore.
- Existing browser, integration, Prisma and CI workflows exist. Historical test counts are not current-head evidence.
- Production data was not queried. Production customer/site counts, live domain bindings, R2 bucket state and actual usage are NOT TESTED in this audit.

## 3. Target product — JATA Website Studio 2.0

### Multi-tenant command centre

- One owner manages multiple independent businesses and websites.
- Explicit organisations/workspaces with named members, invitations, scoped roles and activity history.
- Business/site switcher displays only authorised resources.
- Agency/partner collaboration only through explicit membership and resource grants.
- Workspace administration is separate from business commerce authority.

**Security invariant:** workspace membership alone never grants business access. Each request resolves website → business → existing Business owner/member authorization, then applies narrower workspace/site permissions. Every request scopes queries by resolved tenant and site. BusinessMember remains authoritative for existing business data.

### Independent websites and data plane

Every website independently owns its site ID, business/workspace binding, slug, draft and published documents, version history, design DNA, theme, template/layout choices, navigation, settings, SEO, social metadata, domain bindings, media references, analytics, forms and CTA configuration.

Products, variants, prices, stock, services, offers, bookings, orders, payment status, customers and business identity remain canonical JATA records. Site documents hold references and presentation configuration, not duplicate commercial facts.

### Experience DNA and vertical Experience Packs

Add a versioned Experience DNA profile per website:
- Vertical, audience, conversion goal (sell/book/enquire/browse), brand personality, visual density, image direction, tone, accessibility and performance preferences.
- Registered Experience Packs for food, hospitality, retail, beauty, professional, property, automotive, technical, creative and future supported verticals.
- Multi-dimensional design variation across structure, section sequence, hero treatment, navigation, catalogue geometry, cards, media ratios, typography, palette, motion and interaction patterns.
- Reusable components/sections, layout recipes and design tokens, safely scoped to authorised tenants.
- Privacy-safe similarity controls to reduce repetitive generated compositions without exposing another tenant's content/assets.
- Brand locks so regeneration cannot overwrite owner-approved identity.

Build on the existing 20 template families and section registry. Do not reduce the system to one template, random shuffling or arbitrary generated HTML/CSS/JavaScript.

### Premium visual Experience Editor

Responsive canvas with desktop/tablet/mobile preview; drag/reorder/duplicate/hide sections; controlled component editing; reusable blocks; global design tokens; page/navigation management; reusable headers/footers; live draft preview; unsaved/conflict/publish states; named checkpoints; version timeline; compare; undo/redo; safe restore; accessibility and reduced-motion controls. Editing must never silently mutate published content.

### Adaptive visual and motion engine

Progressive enhancement ladder:
1. Semantic static SSR baseline, always available.
2. CSS transitions and existing lightweight Motion runtime.
3. Optional richer choreography on capable devices.
4. Optional Canvas/WebGL/Three.js scenes only when useful and with static fallback.

Respect prefers-reduced-motion, Save-Data, connection quality, memory/device capability and runtime failure. Lazy-load optional motion/3D; keep critical content and actions usable without JavaScript. Target at most 1.5 MB critical initial payload with route-specific budgets and measured evidence. GSAP/Lenis/advanced renderers are optional only when bundle, accessibility and device evidence justifies them; do not load duplicate animation runtimes without need.

### AI-native creation and continuous improvement

- Conversational onboarding: “Describe your business; JATA builds the experience”, grounded in owner-supplied assets and authoritative business facts.
- AI Creative Director proposes structure, Experience DNA, design direction, section flow, copy and responsive composition.
- Context-aware generation based on vertical, audience, brand, actual catalogue/services and chosen conversion goal.
- Every AI change is a reviewable proposal with Apply, Preview and Undo. Never silently publish.
- Never invent business identity, contact details, address, opening hours, stock, prices, awards, certifications, guarantees, delivery times, legal claims, reviews or statistics.
- Clearly distinguish actual owner photography from representative/AI artwork.
- Server-enforced quotas, provider cost controls, rate limits, prompt caching, provenance, moderation and generation history per tenant/site/entitlement.
- Explainable Alive Score / website health for accessibility, conversion-path completeness, content, SEO and measured performance.
- Continuous-improvement suggestions and experiments require owner approval before apply and publish.

### Commerce and Kenyan journeys

Compose existing catalogue, inventory, services, booking, order, enquiry and checkout services. Preserve existing payment verification and POS ledger. Do not duplicate customer/order/payment/stock records. Preserve WhatsApp, Call, Directions, Share, KES display, English/Swahili and existing approved M-PESA/Paystack capabilities only through current integrations. Track CTA-to-enquiry/booking/order using existing event/transaction identities.

### Media, SEO, domains and publishing

- Tenant/site-scoped media library, persistent object references, derivatives, responsive sizes, alt text, crop/focal metadata, provenance, dedupe, quotas and safe deletion/retention.
- Keep binaries out of Neon. Use existing storage abstraction and R2 adapter only after approved environment setup and real persistence tests.
- Per-page SEO title/description, canonical URL, Open Graph, structured data, sitemap/robots, image alt text, redirects and diagnostics.
- Domain manager for platform subdomain and optional custom domains, ownership verification, DNS instructions, Vercel domain status, SSL/certificate status and diagnostics.
- Atomic server-validated publishing, immutable version snapshot and rollback; diagnostics for missing data, domain verification, SSL, broken links, SEO, storage and health.
- No DNS changes, domain activation or production publish in implementation PRs.

## 4. Proposed data architecture (not applied in Phase 0)

| Model | Responsibility | Invariant |
|---|---|---|
| StudioWorkspace | Owner-controlled organisation/workspace | Explicit owner and lifecycle |
| StudioWorkspaceMember | Workspace membership, role, invitation, status | No implicit business access |
| StudioWorkspaceBusiness | Explicit workspace-to-business mapping | Existing Business access re-checked |
| StudioWebsite | Independent site identity, workspace and business binding | Every site belongs to exactly one business |
| StudioWebsiteDomain | Hostname, verification and SSL/provider state | Normalized unique hostname; verify ownership before activation |
| StudioWebsiteMember or scoped grant | Site-level permission restriction | Cannot exceed underlying business permission |
| Existing BusinessExperience | Website draft/published document | Backfill one default site per existing business |
| Existing ExperienceVersion / ExperienceDraftRevision | Site-scoped history | Version resolves to same authorized site/business |
| Existing MediaAsset | Media metadata/provenance | Business and site ownership verified |
| Existing AiGeneration | AI usage/provider/provenance | Scoped to business and website |

**Migration strategy:** additive and staged. Create workspace/site identity tables and constraints first. Backfill one default StudioWebsite for each existing BusinessExperience without changing content or public URLs. Add nullable website references to experience/version/history/media records, backfill and verify every row, then enforce required/composite uniqueness only after duplicate and orphan checks pass. Preserve old routes through a compatibility resolver mapping legacy business routes to the default site. New multi-site APIs use stable website IDs. Do not drop or rewrite existing customer records.

A schema review must inspect the exact current Prisma relation graph and migration history before implementation. Rollback must preserve default-site content and existing routes. Any irreversible migration requires separate owner approval.

## 5. Entitlements and plan isolation

- Preserve INTERACTIVE_BUSINESS, existing KES 999 monthly price, verified-payment requirement and subscription authority.
- Add Studio-only capability checks for website count, AI usage, storage, team seats, domains, advanced design/motion, analytics and publishing.
- Entitlements resolve server-side from the existing Website Studio plan and subscription. UI visibility is not authorization.
- Initial limits must derive from existing contract or be approved as a Website Studio-only product decision; do not invent quotas or change other plans.
- Publishing remains under the existing paid gate.

## 6. Security model and mandatory isolation tests

For every route, loader, query, action and object operation:
1. Authenticate the session.
2. Resolve site ID to business/workspace from server-side records.
3. Assert existing Business owner/member access.
4. Assert workspace membership and site role.
5. Apply action-level permission (read/edit/configure/publish/manage-domain).
6. Scope every DB query by resolved business and site IDs.
7. Scope storage key and metadata to resolved business/site.
8. Audit privileged changes.

Required negative tests:
- Tenant A cannot list/read/mutate/preview/publish/restore/delete or infer Tenant B's websites, media, domains, analytics, AI history, drafts, versions or settings.
- Workspace membership cannot access an unlinked business.
- Workspace role cannot exceed BusinessMember role; VIEWER cannot edit; editor cannot publish; publisher cannot manage billing.
- Guessing site, slug, media key, order or domain IDs never bypasses authorization.
- Public rendering, sitemap, metadata and cache never expose drafts/private data.
- Unverified/suspended domains do not resolve to a public website.
- Concurrent edits use compare-and-swap; stale AI proposals cannot overwrite newer drafts.
- Prompt injection cannot grant access or authorize actions.

Use at least two independently authenticated tenants and real disposable PostgreSQL; mocks alone are insufficient.

## 7. Phased implementation and PR map

Every phase is a separate PR, ordered by dependency.

| Phase | Scope and deliverables |
|---|---|
| **P0 — Audit & architecture (this PR)** | Documentation-only baseline, inventory, scope boundary, target architecture, migration plan, security model, phases and acceptance matrix. |
| **P1 — Workspace + tenant foundation** | Workspace, members, business links, site identity, scoped roles, additive migrations, two-tenant PostgreSQL isolation suite, legacy default-site compatibility. |
| **P2 — Multi-website data plane** | Multiple websites per business; independent drafts, published versions, settings and slugs; site resolver; scoped history; legacy /b/[slug] compatibility. |
| **P3 — Experience Editor 2.0** | Responsive canvas, pages/navigation, visual editing, reusable blocks, design tokens, preview, compare, undo/redo and version timeline. |
| **P4 — Experience DNA + design system** | DNA, registered vertical Experience Packs, differentiated structures/themes, safe variation, similarity checks and brand locks. |
| **P5 — Adaptive motion + immersive** | Static-to-motion enhancement, device/network/reduced-motion adaptation, lazy optional 3D, failure recovery, critical bundle budgets and device/browser evidence. |
| **P6 — AI Creative Director** | Grounded generation, proposal diff, Apply/Preview/Undo, history, quotas/cost controls, provenance and owner approval. |
| **P7 — Commerce composition** | Existing product/service/booking/order/checkout/POS records composed into multiple site journeys; no duplicate records; transaction regression. |
| **P8 — Media pipeline** | Tenant/site media, persistent R2 upload/read/derivatives, quotas, dedupe, provenance, retention and real cross-session tests. No activation before owner-approved setup. |
| **P9 — SEO + domains + publishing** | SEO, sitemap/canonical/OG, domain verification, Vercel/SSL diagnostics, atomic publish, rollback and host resolution. DNS/production activation separately approved. |
| **P10 — Growth analytics + agency controls** | Site analytics, conversion paths, Alive Score, approved experiments, collaboration, agency views, audit and Studio usage. |
| **P11 — Release acceptance** | Exact-head test matrix, accessibility, performance, security, migration rehearsal/rollback, two-tenant DB journeys, mobile acceptance, public page regression and release report. Separate owner release authorization. |

## 8. Acceptance matrix

| Requirement | Phase 0 status |
|---|---|
| One owner manages multiple businesses | NOT TESTED for new workspace flow |
| One business manages multiple independent websites | FAIL — BusinessExperience is unique by business |
| Multiple users collaborate in authorised workspaces | NOT IMPLEMENTED |
| No cross-tenant private access | PARTIAL — existing business isolation; workspace/site isolation absent |
| Draft/published independence per site | PARTIAL — existing single-site implementation |
| Responsive visual editor | PARTIAL — existing editors/preview, not full multi-page canvas |
| Media persists across sessions | BLOCKED — real configured R2 persistence not verified |
| Domains resolve independently | NOT TESTED |
| AI changes require owner approval | PARTIAL — existing guarded Copilot; new multi-site flow absent |
| Existing public pages and customer journeys remain operational | Existing suites; exact current-head rerun required |
| Other JATA plans unchanged | MUST PASS in every PR |
| Migration rollback is safe | NOT TESTED for proposed schema |

## 9. Phase 0 verification and limitations

**PASS**
- Repository/default branch and inspected baseline commit identified.
- Existing Studio source areas, Prisma models, business tenant helpers, entitlement/publish paths, editor components, AI modules, 20 template families, storage adapter and R2 runbook located.
- Existing architecture and stable Website Studio plan key confirmed.

**FAIL / GAP**
- One BusinessExperience per business; no independent multi-site identity.
- No complete Studio workspace/organisation collaboration and site-level permission control plane.
- Historical handoff test counts are not current exact-head evidence.

**BLOCKED**
- Production DB inventory and existing customer/site counts: no production DB access used.
- Real R2 persistence: activation and cross-session tests not performed.
- Live Vercel domain/SSL/DNS state: not verified.
- Live AI vendor output/cost and physical Android/iOS acceptance: not tested.

**NOT TESTED**
- Full current-head local test/build/CI execution in a checked-out runtime.
- Actual two-tenant workspace journeys, because this feature does not yet exist.

No interface, source file, mock or historical CI count is promoted to end-to-end PASS.

## 10. Phase completion rule

A phase is complete only when its exact baseline and changed-file inventory are recorded; its PR changes only approved Studio scope; migrations are additive, rehearsed on disposable PostgreSQL and have tested rollback; tenant positive/negative tests pass against real DB state; existing Business Page, POS, AI Front Desk, checkout, payment and subscription suites pass unchanged; lint, typecheck, build and targeted/full regression gates pass on final PR head; blocked/not-tested items remain visible; and the PR receives review and owner approval before merge. Production activation and deployment require separate authorization.

**Phase 0 recommendation:** review this architecture and proceed to P1 as a separate PR. Do not merge this documentation PR or activate production services as part of Phase 0.
