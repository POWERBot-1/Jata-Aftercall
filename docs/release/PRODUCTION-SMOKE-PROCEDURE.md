# Production smoke test — operator procedure

**Status:** the workflow has never executed. It is **`NOT TESTED`** against
production. Nothing in this document is a claim about production health.

This is the procedure an authorized operator runs. It exists because the review
environment cannot reach the production origin (TLS exit 35) and cannot dispatch
the workflow (HTTP 403), so the last mile has to be done by someone with normal
access — and it has to be done in a way that produces a record rather than an
impression.

---

## 1. What the check is, and what it deliberately is not

| Property | Value |
|---|---|
| Requests | **GET only.** `/` and `/health` (plus `/b/<slug>` if a slug is configured) |
| Authentication | none |
| Writes | none |
| Payments | none |
| Side effects | none. No cache purge, no revalidation call, no deployment trigger. |
| Timeout | 15 s per request by default, 2 attempts |
| Exit codes | `0` all checks passed · `1` a check failed · `2` BLOCKED (unreachable) |

The distinction between `1` and `2` is the point of the design. `1` says the
deployment answered and the answer was wrong. `2` says nothing is known — which
must never be recorded as a pass.

---

## 2. What the environment can and cannot do (verified 2026-10-21)

| Route | Result |
|---|---|
| `curl https://jata-aftercall.vercel.app/` from the review sandbox | **exit 35**, `SSL_ERROR_SYSCALL`, 0.05 s — no TLS path to `*.vercel.app` |
| `gh workflow run production-smoke.yml` | **HTTP 403** `Resource not accessible by integration` — the token lacks `actions:write`, and GitHub only dispatches workflows that exist on the default branch |
| Workflow registered | yes, id `375640098`, state `active`, but **0 runs** for the current file |

Probed once and not repeated, per the standing instruction not to hammer a
failing endpoint or to work around TLS.

---

## 3. The procedure

### 3.1 Preferred: run the workflow from `main`

This only becomes available after this branch merges, because `workflow_dispatch`
requires the file on the default branch.

```bash
gh workflow run production-smoke.yml --repo POWERBot-1/Jata-Aftercall --ref main
gh run list --repo POWERBot-1/Jata-Aftercall --workflow production-smoke.yml --limit 1
gh run watch <run-id> --repo POWERBot-1/Jata-Aftercall
```

Or: Actions → *Production smoke (read-only)* → **Run workflow** → branch `main`.

Optional inputs: `base_url` (defaults to the production origin), `business_slug`
(only if a published storefront should be included).

### 3.2 Equivalent: run the script directly

For a machine that can reach the origin but has no Actions access:

```bash
node scripts/ci/smoke-production.mjs --base-url https://jata-aftercall.vercel.app
echo "exit=$?"
```

With a storefront:

```bash
node scripts/ci/smoke-production.mjs \
  --base-url https://jata-aftercall.vercel.app \
  --slug <published-business-slug>
```

### 3.3 Record every run in this table

A run that is not recorded did not happen.

| Field | Value |
|---|---|
| Date/time (UTC, ISO 8601) | |
| Operator | |
| Target URL | |
| Method | `gh workflow run` / direct script |
| Run id or command | |
| Exit code | |
| `/` HTTP status | |
| `/health` HTTP status | |
| `/health` body `status` and `db` | |
| Result | `PASS` / `FAIL` / `BLOCKED` |

---

## 4. How to read the result

| Observed | Meaning | Record as |
|---|---|---|
| exit 0, `/health` = `{"status":"ok","db":"up"}` | the deployment answers and has a real database | **PASS** |
| exit 1, `/health` body `db: "unconfigured"` | **the deployment is serving pages with no database.** `DATABASE_URL` is absent and the offline stub is in use | **FAIL** — stop and investigate |
| exit 1, `/health` body `db: "down"` | the app is up, the database is not reachable | **FAIL** |
| exit 1, `/` not 200 or not HTML | the deployment is not serving the application | **FAIL** |
| exit 2, `fetch failed` | nothing was learned about the deployment | **BLOCKED** — never a pass |
| exit 2, `no --base-url` | misconfiguration | **BLOCKED** |

`db: "unconfigured"` deserves the emphasis: `app/health/route.ts` returns it
specifically so that a deployment with no database cannot report itself healthy
through the offline stub. A smoke that accepted it would certify exactly the
failure it exists to catch.

---

## 5. What this check does not cover

Even a `PASS` here is narrow. It confirms two GET endpoints answer correctly at
one moment. It does **not** cover:

* authentication, sessions, or any write path;
* payment provider flows (M-PESA STK, callbacks, reconciliation);
* email delivery or password recovery;
* durable media storage;
* the E2E browser journeys (separate workflow);
* Core Web Vitals or any performance claim.

A production smoke `PASS` is evidence that the deployment is reachable and has a
database. It is not a release approval.

---

## 6. Evidence from the review environment

### 6.1 The logic was exercised against a controlled endpoint

The script was run against a local fixture server whose `/health` mirrors
`app/health/route.ts` exactly. All three outcomes were produced, not asserted:

| Scenario | Exit | Observed output |
|---|---|---|
| healthy (`status:ok`, `db:up`) | **0** | `PASS: 2/2 read-only checks succeeded` |
| `db:unconfigured` | **1** | `FAIL health — db:unconfigured — the deployment has no DATABASE_URL and is using the offline stub` |
| nothing listening | **2** | `BLOCKED: the deployment could not be reached at all` |

A first attempt used a fixture without a `status` field; the script failed it
(`status:missing — expected "ok"`), which is the strictness this document relies
on.

These five scenarios are now permanent tests
(`scripts/__tests__/smoke-production-e2e.test.mjs`) and run in the gate, so the
behaviour cannot silently regress.

### 6.2 The production failure, preserved verbatim

```
$ curl -sS -o /dev/null -w 'http=%{http_code}\n' https://jata-aftercall.vercel.app/
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to jata-aftercall.vercel.app:443
exit=35

$ gh workflow run production-smoke.yml --repo POWERBot-1/Jata-Aftercall --ref arena/7486dc85-jata-aftercall
could not create workflow dispatch event: HTTP 403: Resource not accessible by integration
```

Recorded as `BLOCKED`, not retried, and not worked around.
