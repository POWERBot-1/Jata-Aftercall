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
