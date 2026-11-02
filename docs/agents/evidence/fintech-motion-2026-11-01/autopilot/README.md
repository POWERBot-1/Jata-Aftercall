# Autopilot fixture evidence (FIXTURE — not production)

All data is fictional (tenants `fx-tenant-a`, `fx-tenant-b`). No message was sent, no payment, offer, FAQ, customer, consent or entitlement was changed, and no automation ran. Development-only routes (`/dev/autopilot-fixture`, `/dev/autopilot-fixture/decide`) return 404 in production.

- `fixture-after/` — branch code (`arena/903a9fec-jata-aftercall`), six widths per scenario, `report.json`.
- `fixture-baseline-main/` — same fixture scaffolding run against the `origin/main` version of `AutopilotCommandCenter.tsx` (no in-flight guard, no kill-switch motion). Used only for the before/after comparison.
- `capture-autopilot.mjs` — the browser capture script (`BASE`, `OUT` env vars).

Key measured results (fixture, `report.json`):

| Check | main component | branch |
|---|---|---|
| Triple synchronous approve click → PATCH requests | 3 | 1 |
| Approve & Execute → proposal status | EXECUTED | EXECUTED |
| Reduced motion banner animation (normal / reduced) | none / none | jata-state-in / none |
| Layout: 24 rows, 6 widths, overflow / page errors / hydration warnings / small targets | 0 bad | 0 bad |

Server-enforced results (same on both): reject is final (approve after reject → 409 `INVALID_PROPOSAL_STATE`); paused tenant → 409 `TENANT_AUTOPILOT_PAUSED`; STAFF → 403 `RBAC_FORBIDDEN`; tenant B reading tenant A → 403 `TENANT_FORBIDDEN`; kill-switch approve → proposal stays PROPOSED; fixture unsimulated `/api/autopilot/*` → 501.

Limits: DB-backed controls (daily spend reservation, customer profile lookup, row-level tenant filters, concurrency) are NOT exercised here. Prisma cannot be generated in this sandbox; see the ledger's Autopilot section.
