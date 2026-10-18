# Migration target guard

A fail-closed gate in front of `prisma migrate deploy`.

---

## 1. The problem it solves

`scripts/build.sh` runs on every Vercel build. When `DATABASE_URL` is set it
calls `scripts/migrate.sh`, which runs `prisma migrate deploy`. Production and
Preview are separate Vercel environments that both define `DATABASE_URL`.

That is convenient — Preview databases provision themselves — but it means a
build is a migration. If the Production environment ever held a Preview URL, or
a Preview environment held the Production URL, the build would migrate the wrong
database with the committed schema. Nothing in the pipeline compared the
target against an expectation. The blast radius is the whole schema.

The guard adds that comparison. It runs immediately before Prisma and, when it
refuses, `migrate.sh` exits non-zero so the build stops **before `npx` is
invoked**.

---

## 2. Where it runs

```
Vercel build
 └─ npm run build              (package.json)
     └─ bash scripts/build.sh
         ├─ DATABASE_URL present → bash scripts/migrate.sh
         │    └─ node scripts/lib/migration-target-guard.mjs check   ← here
         │         allow    → npx prisma migrate deploy
         │         refuse   → exit 1, build stops
         ├─ npx prisma generate
         └─ npx next build --webpack
```

No `DATABASE_URL` means `migrate.sh` exits before the guard: there is nothing
to migrate and the build continues with the offline fallback.

---

## 3. What it decides

| Environment | Target | Outcome |
|---|---|---|
| `production` | matches an enrolled fingerprint | **allow** — `OK_ENROLLED_PRODUCTION` |
| `production` | allowlist unenrolled (empty) | **refuse** — `REFUSED_PRODUCTION_UNENROLLED` |
| `production` | does not match any enrolled fingerprint | **refuse** — `REFUSED_PRODUCTION_UNKNOWN_TARGET` |
| `preview` | not an enrolled Production target | **allow** — `OK_PREVIEW` |
| `preview` | an **enrolled Production** target | **refuse** — `REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION` |
| `ci` / `development` / `local` | not an enrolled Production target | **allow** |
| `ci` / `development` / `local` | an **enrolled Production** target | **refuse** |
| `unknown` | anything | **refuse** — `REFUSED_UNKNOWN_ENVIRONMENT` |

`unknown` means `VERCEL` is set but `VERCEL_ENV` is missing or not one of
`production` / `preview` / `development`. An environment we cannot name is never
treated as permissive.

Additional refusals:

| Condition | Code |
|---|---|
| `DATABASE_URL` set but unparseable, or not `postgres:`/`postgresql:` | `REFUSED_UNPARSEABLE_URL` |
| `DATABASE_URL` has no database name | `REFUSED_MISSING_DATABASE_NAME` |
| allowlist missing, malformed, or internally inconsistent | `REFUSED_ALLOWLIST_INVALID` |
| `MIGRATION_GUARD_MODE` set to anything but `enforce` / `off` | `REFUSED_INVALID_MODE` |
| unexpected exception inside the guard | `REFUSED_INTERNAL_ERROR` |

---

## 4. Fingerprints

```
fingerprint = sha256(normalized_host + "|" + database_name)
```

- Host is lowercased and trailing dots are removed (DNS is case-insensitive).
- The database name is percent-decoded and **not** lowercased (PostgreSQL
  database names are case-sensitive).
- User, password, port, and query string are excluded: they are not identity.
- The value is one-way. The allowlist is safe to commit.

### What a fingerprint proves — and what it does not

It proves that two URLs name the same host and database.

It does **not** prove:

- who owns that database;
- that the database is the Production runtime's actual target;
- that the URL is not shared with another application or environment.

A matching hash in the allowlist means someone, at some point, recorded an
intent. That recording is the security control, and it is only as good as the
evidence behind it.

---

## 5. Enrolment

`scripts/lib/migration-target-allowlist.json` ships as:

```json
"production": { "mode": "unenrolled", "fingerprints": [], "enrollmentEvidence": null }
```

Loader rules, all enforced fail-closed:

- `mode` must be `enrolled` or `unenrolled`.
- `unenrolled` **must** have an empty `fingerprints` array.
- `enrolled` **must** have at least one fingerprint and a non-empty
  `enrollmentEvidence` string.
- Every fingerprint must be 64 lowercase hex characters; duplicates are
  rejected.
- `expectedHosts` is optional and informational only. It can never widen or
  narrow a decision; a host outside it is appended to the decision detail so a
  reviewer notices that a target moved.

### Procedure to enrol

1. Obtain independently verified identity evidence: Neon project ID and name,
   branch ID and name, database name, and endpoint — corroborated against a
   named Vercel Production deployment. A second person confirms it.
2. Derive the digest locally. Do not copy it from a build log:
   ```bash
   node scripts/lib/migration-target-guard.mjs print-fingerprint
   # run in the environment that holds the verified Production DATABASE_URL
   ```
