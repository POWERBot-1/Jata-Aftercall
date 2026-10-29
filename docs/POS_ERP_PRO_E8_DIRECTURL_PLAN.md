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
scripts/lib/direct-url-guard.mjs      (new, pure function + CLI wrapper)
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
#    (Real filename: an earlier revision said scripts/lib/migration-url-guard.mjs, which does not
#    exist — that command failed with MODULE_NOT_FOUND rather than with a refusal.)
env -u DIRECT_URL node scripts/lib/direct-url-guard.mjs check            # DIRECT_URL unset  → exit 1 (REFUSED_POOLED_WITHOUT_DIRECT_URL)
DIRECT_URL="$DATABASE_URL" node scripts/lib/direct-url-guard.mjs check   # DIRECT_URL pooled → exit 1 (REFUSED_DIRECT_URL_IS_POOLED)
node scripts/lib/direct-url-guard.mjs check                              # the pair above    → exit 0 (OK_DIRECT_URL_READY)

# 2. Prove migrations apply over the direct connection (in CI, where engines download):
npx prisma generate && npx prisma migrate deploy        # expect "Migrations applied" / "No pending"

# 3. Prove the trap is real (this is the evidence E8 is missing):
#    Call prisma DIRECTLY with both URLs on the pooled host, bypassing our wrapper, and record
#    whatever it actually says. The expected failure is P1002 (advisory lock) or P3009 (a failed
#    migration left behind) — do not assume which, and quote the real text.
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DATABASE_URL" npx prisma migrate deploy || true
#    An earlier revision of this plan used `prisma migrate resolve --applied 0_init`. No `0_init`
#    migration exists in this repository (the first directory is 20250915000000_init), so that
#    command could not have demonstrated anything. If resolve is needed at all, use a real
#    directory name from `ls prisma/migrations`.

# 4. Prove the runtime path through the pooler:
PRISMA_TEST_DATABASE_URL="$DATABASE_URL" npm run test:db:erp     # expect every test to pass (72 at this head; 67 before the supplier-bill, expense, order-transition and balance-sheet tests). A skipped suite is a failure: the ERP job fails on any skip.

# 5. Prove cold start after auto-suspend (free tier suspends idle branches):
sleep 360; PRISMA_TEST_DATABASE_URL="$DATABASE_URL" npm run test:db:erp | tail -5

