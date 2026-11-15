# JATA AFTERCALL automation engine: foundation and readiness

**Scope:** additive integration foundation only. JATA application/database remain authoritative. n8n is an optional orchestrator; its outage must not fail a completed JATA transaction.

## Environment inspection (2026-11-15, Arena development container)

- Node.js `v22.22.3`; npm `10.9.8` (project accepts Node `^20.19.0 || >=22.12.0`).
- No `n8n` executable before installation attempt. `npm install -g n8n` was attempted once, but **failed**: n8n 2.35.7's native `@confluentinc/kafka-javascript` postinstall could not download its GitHub release binary because certificate verification failed; source fallback then failed fetching Node headers from `nodejs.org` (ECONNRESET). The sandbox permits outbound only to an allowlist that excludes those hosts. No successful executable/version verification; `n8n --version` remains unavailable. This is an environment/network dependency, not evidence of incompatibility. No repeated install was attempted.
- Repository uses Next.js 16, Prisma 5, Neon-compatible PostgreSQL config, Paystack code, and existing product/tenant modules. Deployment config is Vercel (`vercel.json`), which does not host a persistent n8n process. A separate managed container/VM is required; this patch does not create or deploy one.
- No production service/process or n8n host credentials available in this checkout. No live provider/payment calls made.

## Design and security boundary

`lib/automation/events.ts` defines a narrow event envelope and HMAC-SHA256 signing/validation helpers. Outbound delivery is explicitly opt-in through `JATA_N8N_EVENTS_URL` plus a 32+ character `JATA_AUTOMATION_HMAC_SECRET`; HTTPS is required in production; delivery uses a short timeout and returns a boolean without disrupting the authoritative product transaction. Events require a stable event ID, type, tenant ID, timestamp, source and data object. Callers must emit only after the authoritative event is verified and avoid secrets/PII in payloads.

`POST /api/webhooks/automation` provides a 64 KiB-bounded HMAC-authenticated ingress that validates the event envelope and acknowledges accepted events. It intentionally does not mutate business data or expose customer APIs. Invalid signatures are rejected. The callback does **not** presently persist idempotency state or perform actions: production consumers must add a durable inbox/deduplication record and use existing authenticated, permission-checked product APIs before any consequential action. Do not use this acknowledgment route as proof of completed processing.

`automation/docker-compose.yml` is a separately hosted deployment template: n8n's own PostgreSQL and persistent volume are isolated from Neon/JATA data; container port binds loopback; mandatory secrets, encryption key, HTTPS reverse-proxy hostname, retention/pruning, health checks and internal network are specified. It is a template only, not run here. Production needs a hardened reverse proxy/SSO or n8n user management, firewall, encrypted backups and restore drills, monitoring/alerts, key rotation, supported image update policy, resource limits, and staging acceptance.

## Coverage status (no workflows yet activated)

The event contract is product-neutral and can carry verified events from Business Page, AI Front Desk, Website Studio, Business POS, BOS, MJENGO OS, Autopilot and TAPNET, but no product event producers have been wired in this change. Product-specific behavior, scheduled reminders, provider integrations, and admin execution visibility are **NOT TESTED / NOT IMPLEMENTED**. Existing pricing, entitlement and payment code were not changed. No customer-facing workflow can access unrestricted database credentials. Voice/WhatsApp/TAPNET actions require provider API credentials, agreements and explicit authorization.

Central templates requested (onboarding, payment verification, subscription lifecycle, enquiry/lead, appointment, daily report/inventory, health/failure, admin/support escalation) are **NOT CREATED**. Do not import empty placeholders and describe them as working workflows. P2+ implementation depends on a deployed n8n instance, durable JATA outbox/inbox and workflow ownership/approval decisions.

## Test and deployment evidence

Unit test `tests/unit/automation-events.test.ts` covers envelope validation, malformed tenant rejection, signature acceptance/tampering rejection and secret-strength validation. **NOT TESTED:** the repository checkout has no installed project dependencies (`node_modules` absent); invoking the targeted Vitest test failed during config load because `vitest/config` could not be resolved. Typecheck also could not run because the compiler is not installed. HTTP route behavior, delivery, deduplication, tenant isolation under real product APIs, retries, payment integrity, backup/restore and workflow activation require staging/infrastructure and are not represented as verified here.

Deployment: **not deployed**. Production hosting decision: separate managed container/VM with PostgreSQL persistence, not Vercel function hosting. Exact blockers: n8n install blocked by sandbox egress/certificate access; no approved host/domain/DNS/TLS/proxy; no deployment secrets; no approved secrets manager/backup/monitoring; no staging event-producer/outbox; no provider agreements/credentials; no explicit release authorization.
