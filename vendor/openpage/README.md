# OpenPage source pin

- Upstream: https://github.com/buildingopen/openpage
- Upstream commit: 9818eb43a88e01b23cb55752e19902d8285a853b
- License: MIT (see ./LICENSE)
- Imported source: ./src

The upstream editor source is integrated into JATA's Website Studio route. The upstream Vite application shell and standalone dashboard are not mounted; JATA owns authentication, tenant selection, entitlement, routing, and the surrounding workspace.

## Runtime integration now present

- The native editor is mounted by `components/studio/openpage/OpenPageEditor.tsx` inside the existing authenticated Website Studio route.
- JATA resolves the default `StudioWebsite` through `ensureDefaultStudioWebsite`; the editor receives its opaque website ID and loads only through the authenticated document API.
- The upstream `configStore` and `projectsStore` no longer use Zustand browser-local persistence.
- Editor autosave is debounced and writes native `SiteConfig` JSON to `/api/studio/openpage/document` with optimistic draft-version compare-and-swap.
- Every successful draft save writes an immutable `OpenPageSiteRevision` snapshot in the same database transaction.
- Runtime dependencies are declared in `package.json` and locked in `package-lock.json`: Zustand, Immer, React Router, and dnd-kit. The selected versions are compatible with JATA's React 18 runtime.
- OpenPage Tailwind sources are included in the application's explicit source scan. Editor theme tokens and motion utilities are isolated in `app/openpage-editor.css`; the upstream global body/viewport rules are not imported.
- Existing Website Studio entitlement remains authoritative at KES 999 / 30 days. The editor is not rendered unless the server-derived entitlement is active.

## Native persistence boundary

- `OpenPageSiteDocument` is a separate Prisma model keyed by the authorized `StudioWebsite`.
- `OpenPageSiteRevision` stores immutable snapshots keyed by website and draft version.
- `app/api/studio/openpage/document/route.ts` provides authenticated GET/PUT access through `assertStudioWebsiteAccess`.
- Saves validate OpenPage's native `SiteConfig` shape and the 19 supported block types, enforce a 1.5 MB limit, reject inline image data, and use optimistic draft-version compare-and-swap.
- Migration: `20261130000000_openpage_native_document`.
- Native documents remain separate from `StudioWebsiteContent` and `BusinessExperience`; existing Experience documents, publication snapshots, and public business pages are not overwritten.

## Remaining release blockers

1. **Public rendering:** the public website renderer does not yet render native OpenPage JSON from `OpenPageSiteDocument.publishedJson`.
2. **Publishing and rollback:** no owner-authorized native publication/rollback workflow is connected yet. The upstream deploy-key workflow is not used.
3. **AI and media:** upstream generation, media selection, and project settings still need to be adapted to JATA's approved AI provider and media library. No provider secret may be exposed in the browser.
4. **Revision UX:** server snapshots are recorded and revision metadata is readable, but the upstream Version History panel still displays local in-session undo history rather than loading/restoring server revisions.
5. **Acceptance:** typecheck, lint, production build, tenant isolation, autosave, revision, export, accessibility, and authenticated browser tests remain to be run and pass before merge or deployment.

## Safety and compatibility

- Do not import upstream API routes or deployment configuration into JATA without a separate security review.
- Do not delete or overwrite business, customer, catalogue, order, booking, payment, subscription, media, or existing published-site records.
- Do not map OpenPage JSON into the legacy ExperienceDocument section schema.
- Existing published pages remain on their current renderer until the native public renderer and compatibility/migration path are accepted.
- No production migration, merge, or deployment is authorized by this partial integration state.
