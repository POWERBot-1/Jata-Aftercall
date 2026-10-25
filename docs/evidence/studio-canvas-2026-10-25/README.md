# Studio Canvas — visual evidence (2026-10-25)

`studio-canvas-snapshot.html` is a **static snapshot of the real UI**, not a mock-up:
it is the server-rendered markup of `/studio-preview?tab=design` from a local `next dev` run,
with the app's own compiled CSS inlined so it opens offline.

What it shows: the new Canvas with its three panes — page outline (left), live preview
(centre) and the inspector on its **Design** tab (right), including design directions with
their swatches and the base-theme choices.

Differences from the running app, stated plainly:

| In this file | In the app |
|---|---|
| Scripts stripped | React hydration runs; every control is live |
| Preview iframe replaced by a placeholder | The business's own `/b/<slug>?preview=draft` page |
| Sample business ("Mary's Beauty Studio"), demo mode | The signed-in owner's own business |

## Why a snapshot instead of screenshots

No Chromium/Playwright binary is reachable from the build sandbox, so a browser screenshot
could not be produced honestly. Rather than fabricate one, this file is the real markup.

## Reproducing it

```bash
npm install
npm run dev            # http://localhost:3000
open http://localhost:3000/studio-preview          # inspector on "This section"
open "http://localhost:3000/studio-preview?tab=design"  # inspector on "Design"
```

The authenticated surface is `/dashboard/businesses/<id>/canvas` and needs a signed-in owner
and a database; it is not available from a static snapshot.