3. Set `mode` to `enrolled`, add the digest, and write `enrollmentEvidence`
   naming the reviewer, the date, and the identifiers — never a URL,
   hostname, or credential.
4. Run the guard tests, the unit suite, and lint.
5. Record the new tree hash; the previous one no longer describes the branch.

### Operationally important

Enrolment and enabling the guard should land **in the same reviewed change**.
If the guard is merged while the allowlist is still empty, the next Production
build is refused at migration time and every release — including hotfixes —
stops until enrolment lands. That is the guard working as designed, but it is a
release freeze, not a migration failure.

---

## 6. `MIGRATION_GUARD_MODE`

| Value | Behaviour |
|---|---|
| unset | `enforce` |
| `enforce` | normal |
| `off` | every check disabled; prints a warning |
| anything else (including `""`, `OFF`, `0`) | refusal |

`off` exists so an operator can unblock an environment in an emergency **after
deciding that migrating an unverified target is preferable to being down**. It
is a dashboard-level override with no paper trail in the repository. Prefer
fixing the allowlist.

Note that `off` still cannot make a malformed allowlist valid or a broken URL
parseable — only the environment and target checks are bypassed.

---

## 7. Safety properties

- **No network I/O, no child processes.** The module reads one local JSON file
  and hashes a string. A structural test asserts it imports no `http`, `https`,
  `net`, `dgram`, or `child_process`, and calls neither `fetch` nor `eval`.
- **No secret output.** The URL is parsed and discarded. Output contains only a
  code, the environment, the mode, and a one-way digest. Tests assert that the
  password, user, host, and `postgresql://` never appear in either stream, for
  both allowed and refused decisions.
- **Fail closed on the unexpected.** Any exception becomes
  `REFUSED_INTERNAL_ERROR`, never an allowance.
- **Dependency-free.** The guard and its tests run with `node_modules` absent,
  because they execute in a build container before application dependencies are
  guaranteed to exist.

---

## 8. Tests

```bash
node --test scripts/__tests__/migration-target-guard.test.mjs
node --test scripts/__tests__/migration-gate-refusal.test.mjs
```

Two suites, deliberately split:

**`migration-target-guard.test.mjs`** — unit and decision coverage: URL
parsing, host normalisation, fingerprint vectors, environment classification,
mode resolution, every allowlist validation rule, every `decide()` branch, the
`describe()` / `toJSON()` no-leak guarantees, CLI exit codes, and the structural
safety properties.

**`migration-gate-refusal.test.mjs`** — integration. It executes the real
`scripts/migrate.sh` and `scripts/build.sh` with a recording `npx` stub first on
`PATH`, then asserts both the exit code and **which commands ran**. Every
refusal case asserts `npx` was never called, which is the property that matters:
a guard that refuses but still lets Prisma start protects nothing.

Cases include: unenrolled Production, enrolled-but-non-matching Production,
missing `VERCEL_ENV`, unrecognised `VERCEL_ENV`, unparseable URL, URL without a
database name, non-PostgreSQL URL, invalid mode, Preview pointing at an enrolled
Production target, a **missing guard module**, and a full `build.sh` run proving
that a refused migration never reaches `prisma generate` or `next build`.

Run both with:

```bash
node --test scripts/__tests__/migration-target-guard.test.mjs \
            scripts/__tests__/migration-gate-refusal.test.mjs
```

The paths are listed explicitly rather than globbed, for identical behaviour on
every supported Node version and shell.

---

## 9. CI

`.github/workflows/interactive-business-e2e.yml` gains a `migration-guard` job:
`ubuntu-latest`, 5-minute timeout, `contents: read`, checkout, Node 22, then the
two test commands above. No `npm ci`.

It runs on the same triggers as the rest of the workflow: pull requests
targeting `main`, pushes to `main`, and manual dispatch. `node --test` exits
non-zero when any test fails, so a failure fails the job and the workflow.

**Not done from the repository:** making this a *required* status check. That is
a branch-protection setting. Until it is required, the job reports but does not
block a merge.

---

## 10. Rollback

- **Guard misbehaving in one environment:** set `MIGRATION_GUARD_MODE=off` in
  that Vercel environment to unblock, then fix forward. Revert the variable
  afterwards.
- **Guard merged but nothing enrolled:** Production builds refuse. Either enrol
  the verified target, or revert the merge.
- **Reverting the guard entirely:** revert the commit. `migrate.sh` returns to
  running `prisma migrate deploy` unconditionally — the pre-guard behaviour.

---

## 11. Relationship to the rest of the pipeline

The e2e workflow applies migrations with `npx prisma migrate deploy` against an
isolated PostgreSQL service and does not call `scripts/migrate.sh`. PR CI
therefore exercises the migrations, and the `migration-guard` job exercises the
guard's *tests* — but neither runs the guard against a database. The guard's
real job is in the Vercel build, which CI cannot reproduce.
