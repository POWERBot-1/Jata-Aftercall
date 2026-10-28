# POS / ERP - PRO — `directUrl` / `DIRECT_URL`: minimal safe deployment design (E8)

**Status: DESIGN ONLY. Nothing in this document has been executed.** No Neon project was created, no
secret was read or written, no production or preview configuration was changed, no migration was run
against any provider database, and nothing was deployed. E8 remains **OPEN** until the rehearsal in §6
has actually been run and its results recorded.

---

## 1. The defect, as it exists in the tree today

| Fact | Where |
| --- | --- |
| The Prisma datasource has `url` only — **no `directUrl`** | `prisma/schema.prisma`: `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }` |
| The deployment guide tells the operator to paste Neon's **pooled** connection string into `DATABASE_URL` | `DEPLOYMENT.md` §1 step 1: "copy **Connection string (pooled)**" |
| The build runs migrations against that same `DATABASE_URL` | `scripts/build.sh` → `scripts/migrate.sh` → `npx prisma migrate deploy` whenever `DATABASE_URL` is set |
| Vercel Production and Preview both define `DATABASE_URL` | `DEPLOYMENT.md` §2 step 3 |

Neon's pooled endpoint is **PgBouncer in transaction mode**. Prisma Migrate takes a **session-level
advisory lock** before applying migrations, and transaction pooling does not reliably preserve it. The
documented deployment path therefore fails in one of two ways:

* **P1002 — Timed out trying to acquire a postgres advisory lock**, build aborts (fail-closed, at least);
  or
* the lock is stranded and the migration row is left half-applied, so every later deploy fails with
  **P3009** (`migrate found failed migrations in the target database`) until somebody runs
  `prisma migrate resolve`.

**Why CI is green anyway.** Every workflow in this repository points `DATABASE_URL` at a plain
PostgreSQL service container on `localhost` (eight job-level blocks across five workflows, e.g.
`postgresql://jata:jata@127.0.0.1:5432/jata_ci`). There is **no PgBouncer in front of it**, so the
failure cannot appear in CI at all. A green PR is not evidence against this defect — this is the exact
class of bug that only shows up on the provider.

**What has been proven locally** (see `docs/POS_ERP_PRO_EVIDENCE.md` §10.3): the runtime half —
`?pgbouncer=true` (prepared statements disabled), `connection_limit=1` and `connection_limit=2` under a
`max_connections=8` cap — all pass, and the full 27-migration forward/rollback/recovery chain passes on
PostgreSQL 16.2. The advisory-lock half only reproduces behind a real pooler, which does not exist here.

---

## 2. The minimal safe change (three parts, one commit)

### 2.1 Schema: declare the direct URL

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled at runtime (serverless-friendly)
  directUrl = env("DIRECT_URL")     // unpooled, used only by migrate/db push
}
```

Prisma is pinned at **5.22**, where `directUrl` is the supported mechanism (introduced in 4.3). With it,
`prisma migrate deploy` and `prisma db push` use `DIRECT_URL`; the application client keeps using
`url`, so **runtime behaviour does not change at all**.

**The cost, stated plainly:** Prisma validates the schema whenever it loads it, including on
`prisma generate`. A referenced-but-unset variable is a hard failure (**P1012 — Environment variable not
found: DIRECT_URL**). So `DIRECT_URL` must exist in **every** environment that runs
`generate`/`migrate`, not just production. This is why the change is a coordinated deployment, not a
one-line edit — and why it must not be merged without §3 being filled in first.

### 2.2 Build gate: fail with an actionable message, not P1002

Add a preflight to `scripts/migrate.sh`, before the existing `migration-target-guard.mjs`:

```
scripts/lib/migration-url-guard.mjs   (new, pure function + CLI wrapper)
  input:  DATABASE_URL, DIRECT_URL (parsed, never printed)
  refuse when:
    - host is a Neon pooled endpoint (hostname contains "-pooler.") and DIRECT_URL is unset
    - host is pooled and DIRECT_URL resolves to the same pooled host (the trap: "it's set, so it must be right")
  print:  redacted host fingerprint only (never the URL, never the password)
  exit:   1 with "DATABASE_URL points at a pooled endpoint; set DIRECT_URL to the unpooled string"
