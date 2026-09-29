# Stage 2 — post-merge production verification (2026-09-29)

Status: **merge + deployment + migration confirmed. DB-level referral verification NOT yet
confirmed — blocked on production credentials (see §5). Stage 2 is therefore not declared
production-ready.**

---

## 1. Pre-merge confirmations (authorized: PR #15, expected head `34b9783`)

| Check | Result |
| --- | --- |
| PR #15 state | `OPEN`, `mergedAt: null`, `closedAt: null`, not a draft |
| Head SHA | `34b9783e37de9fa51c6405bbbe584ac51c615a5e` — identical on local branch, `origin`, and the GitHub API |
| Mergeability | `MERGEABLE` / `CLEAN` |
| Commits | exactly 3 expected, all by `POWERBot-1`: `0dc1aa9` implementation, `60bb240` end-to-end wiring test, `34b9783` verification report |
| Files | 26 changed, +2794 / −12 — all Stage 2 referral code, docs, tests and the additive migration; nothing unexpected |
| Base | `main` was still `1fc7c431004f23257bc3bef2a1e70ab2890c08c7`; merge-base `1fc7c43` |

## 2. Merge

- Method: **normal GitHub merge** (`gh pr merge --merge`). No squash, no rebase, no force-push,
  no history rewrite.
- **Merge commit: `993fb1bdece1ab174802c3a720c8e1f1196f1d1e`**
  parents: `1fc7c43` (previous `main`) + `34b9783` (PR head).
- PR #15: `state: MERGED`, `mergedAt: 2026-09-29T13:05:42Z`.
- `origin/main` tip = `993fb1bdece1ab174802c3a720c8e1f1196f1d1e` ✅
- Working tree clean; session branch still `arena/01a0ed17-jata-aftercall` at `34b9783`.

## 3. Vercel Production deployment (exact merge commit)

Source: GitHub deployments API (populated by the Vercel GitHub App), read-only.

| Deployment | Environment | SHA | Created | Status |
| --- | --- | --- | --- | --- |
| `6735513320` | **Production** | **`993fb1bdece1ab174802c3a720c8e1f1196f1d1e`** | 2026-09-29T13:06:39Z | **success** — "Deployment has completed" (vercel[bot], 13:06:40Z) |
| `6734356917` | Production | `1fc7c43` (previous main) | 2026-09-29T12:11:38Z | success |
| `6735346761` | Preview | `34b9783` | 2026-09-29T12:58:57Z | success |

The newest Production deployment is the merge commit, and it succeeded.
Served at `https://jata-aftercall.vercel.app`.

## 4. Stage 2 migration in production

The migration was applied **through the existing mechanism only** — `scripts/build.sh` →
`scripts/migrate.sh` → `prisma migrate deploy` during the Vercel production build. No manual
migration, no manual data mutation, no other database or configuration change was made.

Evidence that `20260929000000_referral_stage2` is applied and effective in production:

1. **The build gate makes migration success a precondition for deployment success**: with
   `DATABASE_URL` set, `migrate deploy` runs *before* `next build` and a failure aborts the build.
   The Production deployment of `993fb1b` is `success`.
