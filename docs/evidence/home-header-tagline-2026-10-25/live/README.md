# Live production verification (2026-10-25)

Deployment `7312454699` (Vercel Production, environment "Production") at the merge commit
`420d2af15257aa3d878116b1745205cb79ff2b20` — the exact head of merged PR #58.

The repo's `production-smoke` workflow (read-only GETs) passed on the deployment: `/` serves HTML and
`/health` reports `db:up` through a real connection.

The real-browser checks were then run against the LIVE origin
(`https://jata-aftercall.vercel.app`) from a CI runner (the sandbox cannot reach the origin), using the
repository's own `scripts/browser/home-header-tagline.check.mjs` and `pricing-grid.check.mjs`:

| Check | Live result |
| --- | --- |
| Header/tagline, 320/360/390/414/768/1024/1280/1440 px, anonymous + signed-in, menu open, text scaling, keyboard, redirects | **179/180** — the one failure is the pre-existing missing `/favicon.ico` 404 (no favicon in the repository's history; the PR touched no icon files). It appears once, on the first page load, and is cosmetic. Every layout/visibility/a11y/overflow check passed at every width. |
| Pricing grid | **80/80** — five plans KES 149/999/499/999/499, POS last with `/dashboard/pos` CTA. |
| Tagline rendered exactly once | `rendered=1 leafNodes=1` at every width, live. |
| Wordmark/Dashboard overlap | none at any width, live. |
| Anonymous `/dashboard/pos` | redirects to `/login` (307 → login page). |

Logs: `live/home-header-check.log`, `live/pricing-grid-check.log`.
