# OpenPage source pin

- Upstream: https://github.com/buildingopen/openpage
- Upstream commit: `9818eb43a88e01b23cb55752e19902d8285a853b`
- License: MIT (see `./LICENSE`)
- Imported source: `./src`
- Canonical document: OpenPage `SiteConfig` JSON
- Native block registry: 19 block types

The full OpenPage editor surface is mounted in JATA Website Studio. JATA replaces the standalone Vite app shell, project dashboard, settings and deploy routes with its own authenticated workspace, tenant authorization, entitlement, persistence, media, generation, public rendering and publishing lifecycle.

## Editor surface

The mounted upstream editor includes the canvas, toolbar, block registry/renderers, sidebars, layers and properties, JSON drawer, themes, templates, keyboard shortcuts, HTML export, generation overlay and version-history interface. The standalone OpenPage demo/components and deploy routes are not mounted as separate JATA product pages.

## JATA integration

- Authenticated Website Studio route mounts the upstream editor layout.
- Native OpenPage `SiteConfig` is persisted server-side per authorized `StudioWebsite`.
- Debounced autosave uses optimistic draft-version compare-and-swap.
- Immutable draft revisions and publication snapshots are stored separately.
- Version History reads server snapshots; draft restore uses autosave and published restore creates a new rollback publication.
- AI site generation calls JATA's server-side design engine; no browser provider key is required.
- Image properties use JATA's tenant-scoped media picker. Video blocks retain their upstream YouTube/Vimeo URL model.
- Public default and nested-page routes render published native OpenPage JSON using the pinned upstream block registry and themes.
- Legacy JATA Experience/Business Page records remain intact and provide compatibility fallback where native OpenPage publication is not authoritative.

## Multi-tenancy

Website access requires the business role and active workspace/site membership. The database relation enforces the workspace/business pairing. Server APIs scope reads, writes, publish, rollback, media and generation to the authorized website/business. Cross-tenant refusal is still a mandatory acceptance test.

## Commercial boundary

Website Studio remains `INTERACTIVE_BUSINESS`, **KES 999 / 30 days**. The server checks the authoritative plan key, price and duration. No Paystack or subscription semantics are changed by the OpenPage integration.

## Release gate

The candidate is not considered released until the final commit passes typecheck, lint, production build, dependency audit, migration rehearsal, PostgreSQL tests, authenticated multi-viewport browser acceptance, tenant-isolation tests, public rendering/publish/rollback tests, existing-page compatibility checks, and the repository-wide programme gate.

A Vercel Git commit is not a deployment. Verify a successful Vercel deployment and the official public domain before declaring production complete. Never bypass a failed release gate or perform destructive data changes to force acceptance.
