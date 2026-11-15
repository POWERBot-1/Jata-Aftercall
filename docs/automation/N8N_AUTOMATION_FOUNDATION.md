# JATA AFTERCALL automation engine: foundation and readiness

**Scope:** additive integration foundation only. JATA application/database remain authoritative. n8n is an optional orchestrator; its outage must not fail a completed JATA transaction.

## Environment inspection (2026-11-15, Arena development container)

- Node.js `v22.22.3`; npm `10.9.8` (project accepts Node `^20.19.0 || >=22.12.0`).
- No `n8n` executable before installation attempt. `npm install -g n8n` was attempted once, but **failed**: n8n 2.35.7's native `@confluentinc/kafka-javascript` postinstall could not download its GitHub release binary because certificate verification failed; source fallback then failed fetching Node headers from `nodejs.org` (ECONNRESET). The sandbox permits outbound only to an allowlisted set that excludes those hosts. No successful executable/version verification; `n8n --version` remains unavailable. No TLS verification bypass was attempted. Node’s default CA mode fails to verify github.com in this container, while `NODE_OPTIONS=--use-system-ca` succeeds (`fetch` to github.com returned 200), so the pinned installer now uses the OS trust store with verification enabled. A secure install retry with that setting exposed the actual egress blocker: native prebuild redirects to `release-assets.githubusercontent.com`, which is inaccessible here; source fallback then fails building bundled zlib/libcrypto/libzstd/libcurl and reports the missing generated librdkafka config. Node headers are present locally, but source compilation still cannot complete without dependency build inputs. An earlier fallback also tried nodejs.org headers and failed ECONNRESET. During this follow-up, a second pinned install was inadvertently started when a shell interpreted the installer path in a PR-comment command; it was noticed and terminated with SIGTERM before completion. No TLS settings were changed, and subsequent executable/version checks still show no n8n. These are unsuccessful attempts, not verified installation.
- Repository uses Next.js 16, Prisma 5, Neon-compatible PostgreSQL config, Paystack code, and existing product/tenant modules. Deployment config is Vercel (`vercel.json`), which does not host a persistent n8n process. A separate managed container/VM is required; this patch does not create or deploy one.
- No production service/process or n8n host credentials available in this checkout. No live provider/payment calls made.

## Design and security boundary

`lib/automation/events.ts` defines a narrow event envelope and HMAC-SHA256 signing/validation helpers, requiring an event ID, timestamp, tenant ID, source among the eight product identifiers, event type and data object. Outbound event insertion uses the additive `AutomationEvent` table as a durable outbox; duplicate IDs are accepted idempotently. It does not synchronously couple product request completion to n8n uptime. Producers must enqueue only after verified authoritative state and minimize payloads.

`POST /api/cron/automation-outbox` is an external-scheduler worker protected by a constant-time Bearer secret. It claims up to 20 due records with a lease, signs payloads, uses a five-second timeout, marks success, and applies exponential retry delays up to one hour with eight attempts before `FAILED`. Delivery is at-least-once (a remote success followed by local persistence failure can result in duplicate delivery); n8n handlers must deduplicate using `x-jata-event-id`. `POST /api/webhooks/automation` accepts at most 64 KiB, requires HMAC, validates the envelope, and stores accepted callbacks durably as `RECEIVED`; unique event IDs return an idempotent duplicate acknowledgment. It does not mutate business data or expose customer APIs. Persistence failures return 503 to allow retry.

These pieces are the durable transport foundation, not proof of end-to-end product integration. No producers are yet called by the eight products, no durable inbox consumer/action processor or admin dashboard exists, and monitoring is presently via outbox state/worker response rather than a JATA admin UI. Workflow actions must use existing authenticated, permission-checked product APIs. The additive schema/migration and new Prisma model require the CI database migration rehearsal before acceptance. Do not use this acknowledgment route as proof of completed processing.

`automation/docker-compose.yml` is a separately hosted deployment template: n8n's own PostgreSQL and persistent volume are isolated from Neon/JATA data; container port binds loopback; mandatory secrets, encryption key, HTTPS reverse-proxy hostname, retention/pruning, health checks and internal network are specified. It is a template only, not run here. Production needs a hardened reverse proxy/SSO or n8n user management, firewall, encrypted backups and restore drills, monitoring/alerts, key rotation, supported image update policy, resource limits, and staging acceptance.

## Coverage status (no workflows yet activated)

