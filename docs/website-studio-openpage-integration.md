# OpenPage upstream pin for JATA Website Studio

- Upstream: https://github.com/buildingopen/openpage
- Pinned source commit: 9818eb43a88e01b23cb55752e19902d8285a853b
- License: MIT (retain upstream LICENSE and attribution)
- Integration target: JATA AFTERCALL Website Studio
- Canonical document: upstream OpenPage SiteConfig JSON (theme + blocks/pages)
- Existing entitlement: KES 999 / 30 days (unchanged)
- Tenant boundary: authenticated JATA business membership/ownership; server-side persistence only
- Production domain: https://jataaftercall.co.ke

## Non-negotiable integration boundary

The upstream editor, canvas, block registry/renderers, layer and property panels, design controls, AgentPanel, JSON editor, version history, keyboard shortcuts, themes, templates, and HTML export remain the product. JATA adapters replace only app routing, authentication, persistence, AI credentials/provider, media storage, entitlement checks, and publishing.

Do not translate SiteConfig into the legacy JATA Experience schema. Do not retain a parallel legacy visual editor. Do not delete existing business, customer, commerce, payment, subscription, media, or published-site records.

## Compatibility findings

The pinned upstream package currently declares React 19.2, React Router 7, Vite 7, Tailwind CSS 4, Zustand 5, Immer 11, @dnd-kit, and Sonner. JATA currently declares React 18.3.1 and Next.js 16.4.2. Resolve and test the React compatibility boundary deliberately; do not force-install incompatible dependencies or upgrade the whole production app blindly.

## Required completion sequence

1. Import the complete pinned upstream source and LICENSE into the JATA repository.
2. Port the complete editor into the Next.js authenticated route without dropping upstream capabilities.
3. Replace projectsStore localStorage persistence with tenant-scoped server APIs and durable SiteConfig/version records.
4. Replace Gemini/direct upstream generation and deploy handlers with JATA-controlled server adapters; keep secrets server-only.
5. Render published public sites from the canonical OpenPage SiteConfig and native block registry.
6. Verify tenant isolation, draft/version/undo/redo, templates/themes, AI generation, HTML export, preview, publish, and rollback.
7. Verify current KES 999 / 30-day subscription gate and existing customer/site data remain unchanged.
8. Pass CI and real-browser acceptance before merge.
9. Deploy only after release acceptance; then verify the official public domain.

This manifest is an integration pin and acceptance contract, not evidence that the complete source has already been imported or deployed.


## Verified source and JATA integration audit (2026-11-11)

The pinned upstream tree was enumerated from the Git object API: 117 entries, with 59 source files under `src/`. The source includes 19 registered block types and the full editor route, panels, stores, templates, themes, generation, and HTML export. The project is a standalone Vite application; `src/App.tsx` owns a `BrowserRouter`, and `src/main.tsx` mounts its own React root. It is not a drop-in Next.js component.

The following incompatibilities are confirmed by source inspection:

1. **Persistence is browser-local today.** `src/store/projectsStore.ts` uses Zustand `persist` with the key `openpage-projects`; `src/store/configStore.ts` also persists browser state. This must be replaced with authenticated, business-scoped server persistence. Merely embedding the editor would create device-local projects and would not meet JATA's ownership or durability requirements.
2. **The data contracts differ.** OpenPage's canonical `SiteConfig` is `{ name, pages, blocks, theme }`, with blocks typed as a registry of 19 types. JATA's existing `ExperienceDocument` is a different category/brand/settings/sections contract. Do not coerce one into the other or silently discard fields.
3. **JATA has a separate additive per-site content/publication data plane.** `StudioWebsiteContent` stores versioned draft/published JSON; `StudioWebsiteDraftRevision` and `StudioWebsiteVersion` retain history. The existing public storefront and legacy `BusinessExperience` compatibility path are governed by `lib/experience/publication-state.ts`. OpenPage JSON cannot be written into that data plane and assumed to render: the public storefront currently expects the JATA experience document. A canonical OpenPage renderer and a deliberate route/publication adapter are required before any OpenPage site can be published.
4. **Routing is standalone.** Upstream uses React Router routes for dashboard/editor/components/deploy/settings and a browser-root mount. JATA must expose the editor under its authenticated business route, pass the authorized business/site identity from the server, and remove or replace upstream project selection and deploy routes without losing editor capabilities.
5. **Generation and deployment are server boundaries.** Upstream generation/deploy modules must not receive provider secrets in the browser or bypass JATA's draft/publish state machine, entitlement gate, media policy, or tenant checks.

### Required architecture before implementation can be accepted

- Keep upstream `SiteConfig` JSON as the canonical editor document; preserve unknown/forward-compatible block properties.
- Add an explicit, validated SiteConfig document schema and a tenant-scoped persistence adapter over the existing per-site content/version records (or a separately reviewed additive model if the current model cannot represent the document safely).
- Add a server-authorized load/save API with optimistic version checks. Never trust a client-supplied businessId/siteId without the existing tenant guard.
- Add a native public SiteConfig renderer using the same pinned block registry and themes. Public requests must resolve only the exact site's published snapshot through the existing publication-state machine; draft JSON must never be public.
- Preserve all existing ExperienceDocument and BusinessExperience records as read-only compatibility data during the cutover. Do not destructively migrate or overwrite them.
- Mount the complete editor in the JATA route with a scoped router strategy; do not ship a second independent Vite app or localStorage-backed project database.

**Current result:** source inventory and integration boundary are verified. Full source import, persistence adapter, native public renderer, route integration, tests, merge, and deployment remain NOT DONE. PR #111 is not release-ready.
