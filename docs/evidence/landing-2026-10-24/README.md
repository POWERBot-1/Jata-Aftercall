# Evidence — landing page and demo showcase (2026-10-24)

All captures were produced by `scripts/browser/landing-showcase.check.mjs` against this branch
(`arena/e5c4c14b-jata-aftercall`), from the local checkout. Nothing here was taken from or written
to production.

## Before / after

| File | What it shows |
| --- | --- |
| `before/homepage-desktop.jpg` | Baseline `cce008d` landing page at 1440 px, rendered from a separate `git worktree` checkout. |
| `before/homepage-android.jpg` | Baseline landing page at 360 px (Android). |
| `before-after-desktop.jpg` | Side-by-side: baseline (left) and this branch (right), 1440 px. |
| `before-after-android.jpg` | Side-by-side: baseline (left) and this branch (right), 360 px. |

## After — landing page

| File | Width |
| --- | --- |
| `homepage-narrow-android.jpg` | 320 px (narrow Android — the no-overflow floor) |
| `homepage-android.jpg` | 360 px |
| `homepage-desktop.jpg` | 1440 px |
| `mobile-menu-open.jpg` | 360 px, native `<details>` menu open |
| `homepage-reduced-motion.jpg` | 360 px with `prefers-reduced-motion: reduce` emulated |
| `showcase-kamau-desktop.jpg` | 1440 px, second demo tab selected by click |

## After — the four demo businesses

`demo-<slug>-mobile.jpg` (360 px) and `demo-<slug>-desktop.jpg` (1440 px) for
`nyumbani-kitchen`, `marys-beauty-studio`, `kamau-auto-care` and `john-kamau-properties`.

These are captured through `/dev/demo-showcase?slug=…`, the **development-only** harness that mounts
the same `DemoShowcaseBand` + `BusinessPage` components the public route mounts, against the
documented demo content in `lib/demoData.ts`. The harness prints its own "Development verification
only — synthetic demo content, no database" banner in every frame. It answers 404 in production
(`app/dev/demo-showcase/page.tsx`), so it cannot expose demo content on the live site.

## Reproducing

```bash
npm ci
npm run build && npx next start -H 0.0.0.0 -p 3100      # hydrated build for the landing checks
npx next dev --webpack -H 0.0.0.0 -p 3000               # dev server for the /dev harness

CHROME_PATH=/path/to/chrome ONLY=home  BASE_URL=http://127.0.0.1:3100 SHOT_DIR=docs/evidence/out npm run test:browser:landing
CHROME_PATH=/path/to/chrome ONLY=demos BASE_URL=http://127.0.0.1:3000 SHOT_DIR=docs/evidence/out npm run test:browser:landing
```

`ONLY=home` passes 55/55 checks, `ONLY=demos` passes 32/32. A headless Chromium is required; the
check exits with status 2 and a clear message when `CHROME_PATH` is unset.