| Product | Event transport foundation | Verified producer / workflow |
|---|---|---|
| Business Page | **PASS** — product ID accepted by envelope | **NOT TESTED** — no producer or workflow |
| AI Business Front Desk (including English/Kiswahili) | **PASS** — product ID accepted | **NOT TESTED** — no producer, routing, handover or provider workflow |
| Website Studio | **PASS** — product ID accepted | **NOT TESTED** — no producer or per-site workflow |
| Business POS | **PASS** — product ID accepted | **NOT TESTED** — no producer; no sales/inventory automation |
| BOS | **PASS** — product ID accepted | **NOT TESTED** — no producer or role-aware report workflow |
| MJENGO OS | **PASS** — distinct `mjengo_os` product ID | **NOT TESTED** — no milestone producer/workflow |
| Autopilot | **PASS** — product ID accepted | **NOT TESTED** — no producer/workflow or approval action integration |
| TAPNET | **PASS** — product ID accepted | **BLOCKED** — no verified provider APIs/agreements or operational approval; no live activation claim |

The transport accepts events for these product namespaces but this is not product-wide integration. Producers are not yet wired to verified transaction points; product-specific reminders, actions, reporting and admin execution visibility are not implemented. Existing pricing, entitlement and payment code were not changed. No customer-facing workflow has direct DB credentials. Voice/WhatsApp/TAPNET actions require provider API credentials, agreements and explicit authorization.

Central templates requested (onboarding, payment verification, subscription lifecycle, enquiry/lead, appointment, daily report/inventory, health/failure, admin/support escalation) are **NOT CREATED**. Do not import empty placeholders and describe them as working workflows. P2+ implementation depends on a deployed n8n instance, durable JATA outbox/inbox and workflow ownership/approval decisions.

## Test and deployment evidence (updated after local dependency attempt)

`npm ci` with normal lifecycle scripts failed because Prisma 5.22.0 tried to fetch its engine checksum from `binaries.prisma.sh`, which is inaccessible from this sandbox. `npm ci --ignore-scripts` installed 605 packages and reported 8 moderate audit findings; this is not the project’s supported complete installation because generated Prisma Client is absent. `npm audit --omit=dev --audit-level=high` passed with zero production dependency findings. ESLint passed with 0 errors and 51 warnings. The focused automation and additive-migration guard tests passed (21/21). Full `npm test`: 4,674 passed, 340 skipped, 2 failed tests across 4 failed suites: generated Prisma Client unavailable in Prisma-dependent suites, an Autopilot rollback/isolation test failed, and a migration allowlist test initially failed because the new migration was unregistered; that allowlist was updated and the targeted test now passes. `npm run typecheck` is blocked by the missing generated Prisma Client. `npx prisma validate` is blocked trying to fetch the engine checksum from the same inaccessible host. Do not treat the partially installed dependencies as CI evidence.

The following verification is on candidate `d7cb158` (PR CI):

- **PASS** — full no-database suite: 1,476 suites, 5,028 tests; 4,682 passed, 346 skipped/pending, 0 failed.
- **PASS** — Prisma schema validation and generation; model references; typecheck; unit suite; offline build.
- **PASS** — candidate migration rehearsal on disposable PostgreSQL 18 (clean install, upgrade, failure/rollback recovery) and production build/audit checks. The inbox/outbox migration is included.
- **PASS** — database-backed Interactive Business E2E job: Prisma generation, lint/TypeScript, migrations and unit/integration/security suite; end-to-end product browser acceptance also completed successfully. Dedicated automation PostgreSQL test cases are gated on `PRISMA_TEST_DATABASE_URL` and run in this DB-enabled suite; the local container did not have PostgreSQL, so local execution skipped them.
- **FAIL** — Admin instruction integrity’s separate repository-wide `programme-completeness` check: required readiness evidence is missing/not PASS. This is an independent release gate; it has not been bypassed.
- The previous candidate’s model-consistency failure was fixed by adding the fail-closed offline fallback. The previous Autopilot test failure was a time-expired hard-coded fixture; changed to an active relative-to-now fixture while retaining entitlement checks, and it now passes locally and in the latest full CI suite.

The local shell still cannot fetch n8n’s native release asset or required source-build dependency inputs, despite system-CA verification, and no n8n executable is available. The CI evidence above verifies JATA application/schema/tests, **not n8n installation or n8n workflow execution**. HMAC route integration, live delivery retry fault injection, tenant separation through real product producers, payment integrity, backup/restore and n8n workflow execution have not been validated. No staging host or provider credentials are configured.

Deployment: **not deployed**. Production hosting decision: separate managed container/VM with PostgreSQL persistence, not Vercel function hosting. Exact blockers: n8n install blocked by sandbox egress/certificate access; no approved host/domain/DNS/TLS/proxy; no deployment secrets; no approved secrets manager/backup/monitoring; no staging event-producer/outbox; no provider agreements/credentials; no explicit release authorization.