```

This converts an obscure P1002 that arrives minutes into a build into one sentence that names the fix.
It is testable offline with synthetic URLs, which is why it can be verified before any Neon project
exists (§6 step 5, §7).

### 2.3 Documentation and env template

* `.env.example`: add `DIRECT_URL=""` next to `DATABASE_URL`, with one sentence on what it is. The
  existing comment style already explains every variable the code reads.
* `DEPLOYMENT.md` §1/§2: replace "copy Connection string (pooled)" with the two-URL instruction, and
  add the single-URL local case (`DIRECT_URL` equal to `DATABASE_URL` on a local server, which has no
  pooler in front of it).

---

## 3. Where each variable must exist

| Location | `DATABASE_URL` | `DIRECT_URL` | Why |
| --- | --- | --- | --- |
| Vercel → Production | Neon **pooled** string `...-pooler...?sslmode=require&pgbouncer=true&connection_limit=1` | Neon **direct** string (same host without `-pooler`), `sslmode=require` | Runtime through the pooler; migrations bypass it at build time |
| Vercel → Preview | Preview branch's pooled string | The same branch's direct string | Preview builds also run the migration gate (that is how preview databases are provisioned today) |
| Vercel → Development (if used) | Branch pooled string | Branch direct string | Same rule as Preview |
| Local `.env.local` | local PostgreSQL URL | **the same URL** | No pooler locally; equal values are correct and the guard accepts them |
| GitHub Actions — `pos-erp-verify.yml` (1 block), `interactive-business-e2e.yml` (1), `premium-screenshots.yml` (1), `release-validation.yml` (5), `candidate-rehearsal.yml` (inline) | unchanged service-container URL | **the same value** | Otherwise `prisma generate` fails P1012 in CI. Eight job-level blocks across five workflows |
| `scripts/erp/migration-verify.sh` callers | unchanged | the same value | pg_dump/pg_restore path is unaffected, but prisma validate runs |

Two rules that make this safe to operate:

1. **`DIRECT_URL` must never be the pooled host.** The guard in §2.2 refuses that case explicitly,
   because "the variable is set" is not the same as "the variable is right".
2. **No new secret type.** `DIRECT_URL` is the same database and the same credentials as
   `DATABASE_URL`; it differs only by host. There is nothing extra to rotate, and no new credential to
   leak — but it is still a secret, so it goes in the same vault/UI as the URL it mirrors.

---

## 4. Migration and build behaviour after the change

| Situation | Before | After |
| --- | --- | --- |
| Vercel Production build, both vars set correctly | **P1002/P3009** (advisory lock through PgBouncer) | `migrate deploy` runs over the direct connection, then `next build` — as intended |
| Vercel build, `DIRECT_URL` unset | P1002, obscure | Guard fails immediately before Prisma with the exact remedy; build still aborts (fail-closed either way) |
| Vercel build, `DIRECT_URL` set to the pooled host | P1002 | Guard refuses: "DIRECT_URL resolves to the pooled host" |
| Local dev, one URL | works | works (guard accepts equal URLs) |
| CI service container | works | works, provided `DIRECT_URL` is exported alongside `DATABASE_URL` |
| Application runtime | pooled via `url` | **unchanged** — pooled via `url` |
| `prisma generate` in an environment with no DB | succeeds (`--no-engine` fallback path) | **requires `DIRECT_URL` to be present**, even as a dummy, or P1012. This is the main new failure mode |

---

## 5. Rollback plan

**A. Rolling back the change itself** — one commit, no data movement:

```bash
git revert <sha>    # removes directUrl, the guard and the doc change
```

Runtime is unaffected either way (the client always used `url`), so a revert is behaviourally neutral
for the application; it only restores the build-time trap. Deploy the revert only if the guard is
blocking builds for a reason you disagree with — but note that the trap it guards is real, so a revert
should be paired with an owner decision to stop migrating during builds.

**B. Recovering a database that already hit P3009** (the failure this design prevents):

```bash
# 1. Inspect, never guess. Look at finished_at / logs / rolled_back_at.
psql "$DIRECT_URL" -c "select migration_name, started_at, finished_at, logs, rolled_back_at from _prisma_migrations order by started_at desc limit 5;"
# 2. If the recorded migration is genuinely incomplete and its statements are additive/idempotent:
npx prisma migrate resolve --rolled-back <migration_name>   # marks it rolled back without touching data
# 3. Re-run with the direct URL in place:
DIRECT_URL=... npx prisma migrate deploy
```

Because every ERP migration in this PR is additive (verified: no `DROP TABLE`, no `DROP COLUMN`, no
`TRUNCATE`, no `DELETE` in `prisma/migrations/2026102*`/`2026103*`), a rolled-back migration leaves no
half-destroyed schema to repair by hand. If a future migration is not additive, the plan changes and
must be written before it is merged.

**C. Recovering a broken build** — the build gate already aborts before `next build`, so a migration
failure cannot produce a half-deployed app. Vercel keeps serving the previous deployment.

---

## 6. Non-production rehearsal procedure (requires your authorization — not run)

Cost, honestly: a Neon **free-tier** project is $0, but creating any provider resource is your decision,
not mine. This procedure provisions nothing itself; it is the script to run **after** you say yes.

```bash
# 0. Prereqs: a Neon project you own, a throwaway branch named "rehearsal". No production branch.
#    Settings → Connection string → copy BOTH: "Pooled connection" and "Direct connection".
export DATABASE_URL='postgresql://...-pooler.../rehearsal?sslmode=require&pgbouncer=true&connection_limit=1'
export DIRECT_URL='postgresql://.../rehearsal?sslmode=require'      # same host, no "-pooler"