# 6. Teardown: delete the rehearsal branch/project. Nothing in Production was read or written.
```

**What to record afterwards** (this is what turns E8 from OPEN to PASS): the migration output, the
the failure text actually observed in step 3, the full-suite result in steps 4 and 5, the Neon PostgreSQL version,
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

---

## 10. Execution record, 2026-10-28 (owner authorized a free-tier rehearsal)

### 10.1 The authorization

The owner explicitly authorized provisioning a **Neon Free-tier, non-production** project for this
rehearsal, conditional on the actual cost being KES 0 / USD $0 with no paid plan, add-on or billing
commitment, and on stopping and reporting if that could not be guaranteed.

### 10.2 What was done: the code half (§2 of this document)

| Change | File | Verified how |
| --- | --- | --- |
| `directUrl = env("DIRECT_URL")` added beside the existing pooled `url` | `prisma/schema.prisma` | `tests/unit/direct-url-guard.test.ts` asserts both lines exist |
| Preflight that refuses a pooled migration target | `scripts/lib/direct-url-guard.mjs` (new) | 15 unit tests; four CLI runs (below) |
| `DIRECT_URL` defaults to `DATABASE_URL` so no environment needs a second variable to build | `scripts/lib/prisma-env.sh` (new), sourced by `build.sh` and `migrate.sh` | build gate run, below |
| One wrapper for every client generation, so P1012 cannot occur | `scripts/lib/prisma-generate.sh` (new) | 9 raw `npx prisma generate` call sites routed through it; `grep` shows zero bypasses |
| Guard runs **before** Prisma in the migration gate | `scripts/migrate.sh` | build gate output below |
| Deployment instructions | `DEPLOYMENT.md` §1/§2, `.env.example` | manual review |

**Failure-path validation (rehearsal step 6), run locally with synthetic URLs — no network, no secrets:**

| Input | Result | Exit |
| --- | --- | --- |
| pooled `DATABASE_URL`, `DIRECT_URL` unset (defaults to the pooled URL) | `REFUSED_POOLED_WITHOUT_DIRECT_URL` + the remedy | 1 |
| pooled `DATABASE_URL`, `DIRECT_URL` also pooled (explicitly) | `REFUSED_DIRECT_URL_IS_POOLED` | 1 |
| pooled `DATABASE_URL`, genuinely direct `DIRECT_URL` | `OK_DIRECT_URL_READY` — runtime pooled, migrations direct | 0 |
| single local URL (CI/local shape) | `OK_DIRECT_URL_READY` | 0 |
| unparseable URL, or URL with no database name | `REFUSED_UNPARSEABLE_URL` / `REFUSED_MISSING_DATABASE_NAME` | 1 |

**End-to-end in the real build gate** (`npm run build` with a local `DATABASE_URL`):

```
[migrate] checking the migration connection (pooled vs direct)...
[direct-url] OK (OK_DIRECT_URL_READY) — single non-pooled URL, migrations use it directly
[migrate] checking migration target...
[migration-guard] OK_LOCAL env=local mode=enforce target=e76708…
```

The existing migration-target guard still runs after it, in the same order as before, so this change
added a control and removed none.

### 10.3 What could NOT be done, and the exact blocker

**Neon provisioning and the six-step rehearsal are BLOCKED. No project was created and nothing was
spent.** The blocker is network reachability, not cost:

```
$ curl -sS --max-time 15 https://api.neon.tech/
curl: (6) Could not resolve host: api.neon.tech
$ getent hosts api.neon.tech
DNS: no resolution
```

This sandbox permits outbound traffic only to `github.com`, `codeload.github.com`, `api.github.com`,
`registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org`. A control request to `api.github.com`
returns 200 in the same shell, so the failure is the egress allowlist, not a broken network. There is
also no Neon API key, no `neonctl`, and no Neon console access — none of which can be obtained from inside
the sandbox, and none of which were requested in chat.

**The cost question the authorization asked about could therefore not be answered from here at all.**
Neon's free tier is documented as $0 with no card required, but this pass did not verify that against the
provider, and an unverified claim is not evidence. It is recorded as unverified rather than asserted.

### 10.4 Required environment and the precise manual action

To complete the rehearsal, someone with Neon console access (the owner) must either run §6 of this
document, or provide a disposable Neon project and a machine with egress to `api.neon.tech`. The exact
manual action:

1. Create a Neon **Free** plan project (do not upgrade, do not add a payment method).
2. Create a throwaway branch named `rehearsal`; use only that branch.
3. From **Connection string**, copy both values; put them in the shell as `DATABASE_URL` (pooled) and
   `DIRECT_URL` (direct), never in a file that is committed.
4. Run §6 steps 1–6 of this document and paste the output.

### 10.5 What this does and does not change about the release

* The **defect is fixed in the code** and guarded, tested and fail-closed: with `directUrl` in place, a
  manual `prisma migrate deploy` uses the direct connection even when `DIRECT_URL` is unset-but-defaulted
  to a non-pooled URL, and the guard refuses the pooled case before Prisma runs.
* **No Neon-specific evidence exists.** PgBouncer's advisory-lock behaviour, Neon's extension set,
  `sslmode=require`, branch/restore and cold start after auto-suspend remain **NOT TESTED**.
* Therefore **E8 stays OPEN**, and the production deploy gate that depends on it stays closed.
* Two owner actions are required before a production deploy could even be attempted: `DIRECT_URL` must
  exist in Vercel Production and Preview (a production configuration change this pass is not authorized
  to make), and the rehearsal above must run.

**Correction (2026-10-29).** Steps 1 and 3 as originally written could not have worked: step 1 named a
script that does not exist, and step 3 resolved a migration that does not exist. Both are fixed above.
The guard's behaviour is unchanged and is exercised offline by `tests/unit/direct-url-guard.test.ts`
(17/17) plus three synthetic-URL probes run on 2026-10-29: pooled without `DIRECT_URL` → exit 1,
pooled with a pooled `DIRECT_URL` → exit 1, pooled with a genuinely direct `DIRECT_URL` → exit 0.
This matters because §6 is the procedure the owner is asked to run; a procedure whose first command
fails is not a procedure.
