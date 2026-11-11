# OpenPage source pin

- Upstream: https://github.com/buildingopen/openpage
- Upstream commit: 9818eb43a88e01b23cb55752e19902d8285a853b
- License: MIT (see ./LICENSE)
- Imported source: ./src

This directory is a source-preservation import, not yet a production-integrated editor.

## Mandatory integration work before activation

1. Replace the upstream `projectsStore` browser-local persistence with JATA server-side persistence scoped to the authenticated business tenant.
2. Replace the upstream standalone React Router shell with a JATA Next.js route adapter; do not mount the upstream dashboard as a separate product.
3. Replace upstream deploy-key publishing with JATA's authenticated publication/versioning pipeline. Never expose or accept a customer-supplied deployment credential as the authority for publishing.
4. Adapt AI generation, media selection, and project settings to JATA services and authorization.
5. Preserve the upstream JSON schema and block rendering; version and validate persisted documents.
6. Keep existing JATA business, customer, payment, subscription, media, and published-site records intact. The Website Studio entitlement remains KES 999 / 30 days.
7. Run tenant isolation, persistence, rendering, publish/rollback, accessibility, and browser acceptance tests before enabling the new editor in production.

Do not import upstream API routes or deploy configuration into JATA without a separate security review. This source pin intentionally excludes upstream `api/`, root Vite configuration, and upstream package manifests.

## JATA persistence foundation added on the replacement branch

- `OpenPageSiteDocument` is a separate Prisma model keyed by the authorized `StudioWebsite`.
- `app/api/studio/openpage/document/route.ts` provides authenticated GET/PUT access through `assertStudioWebsiteAccess`.
- Saves use optimistic draft-version compare-and-swap and validate OpenPage's native `SiteConfig` shape and the 19 supported block types.
- Migration: `20261130000000_openpage_native_document`.
- The new document table is deliberately separate from `StudioWebsiteContent` and `BusinessExperience`; existing Experience documents and publication snapshots are not overwritten.

## Remaining hard blockers

- The upstream editor shell is still not mounted in the JATA Website Studio route.
- Upstream Zustand persistence still needs to be replaced by a tenant-bound API adapter; the new API is not yet wired to the editor.
- The public page renderer does not yet render native OpenPage JSON.
- Publication, rollback, media-library references, and the existing KES 999 / 30-day entitlement have not yet been connected to the native OpenPage document.
- No migration has been applied to production. No live site has been switched to this format.

## Runtime integration audit (11 November 2026)

The upstream editor cannot yet be mounted in the Next.js application without completing dependency and routing integration:

- The JATA root manifest is React 18.3.1 / Next.js 16.4.2 and does not declare `react-router-dom`, `zustand`, `@dnd-kit/core`, `@dnd-kit/sortable`, or `@dnd-kit/utilities`.
- OpenPage imports React Router in its app shell, editor layout, and toolbar; it uses Zustand stores, and its drag-and-drop UI requires dnd-kit. `immer` is already present transitively, but must be declared directly if retained as an upstream dependency.
- The imported source tree intentionally has no upstream package manifest, Vite entry point, or independent deployment shell. The Next.js app cannot simply import `App` or `EditorLayout` as-is.
- The upstream stores persist project/configuration state to browser local storage. The editor must be adapted to hydrate and save against the authenticated `/api/studio/openpage/document` endpoint, not silently retain local-only persistence.
- The root lockfile is `package-lock.json`; changing only `package.json` would make clean CI installs fail. Dependency versions and lockfile updates must be committed together.

Consequently, the native editor route remains a hard integration blocker. No dependency manifest or lockfile was changed speculatively, and no incomplete editor route was exposed.