2. **`Business.referralCode` (new column) is live and writable**: two published businesses now
   render distinct lazily-minted codes — `/r/APNPV18TWRYB` (Mary's Beauty Studio) and
   `/r/QX3EYYK7N17F` (Nyumbani Kitchen). If the column were missing, `ensureReferralCode` would
   throw and no CTA would render.
3. **`Referral` (new table) is live and accepting inserts**: `GET /r/APNPV18TWRYB` redirected to
   `/register?ref=APNPV18TWRYB`, which only happens when `prisma.referral.create` succeeds; on
   failure the handler redirects to `/register` with no `ref`.

Not directly observable from this environment: the literal build-log line
`[migrate] Migrations deployed successfully` (needs Vercel dashboard/API access).

## 5. Read-only production verification of the referral flow — results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 8a | Published business exposes a referral link | ✅ | `GET /b/marys-beauty-studio` → CTA "Own a business like Mary's Beauty Studio?" → `/r/APNPV18TWRYB`; `GET /b/nyumbani-kitchen` → `/r/QX3EYYK7N17F` (distinct per business) |
| 8b | Referral link opens **without authentication** | ✅ | anonymous `GET /r/APNPV18TWRYB` → `303` → `/register?ref=APNPV18TWRYB` (no login, no 401/404) |
| 8c | Recipient reaches registration | ✅ | final URL `https://jata-aftercall.vercel.app/register?ref=APNPV18TWRYB`, registration form rendered |
| 8d | Only public data shown to the recipient | ✅ | invitation banner: "You were invited by **Mary's Beauty Studio**." — no ids, emails, phones or tokens anywhere in the response |
| 8e | Invalid / tampered / unknown codes rejected | ✅ | `GET /r/ZZZZZZZZZZZZ` → `/register` (no `ref`); `GET /r/APNPV18TWRY` (truncated) → `/register` (no `ref`, no banner); `GET /r/APNPV18TWRYB-NOT-A-CODE` → `/register` (no `ref`) — no attribution, no reason leaked |
| 8f | `/health` | ✅ | `{"status":"ok","db":"up","version":"1.0.0","timestamp":"2026-09-29T13:07:12.471Z"}` |
| 8g | Attribution survives registration → first business created → referral `CONVERTED` | ❌ **not verified** | requires a registration write to production **and** a read of the `Referral` table — see below |
| 8h | First-touch holds with two links | ❌ **not verified** | requires cookie-carrying session + DB read |
| 8i | Unpublished / suspended / self-referral rejection at claim time | ❌ **not verified** | requires DB read (no unpublished/suspended referrer code is reachable anonymously by design) |
| 8j | Referral does not bypass payment-before-publication | ❌ **not verified** | requires an account + publish attempt + DB/payment read |

### Why 8g–8j are blocked (exact requirement)

They need one or both of:

1. **Read access to the production database** (Neon Postgres) — e.g. a read-only connection string
   or a Vercel token allowing me to run a query. The sandbox has **no** `DATABASE_URL`, no Neon
   credentials, no `~/.vercel`, no `VERCEL_TOKEN`, and no repository secrets access
   (`gh secret list` → HTTP 403 for this integration).
2. **A write to production data** (registering a real recipient to observe the conversion), which
   conflicts with the "read-only production verification" instruction and with "do not manually
   mutate existing referral/business data".

Verified instead by the automated suite at the exact merge commit's code
(`tests/integration/referral-end-to-end.test.ts`, `tests/integration/referral-registration.test.ts`,
`tests/security/referral-security.test.ts`, `tests/security/referral-payment-boundary.test.ts`):
93 new tests, 383 total passing, run against the real route handlers, real registration service,
real referral storage and the real tenant guard.

### ⛔ STOP — operator decision required

To complete post-merge verification, explicitly authorise **one** of:

- **(A) Read-only DB access** — provide a read-only Neon connection string (or Vercel token) so I
  can run e.g.
  `SELECT status, count(*) FROM "Referral" GROUP BY status;` and
  `SELECT "referrerBusinessId", "referredUserId" IS NOT NULL FROM "Referral" WHERE id = '<id>';`
  — no data is modified.
- **(B) A controlled production end-to-end test** — authorise creating one disposable recipient
  account (e.g. `stage2-verify.<timestamp>@example.test`) through the live referral link, then
  reading back the resulting `Referral` row and attempting `PATCH /api/business
  {isPublished:true}` to confirm the 403. This **writes** test rows to production.
- **(C) Operator-side confirmation** — confirm from the Vercel dashboard that the build log shows
  `[migrate] Migrations deployed successfully`, and (optionally) run the two SQL queries in (A).

## 6. Production-readiness statement

Stage 2 is **not** declared production-ready. Confirmed so far: merge (normal, exact head),
Vercel Production deployment of the exact merge commit (`success`), the additive migration applied
through the existing gate and provably effective, `/health` `ok`/`db: up`, and the anonymous
referral entry points behaving correctly in production (valid link → registration with public-name
banner; invalid/tampered links → plain redirect, no attribution).

Outstanding: DB-level confirmation of attribution → conversion → first business, first-touch
behaviour, rejection cases at claim time, and the payment-before-publication boundary on a referred
business (§5). Once those are confirmed, Stage 2 can be declared production-ready.
