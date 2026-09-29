# Stage 2 — Self-Service Referral Flow: independent verification report

Date: 2026-09-29
PR: [#15](https://github.com/POWERBot-1/Jata-Aftercall/pull/15) (`arena/01a0ed17-jata-aftercall` → `main`)
Code heads verified: `0dc1aa950d29062fb10208cc59df0094a5e8995f` (implementation),
`60bb2405e972de9b76903e8fa2c5b1b908090c47` (end-to-end wiring test)
Status: **verified, not merged** — awaiting explicit merge authorisation.

---

## 1. Method

Verification was performed **read-only and outside the working tree**: a fresh clone of
`POWERBot-1/Jata-Aftercall` into `/home/user/verify-jata`, checked out at the exact PR head SHA
(detached), with a fresh `npm install`. No file in the clone was modified and no change was pushed
from it.

Gates run at each head:

| Gate | Command | `0dc1aa9` | `60bb240` |
| --- | --- | --- | --- |
| Unit + integration + security tests | `npm test` | 41 files / **376 passed** | 42 files / **383 passed** |
| Type check | `npx tsc --noEmit` | 0 errors | 0 errors |
| Lint | `npm run lint` | no warnings/errors | no warnings/errors |
| Production build | `npm run build` | success (`/r/[code]` present) | success (`/r/[code]` present) |
| Whitespace / conflict markers | `git diff --check origin/main...HEAD` | clean | clean |
| Dependency vulnerabilities | `npm audit` | 0 vulnerabilities | 0 vulnerabilities |

Baseline before Stage 2 (`1fc7c43`): 35 files / **290 passed**, tsc clean, lint clean, build
success — so all 290 pre-existing tests still pass unchanged.

## 2. Requirement traceability

| # | Requirement | Evidence |
| --- | --- | --- |
| 1 | Secure referral mechanism/link, openable unauthenticated, self-service, no private tenant data | `lib/referral.ts` (opaque 12-char code, 60 bits from `crypto.randomBytes`); `app/r/[code]/route.ts` (no session required, 303 to `/register`); `tests/integration/referral-link-route.test.ts` "is reachable unauthenticated…", "does not reveal the referrer's private data in the redirect" |
| 2 | Server-side, first-touch attribution surviving registration; attached to first business atomically; analytics events not authoritative | `/r/[code]` writes a `Referral` row (`PENDING`) and returns only a token (stored as SHA-256); `resolveReferralForRegistration()` re-validates server-side; claim runs inside the registration transaction (`lib/registration.ts`); `tests/integration/referral-registration.test.ts` "records the referral in the same transaction…", "rolls the whole thing back…"; `tests/integration/referral-end-to-end.test.ts` (real handlers); `tests/security/referral-security.test.ts` "records only the whitelisted event and writes no referral row" |
| 3 | Validation/security matrix | `tests/unit/referral-code.test.ts`, `tests/unit/referral-eligibility.test.ts`, `tests/integration/referral-link-route.test.ts`, `tests/security/referral-security.test.ts` — valid / tampered / nonexistent / unpublished / suspended / owner-missing / self-referral / repeated / expired / first-touch / A→B→C chain / ordinary registration / cross-tenant mismatch |
| 4 | Payment-before-publication preserved; referral origin has no publication effect | `lib/publication.ts` untouched; `PATCH /api/business` untouched; `tests/security/referral-payment-boundary.test.ts` (403 unpaid referred business, 200 once PAID + valid subscription, unpublish always allowed, publish path never reads referral state); `tests/unit/publication-gate.test.ts` + `tests/security/publication-access.test.ts` unchanged and passing |
| 5 | Minimum additive migration; no automatic production migration/data mutation | `prisma/migrations/20260929000000_referral_stage2/migration.sql` — only `CREATE TYPE`, `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `CREATE INDEX`; `Business.referralCode` is nullable+unique and minted lazily (no backfill); `tests/unit/repair-guards.test.ts` asserts no destructive SQL; **no migration was run against any database** |
| 6 | Referral CTA in the public business experience, mobile-friendly, no private data | `components/BusinessPage.tsx` footer CTA (published pages only), `app/register/page.tsx` invitation banner (public business name only, via `publicReferralInvite`), `components/ReferralShareCard.tsx` dashboard copy/WhatsApp share |
| 7 | Regression/security tests + all gates | 7 new suites, 93 new tests; all gates green (table above) |
| 8 | Governance | Single dedicated branch, two commits, pushed, PR #15 opened against `main`, **not merged**, no force-push, no history rewrite, no JATA Qi, no unrelated functionality touched |
| 9 | Production | No production database or configuration change was made; see §4 |

## 3. Behavioural summary (from tests, not from assertion)

- **Happy path**: anonymous `GET /r/<code>` → `303 /register?ref=<code>` + httpOnly cookie →
  `POST /api/auth/register` → user + business + OWNER membership + `Referral` row converted to
  `CONVERTED` with `referredUserId` / `referredBusinessId`, all in one transaction.
- **Failure paths**: invalid/tampered/unknown code, unpublished or suspended referrer, missing
  owner, self-referral, expired or already-claimed attribution and cross-tenant attribution all
  result in **no credit**. Signup still succeeds in every case, and no internal reason is exposed
  to the browser (the API returns only `{ recorded: false }`).
- **First touch**: a second, different referral link opened in the same browser does not overwrite
  the existing unconverted attribution; the token path always beats a submitted code.
- **Chains**: only the direct referrer is credited (no ancestor credit).

## 4. Limitations of this verification

1. **No live database.** The sandbox has no Postgres and cannot download the Prisma engine
   binaries (`binaries.prisma.sh` unreachable), so `prisma generate`, `prisma migrate deploy` and
   `prisma migrate diff` could not be executed. All referral behaviour was verified against
   in-memory Prisma doubles plus the real handler/service code paths.
2. **Operator action still required before/with deployment** — not performed by this change:
   - Apply the migration: the existing build gate (`scripts/build.sh` → `scripts/migrate.sh`) runs
     `prisma migrate deploy` when `DATABASE_URL` is set, so the additive migration is applied as
     part of an operator-authorised deploy. Merging/deploying is that authorisation.
   - Optional pre-deploy drift check (needs network + `DATABASE_URL`, e.g. on a shadow DB):
     `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code`
3. **No production data mutation** was performed and none is needed (codes are minted lazily).
4. **Post-merge production verification is still outstanding** (see below).

## 5. Production-readiness statement

Stage 2 is **not** production-ready yet. It becomes production-ready only after, in order:

1. PR #15 is independently verified (done — this report),
2. it is **explicitly merged** by the operator,
3. it is **deployed** (which applies the additive migration), and
4. **post-merge production verification** succeeds, minimally:
   - `GET /r/<code>` on a published production business returns 303 and sets `jata_referral`;
   - a test registration through that link creates the business unpublished and leaves a
     `CONVERTED` `Referral` row;
   - `PATCH /api/business {isPublished:true}` on that business still returns 403 until a verified
     payment exists;
   - an invalid/tampered code returns a plain redirect with no attribution row;
   - `prisma migrate deploy` reported the Stage 2 migration as applied (no drift).
