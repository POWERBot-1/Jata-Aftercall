# Release incident — PR #71 merged, production build failed (2026-10-29)

**Status: merged, NOT deployed. Production still runs the previous successful deployment.**

| Fact | Value |
| --- | --- |
| PR #71 | **MERGED** at `2026-10-29T03:09:26Z`, head pinned to `0e803f0` via `--match-head-commit` |
| Merge commit | **`f6c2a0491f0a9ad4f7a84fdb292c32f86dbd991d`** (parents `a04124d` + `0e803f0`) |
| Vercel production deployment | id `7403008418`, environment `Production`, commit `f6c2a04`, created `03:09:46Z` |
| Deployment result | **FAILURE** — `dpl_986EvDNJAdkkMXC2hpwRKCV7jFt3`; GitHub status context `Vercel` = `failure` |
| Previous production deployment | `a04124d`, still `success` (2026-10-27) |
| Duplicate deployments triggered | **none** — exactly one deployment exists for `f6c2a04` |
| Merged-code CI on `main` | 8/8 check-runs green (`03:21:01Z`) |

## 1. What could not be determined, and why

The cause of the build failure is **UNKNOWN**. The build log could not be read:

```
npx vercel inspect dpl_986EvDNJAdkkMXC2hpwRKCV7jFt3 --logs
  → Error: No existing credentials found. Please run `vercel login` or pass "--token"

curl https://api.vercel.com/v6/deployments   → http 000
curl https://jata-aftercall-kbfk70n0q-powerbot-1.vercel.app → http 000
```

No `VERCEL_TOKEN`/`VERCEL_*` credential exists in this environment and `api.vercel.com` is not reachable
from it, so neither the log nor the runtime could be inspected. No claim is made about which step failed.

**In particular, whether `prisma migrate deploy` ran at all is UNVERIFIED.** It cannot be checked without
`DATABASE_URL`, which is not available here.

## 2. What *is* known about the risk, by code inspection (not assumption)

`scripts/build.sh`, when `DATABASE_URL` is set, runs `scripts/migrate.sh`, which executes **two
fail-closed gates before Prisma is ever invoked**:

1. `scripts/lib/direct-url-guard.mjs` — refuses when `DATABASE_URL` is a pooled endpoint and `DIRECT_URL`
   is unset, and refuses when `DIRECT_URL` is itself pooled. (Verified: pooled + unset → exit 1;
   pooled + pooled → exit 1; pooled + direct → exit 0.)
2. `scripts/lib/migration-target-guard.mjs` — in `production`, the target must match an **enrolled**
   fingerprint. Exactly one is enrolled:
   `3439ca4ed940f77fde4d30f94a8873dc02ccf3daa1baec900804857450f3e8d5`
   (`scripts/lib/migration-target-allowlist.json`, Neon `neondb` / production branch).

If either gate refused, the build stopped before `npx`, and **no database write occurred**. If both
passed, the seven ERP migrations are additive and idempotent (§3), so a partial application is possible
only if the connection dropped mid-file — the case Prisma reports as P3009.

## 3. The seven pending migrations (reviewed line by line, 2026-10-29)

| Property | Finding |
| --- | --- |
| Pending set | exactly 7, all added by this PR (`20261027…` → `20261033…`), applied in lexicographic order |
| Statements | `CREATE TABLE IF NOT EXISTS` (48), `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `ADD CONSTRAINT`, `ADD COLUMN IF NOT EXISTS` |
| Destructive statements | **none** — no `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `UPDATE`, `DELETE`, `INSERT` in any of the seven |
| `ALTER` on pre-existing tables | **none** — every `ALTER` targets an `Erp*`/`Msg*` table created by this same set |
| Pre-existing tables touched | **`Business` only**, via foreign keys (one row per tenant; brief lock) |
| Rerun safety | all `CREATE`/`ADD COLUMN` guarded by `IF NOT EXISTS`; re-running reports "No pending" |

## 4. DEFECT FOUND — the target guard does not fingerprint the database Prisma actually migrates

`prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")`. Prisma Migrate connects using
**`DIRECT_URL`**, not `DATABASE_URL`. But `migration-target-guard.mjs` fingerprints
**`DIRECT_URL` zero times** — it evaluates `env.DATABASE_URL` only:

```
$ grep -c "DIRECT_URL" scripts/lib/migration-target-guard.mjs
0
```

Demonstrated on synthetic URLs (`VERCEL_ENV=production`, `MIGRATION_GUARD_MODE=enforce`):

```
# same DATABASE_URL, completely different DIRECT_URL (a different database):
DATABASE_URL=…ep-prod-pooler…/neondb  DIRECT_URL=…ep-prod…/neondb        → target=745d2a3b…   exit 1 (not enrolled)
DATABASE_URL=…ep-prod-pooler…/neondb  DIRECT_URL=…ep-DIFFERENT…/otherdb  → target=745d2a3b…   exit 1 (identical decision)

# the direct-url guard approves that mismatched pair, because it only checks pooled-ness:
DATABASE_URL=…pooler…/neondb  DIRECT_URL=…DIFFERENT…/otherdb → OK_DIRECT_URL_READY, exit 0
```

**Consequence:** with a Production `DIRECT_URL` pointing at the *wrong* Neon branch or database — the exact
accident `migration-target-guard` exists to prevent — the guard would still report the enrolled
`DATABASE_URL` fingerprint and **allow**, and `prisma migrate deploy` would apply the schema to whatever
`DIRECT_URL` names. The guard's own header admits it "cannot establish that the URL is the one the
Production runtime actually uses"; after `directUrl` was added it no longer identifies the URL Migrate
uses either.

**Why this was not caught:** every CI job runs without a pooler, so `DIRECT_URL` defaults to
`DATABASE_URL` and the two are indistinguishable. The guard's unit tests exercise `DATABASE_URL` only.

**Fix (not applied — it changes production behaviour and needs one owner-supplied value):**

1. In `evaluate()`, fingerprint the **effective migration target**:
   `parseTarget(env.DIRECT_URL?.trim() || env.DATABASE_URL)`.
2. Enrol the direct endpoint's fingerprint. The currently enrolled digest was computed from the pooled
   host, so the direct host has a different digest and must be added to
   `scripts/lib/migration-target-allowlist.json` by a reviewed change. Until that lands, a fixed guard
   refuses every production migration — fail-closed, which is the correct posture but blocks releases.
3. Add a unit test asserting the two endpoints are treated as one target (normalise `-pooler.` out of the
   first label, or enrol both digests) so this cannot regress.

This was deliberately **not** patched into `main` unilaterally: landing it without the enrolment step
would take Production from "migrates with an unverified target" to "cannot migrate at all", and enrolling
a database identity is, by the project's own policy (`docs/MIGRATION_TARGET_GUARD.md`), a reviewed
owner decision — not something an agent may infer.

## 5. Safe next steps (in order)

1. **Read the build log** (owner, or an environment with Vercel access):
   `npx vercel inspect dpl_986EvDNJAdkkMXC2hpwRKCV7jFt3 --logs`.
   The first failing line says which gate fired:
   * `[direct-url] REFUSED …` → `DIRECT_URL` is missing or pooled in Production: no DB write occurred.
   * `[migration-guard] REFUSED_PRODUCTION_UNKNOWN_TARGET …` → `DATABASE_URL` moved: no DB write occurred.
   * `P1002`/`P3009`/`Error: P…` from Prisma → a migration engaged and needs `prisma migrate resolve`.
   * a `next build` error → the database is migrated and only the build failed.
2. **Check the database** for a failed migration row (this is the one check that distinguishes "no write"
   from "half-applied"):
   `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE finished_at IS NULL;`
   Any row → run `npx prisma migrate resolve --rolled-back <name>` before redeploying.
3. **Only then** re-run the production deployment once (`vercel --prod` or a redeploy of `f6c2a04`), and
   verify the health endpoint returns `{"status":"ok","db":"up"}`.
4. Land the guard fix in §4 with the direct-endpoint enrolment, before the next schema change.

## 6. What was NOT done

* No second or manual deployment was triggered.
* No migration was run by hand, no database row was edited, no DNS/email/payment/storage setting touched.
* No secret was read, copied or printed; `DIRECT_URL`'s presence in Production could **not** be verified
  from this environment, and is recorded as unverified rather than assumed.