# 1. Prove the guard works BEFORE trusting it (offline, no provider needed):
node scripts/lib/migration-url-guard.mjs check   # with DIRECT_URL unset  → exit 1, actionable message
node scripts/lib/migration-url-guard.mjs check   # with DIRECT_URL=pooled → exit 1, "pooled host" message
node scripts/lib/migration-url-guard.mjs check   # with the pair above   → exit 0

# 2. Prove migrations apply over the direct connection (in CI, where engines download):
npx prisma generate && npx prisma migrate deploy        # expect "Migrations applied" / "No pending"

# 3. Prove the trap is real (this is the evidence E8 is missing):
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DATABASE_URL" npx prisma migrate resolve --applied 0_init || true
#    then point migrate at the pooled host and observe P1002 — record the exact text.

# 4. Prove the runtime path through the pooler:
PRISMA_TEST_DATABASE_URL="$DATABASE_URL" npm run test:db:erp     # expect 67/67

# 5. Prove cold start after auto-suspend (free tier suspends idle branches):
sleep 360; PRISMA_TEST_DATABASE_URL="$DATABASE_URL" npm run test:db:erp | tail -5

# 6. Teardown: delete the rehearsal branch/project. Nothing in Production was read or written.
```

**What to record afterwards** (this is what turns E8 from OPEN to PASS): the migration output, the
P1002 text actually observed in step 3, the 67/67 result in steps 4 and 5, the Neon PostgreSQL version,
whether `sslmode=require` needed anything extra, and the teardown confirmation. Without those, E8 stays
open no matter how green CI is.

---

## 7. What can be verified **without** a Neon project

These are the parts I can do on your word, in this environment, at zero cost:

1. The guard in §2.2 — synthetic URLs covering: pooled host with `DIRECT_URL` unset; pooled host with
   `DIRECT_URL` also pooled; pooled with a genuinely direct `DIRECT_URL`; plain local URL with equal
   values; malformed/absent values. Pure function, no network, no secrets.
2. The `directUrl` wiring — `prisma validate` / `generate` with `DIRECT_URL` set to a dummy value proves
   the schema is well-formed and that P1012 appears without it (the exact failure mode to document).
3. The full migration chain and the 67-test suite against a **local** PostgreSQL, with `DIRECT_URL`
   present, proving the change does not alter current behaviour.

That is roughly 80% of the risk, and it does not need the provider. The remaining 20% — PgBouncer's
advisory-lock behaviour, Neon's extension set, SSL, branch/restore, cold start — genuinely does.

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A build environment lacks `DIRECT_URL` → P1012 outage at the next deploy | Medium if done piecemeal | Build fails (no partial deploy) | Enumerate all eight CI blocks + Vercel envs **in the same commit**; rehearsal step 1 |
| `DIRECT_URL` set to the pooled host (looks fine, is the trap) | Medium | P1002/P3009 | Guard refuses it explicitly (§2.2) |
| Someone runs `npx prisma migrate deploy` manually, bypassing `migrate.sh` | Medium | P1002 | `directUrl` fixes this case too — it applies at the Prisma level, not only in the script |
| Neon direct endpoint refuses connections when the compute is suspended | Low | Slow first build | Cold-start rehearsal step 5 |
| `sslmode=require` vs `verify-full` mismatch | Low | Connection refused | Documented in §3; rehearsal proves it |
| Guard becomes a single point of failure for all builds | Low | Builds blocked | Pure function, unit-tested, refuses only the two dangerous cases, and `migrate.sh` still aborts on Prisma errors |

---

## 9. Explicit boundaries of this document

* No project was provisioned; no free tier was created; nothing was spent.
* No secret was read, printed, written or rotated. The snippets above use placeholders.
* No production or preview configuration was modified.
* No migration was executed against any provider database.
* `prisma/schema.prisma`, `scripts/migrate.sh` and `DEPLOYMENT.md` are **unchanged** by this pass.
* E8 stays **OPEN** until §6 has run and its outputs are recorded.
