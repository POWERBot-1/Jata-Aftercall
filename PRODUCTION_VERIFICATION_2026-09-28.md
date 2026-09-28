# PRODUCTION_VERIFICATION_2026-09-28 — JATA AFTERCALL

**Gate:** G5 — Production Evidence Record
**Date:** 2026-09-28
**Verdict:** Production deployment verified **READY**
**Production commit:** `4c7af74c3f1b1b3b0a8e026821d703e6409df023` (short `4c7af74`) — `main`
**Vercel project:** `powerbot-1/jata-aftercall`

---

## Evidence classification

This record strictly separates two evidence classes:

| Class | Meaning | Authority |
|---|---|---|
| **OPERATOR/BROWSER** | Measured by the operator through an authenticated browser against the live production deployment | Authoritative for production runtime state |
| **AUTOMATED** | Produced by local tooling in the sandbox (git, vitest, static inspection) against commit `4c7af74` | Authoritative for the code baseline; **not** a runtime measurement |

No production secret was exposed at any point. No production resource was modified while producing this record.

---

## 1. Production runtime evidence — OPERATOR/BROWSER

The following were measured by the operator via the authenticated browser against production (`https://jata-aftercall.vercel.app`) during the 2026-09-28 verification session:

| Check | Observed | Class |
|---|---|---|
| `GET /health` | `{"status":"ok","db":"up","version":"1.0.0"}` | OPERATOR/BROWSER |
| Database connectivity | `db: up` (production Postgres reachable) | OPERATOR/BROWSER |
| PlanConfig — Annual | **KES 999 / 365 days** | OPERATOR/BROWSER |
| PlanConfig — Monthly | **KES 149 / 30 days** | OPERATOR/BROWSER |
| Deployment state | Production deployment **READY** | OPERATOR/BROWSER |
| PR #7 merge gate | Merged; its production verification gate is **closed** | OPERATOR/BROWSER |

Independent provenance of the PlanConfig readings: the values were read through the authenticated browser directly from the production admin PlanConfig surface — not inferred from code, seed files, or API documentation.

## 2. Code baseline evidence — AUTOMATED (sandbox, 2026-09-28)

Produced by automated tooling in the working sandbox against commit `4c7af74`:

| Check | Observed | Class |
|---|---|---|
| `main` HEAD | `4c7af74` — *Merge pull request #7 from POWERBot-1/arena/01a0e817-jata-aftercall* | AUTOMATED (`git log`) |
| Working tree | Clean at session start (no local drift from production commit) | AUTOMATED (`git status`) |
| Plan config — code (`lib/pricing.ts` fallback) | ANNUAL `priceKES: 999, durationDays: 365`; MONTHLY `priceKES: 149, durationDays: 30` | AUTOMATED (static inspection) |
| Plan config — code (`prisma/seed.ts`) | ANNUAL `999 / 365`; MONTHLY `149 / 30` (seed upserts preserve values) | AUTOMATED (static inspection) |
| Code ↔ production consistency | Code-level plan values **match** the operator-observed production PlanConfig | AUTOMATED |
| Test suite | `npm test` → **23 files / 172 tests — all passed** at `4c7af74` (2026-09-28T18:03Z) | AUTOMATED |
| Publication policy pinned | `PUBLISH_REQUIRES_PAYMENT === false` asserted in `tests/security/publication-access.test.ts` (9 tests pass) | AUTOMATED |
| PR #3 (G1) | Closed as superseded by `main` (verified diff already present in `scripts/build.sh` at `4c7af74`); closure comment posted 2026-09-28T18:01:46Z | AUTOMATED (`gh pr view 3`) |

Sandbox note: the Prisma query-engine binary could not be downloaded in the sandbox (egress to `binaries.prisma.sh` blocked); the repo's documented offline fallback was used, which does not affect the vitest result (DB layer exercised via mocks, as designed).

## 3. Consistency verdict

- Production runs exactly the commit verified here (`4c7af74`), so the code baseline and the production runtime are the same artifact.
- The two evidence classes are mutually consistent: operator-observed production PlanConfig (999/365, 149/30) equals the code-declared values.
- **Production is READY** for the JATA AFTERCALL V1 scope: health OK, database UP, correct plan configuration, green test baseline, PR #7 verification gate closed, superseded PR #3 closed.

## 4. Out of scope of this record

- G3 Paystack **test-mode E2E** — to be executed against a **Vercel Preview + isolated test database** only (see `PAYSTACK_TESTMODE_E2E_RUNBOOK_2026-09-28.md`). It must never target the production database, and production is not modified by that gate.
- G4 public-page browser measurements (Lighthouse, OG tags, canonical, mobile sticky CTA, Web Share, analytics increments) — operator-measured, recorded separately once performed.
