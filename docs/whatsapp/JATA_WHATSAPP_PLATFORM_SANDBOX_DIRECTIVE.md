# JATA WhatsApp Platform — sandbox-first implementation directive

**Status:** DESIGN / SANDBOX ONLY. This document does not authorize production configuration, database migration, Meta asset creation, live messaging, billing, deployment, or feature activation.

**Repository:** POWERBot-1/Jata-Aftercall  
**Base at branch creation:** main  
**Branch:** feature/whatsapp-platform-sandbox

## 1. Objective

Extend the existing Meta WhatsApp Cloud API integration into a first-party, multi-tenant WhatsApp CRM platform. Use Meta's official Cloud API and current Embedded Signup v4. Do not introduce WA-CRM, Twilio, unofficial WhatsApp Web automation, browser scraping, or a second competing webhook subsystem.

The platform must let independently owned businesses connect their own WABAs and phone numbers, receive and respond to messages, manage contacts/conversations, and use JATA AI Front Desk with strict tenant isolation.

## 2. Existing repository facts — preserve and reconcile

Existing code found on main:

- `lib/messaging/meta-whatsapp.ts`: Graph API v26.0 adapter focused on authentication copy-code templates.
- `lib/messaging/meta-whatsapp-webhook.ts`: raw-body HMAC-SHA256 verification and OTP status callback correlation.
- `app/api/webhooks/meta-whatsapp/route.ts`: existing dedicated OTP status webhook.
- `docs/agents/META_WHATSAPP_HANDOFF.md`: existing owner setup and fail-closed activation requirements.
- `lib/autopilot/channels.ts`: channel readiness matrix currently reads legacy `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`, while the adapter reads `META_WHATSAPP_ACCESS_TOKEN` and `META_WHATSAPP_PHONE_NUMBER_ID`.

Before changing code, inspect all references to these names and create a compatibility plan. Do not rename/remove existing variables or alter OTP behaviour in this workstream. Keep the existing OTP webhook contract separate from general CRM message ingestion; share low-level signature verification only if it can be done without changing event routing or persistence semantics.

## 3. Hard safety boundary

Sandbox phase must satisfy all of the following:

- All new WhatsApp platform flags default to disabled.
- No production environment variables are read or changed.
- No production database connection, migration, seed, or write is permitted.
- No real customer messages, bulk campaigns, paid template sends, payments, subscriptions, or provider charges.
- No production deployment, merge, branch protection change, or existing PR modification.
- No credentials, access tokens, app secrets, verification tokens, encryption keys, phone numbers, or customer message bodies in Git, fixtures, tests, logs, screenshots, or chat.
- Use mocked Meta transport and synthetic tenant/message fixtures first.
- A real Meta developer test WABA/number may be connected only after the owner separately creates/configures it and explicitly authorizes the exact test. Never use a customer or production number for initial tests.

## 4. Target architecture

Next.js route handlers / server actions (authenticated)
  -> WhatsApp domain services (tenant-aware)
  -> Meta Cloud API adapter (server-only, version-pinned)
  -> durable inbound event inbox + outbound outbox
  -> tenant-scoped PostgreSQL records via Prisma
  -> JATA AI Front Desk / CRM / POS / BOS through existing domain services

Meta webhooks
  -> HTTPS ingress / size limits / raw-body signature verification
  -> event validation and tenant/WABA/phone-number resolution
  -> durable deduplicated event insert
  -> asynchronous processor
  -> conversation/contact/assignment updates
  -> AI draft or policy-approved automated response
  -> outbound outbox and Meta API
  -> delivery/read/failure status reconciliation

Embedded Signup v4
  -> Facebook Login for Business configuration
  -> signed server-side code exchange / onboarding completion
  -> validate WABA and phone-number ownership/permissions
  -> persist tenant connection and encrypted credentials
  -> subscribe WABA to app webhooks
  -> health and lifecycle status

## 5. Data model requirements

Design Prisma models and migration only after inspecting existing Business, BusinessMember, User, AuditEvent and messaging models. Prefer relations to existing business/tenant records; do not create a parallel tenant identity.

Required entities (names are conceptual; inspect collisions before choosing model names):

- WhatsAppBusinessConnection: tenant/business, Meta WABA ID, state, granted scopes, onboarding metadata, created/updated timestamps.
- WhatsAppPhoneNumber: connection, Meta phone-number ID, display phone metadata, verified/display status, quality/messaging tier metadata where available.
- WhatsAppCredential: encrypted access token, key version, rotation/expiry metadata; never expose ciphertext or plaintext to client APIs.
- WhatsAppContact: tenant-scoped normalized WhatsApp user identifier, consent state/source/timestamp, opt-out timestamp.
- WhatsAppConversation: tenant, phone-number, contact, status, assigned user/team, last activity.
- WhatsAppMessage: tenant, conversation, direction, type, provider message ID, template metadata, delivery state, timestamps; message body retention must be explicit and minimized.
- WhatsAppWebhookEvent: unique provider event identity, payload hash, processing state, attempts, received/processed timestamps. Avoid retaining full raw payload unless a documented encrypted retention need exists.
- WhatsAppOutbox: unique internal idempotency key, tenant, recipient, message intent, state, attempt count, lease/next-attempt timestamps, provider message ID.
- WhatsAppAuditEvent: tenant, actor, action, target, timestamp, safe metadata.

Every tenant-owned row must have a tenant/business foreign key and tenant-first unique/index constraints. Service queries must require tenant scope. Enforce authorization in server services, not only UI. Add PostgreSQL integration tests proving cross-tenant reads, writes, updates and webhook routing are denied.

## 6. Messaging and webhook invariants

- Use official Graph API Cloud API endpoints and a single centrally managed supported API version.
- Verify `X-Hub-Signature-256` against the exact raw request bytes using the Meta app secret and timing-safe comparison.
- Bound request body size, entry/change/status counts and field lengths.
- Verify the webhook phone-number ID and WABA resolve to exactly one active connection before tenant routing.
- Deduplicate provider event IDs and message IDs under database uniqueness constraints.
- Persist inbound event before acknowledging success; process asynchronously with bounded retries and dead-letter/unknown states.
- Never trust event order; status transitions must be monotonic and timestamp-aware.
- Do not assume Meta provides exactly-once delivery or a generic idempotency key for sends.
- For ambiguous network timeout/5xx/429 outcomes, preserve UNKNOWN and reconcile; do not blindly resend.
- Outbound messages must validate tenant connection, recipient format, consent/purpose, policy, 24-hour customer-service window and template approval requirements.
- Marketing campaigns are out of scope for initial MVP. No bulk-send UI or campaign worker in sandbox phase.
- Human handover must stop automated replies until an authorized operator resumes automation.
- AI output must be treated as untrusted content; never allow it to authorize payment, refund, subscription, POS, inventory, or account changes.

## 7. Security and privacy acceptance

- Tenant isolation on every service/query; tests include IDOR and guessed-ID attempts.
- Meta access tokens encrypted at rest using authenticated encryption (AES-256-GCM or equivalent), with a dedicated server-only key and explicit key version. No hard-coded key or fallback.
- Keep app secret, access token, webhook verify token, encryption key and OAuth credentials server-only.
- OAuth state/CSRF protection, exact redirect URI allowlist, PKCE/state where supported, replay-safe code exchange, and strict callback validation.
- Least-privilege Meta scopes; request only the permissions required for the approved use case.
- Role checks for connect/disconnect, template management, inbox access, exports and retention actions.
- Redact credentials, authorization headers, message bodies and personal identifiers from logs and error telemetry.
- Rate limits by tenant, connection, sender and recipient; protect onboarding and webhook endpoints from abuse.
- Consent evidence, STOP/opt-out handling, data export/deletion workflows and documented retention.
- Audit privileged operations and credential rotations without recording secret values.
- Validate uploaded media type, size and ownership; use private object storage and short-lived signed access if media is later implemented.
- No message content to AI providers unless the tenant has enabled the feature and applicable privacy/processing disclosures are in place.

## 8. Meta onboarding gates

For development, first use Meta's dashboard-provided test WABA/phone number and synthetic owner-controlled recipient where Meta's test setup permits. Do not claim a real Meta sandbox run until it has been executed and evidence retained.

For public multi-business onboarding, prepare:

1. Meta Developer account and JATA business portfolio.
2. Verified legal business and domain/business details as required by Meta.
3. A dedicated Meta Business app for the JATA platform; do not repurpose unrelated apps.
4. WhatsApp product and test WABA/phone number.
5. Webhook HTTPS endpoint and subscribed fields.
6. App Review evidence for the requested WhatsApp permissions.
7. Advanced Access for permissions required to manage customer WABAs.
8. Meta Tech Provider verification/onboarding as applicable.
9. Facebook Login for Business configuration using current WhatsApp Embedded Signup v4.
10. Approved customer-facing privacy policy, terms, data deletion/contact details and clear customer consent.
11. Documented support, abuse handling, disconnection and token revocation procedures.

Expected permissions include `whatsapp_business_messaging` and `whatsapp_business_management`; request `business_management` only where the actual portfolio operation requires it. Confirm exact requirements in current Meta App Dashboard and official docs before submission. Do not represent JATA as a Meta Tech Provider or certified partner until Meta has approved the status.

## 9. Phase plan and gates

### Phase 0 — inventory and isolated test harness
- Record exact base SHA and clean working tree.
- Map existing auth, business tenancy, Prisma models, messaging provider abstractions, webhook routes, queues, audit and feature-flag patterns.
- Reconcile WhatsApp env naming without modifying production.
- Add synthetic fixtures and mocked transport tests only.
- No migration or live Meta call.

### Phase 1 — tenant-safe persistence
- Design schema, indexes, unique constraints and migration.
- Add tenant-scoped service layer and negative authorization tests.
- Run migration only against a newly created disposable local PostgreSQL database.
- Verify existing OTP models/routes and tests unchanged.

### Phase 2 — inbound/outbound engine
- Implement event inbox, outbox, deduplication, leases, bounded retries, unknown state and status reconciliation.
- Mock tests for valid/invalid signatures, malformed payload, duplicate/reordered callbacks, unknown WABA/phone ID, cross-tenant routing, timeout and rate-limit ambiguity.
- No campaigns.

### Phase 3 — inbox/CRM
- Tenant-scoped contacts, conversations, assignments, search, templates metadata and human handover.
- Authenticated UI tests and mobile screenshots with synthetic data.

### Phase 4 — Embedded Signup v4
- Implement only after Meta configuration and required app permissions are owner-provisioned.
- Test with a Meta test WABA and test phone number.
- Verify OAuth state, token exchange, WABA/phone mapping, revocation and disconnect.

### Phase 5 — AI Front Desk
- Add opt-in per business, business knowledge retrieval, language handling, confidence threshold, escalation and audit.
- AI may draft/respond only within configured authority; financial actions remain on existing authoritative JATA flows.

### Phase 6 — release review
- Independent security review, tenant-isolation tests, migration review, exact-head CI, operational runbook and screenshots.
- Production flags remain disabled until a separate explicit owner approval and successful Meta approval.

## 10. Required tests

At minimum, add tests for:

1. Tenant A cannot read/update/delete Tenant B connections, contacts, conversations, messages or credentials.
2. A valid Meta signature is accepted; missing, malformed, stale/wrong-secret signatures are rejected.
3. Webhook body size and nested collection bounds are enforced.
4. Unknown WABA or phone-number ID is rejected/quarantined without tenant guessing.
5. Duplicate webhook event is persisted/processed once.
6. Reordered status callbacks cannot regress delivered/read to sent.
7. Outbox worker lease prevents concurrent duplicate dispatch.
8. Timeout/429/5xx becomes UNKNOWN and is not blindly resent.
9. Template sends outside customer-service window are blocked unless approved template and valid policy conditions are met.
10. Opt-out blocks marketing and other non-essential messaging.
11. Credential encryption/decryption, key-version rotation and missing-key fail-closed behaviour.
12. OAuth state mismatch, callback replay and unauthorized redirect are rejected.
13. Human handover suppresses bot responses.
14. AI prompt injection cannot cause unauthorized payment/order/account mutations.
15. Existing agent OTP WhatsApp verification and webhook tests remain green.

## 11. Local safe-test commands

Run only from a clean feature branch and disposable local database. Review each command before execution.

```powershell
git status --short
git switch feature/whatsapp-platform-sandbox
git rev-parse HEAD
node --version
npm --version
npm ci
npm run typecheck
npm run lint
npm test -- --reporter=dot
```

Use a dedicated local PostgreSQL database with synthetic data. Do not copy production `DATABASE_URL`, `DIRECT_URL`, Vercel variables or customer data into local files. Never point `prisma migrate` at Neon production for this workstream.

After schema work exists and is reviewed, run the migration only against the disposable local database using the repository's existing guarded migration workflow. Do not add a seed that can target shared/production databases.

## 12. Required environment variable names (placeholders only)

All new variables must be empty/unset by default and validated server-side. Do not add values to `.env.example` other than empty placeholders and descriptions.

- `JATA_WA_PLATFORM_ENABLED=false`
- `JATA_WA_SANDBOX_MODE=true`
- `META_WA_PLATFORM_GRAPH_VERSION=<currently-approved-version>`
- `META_WA_PLATFORM_APP_ID=`
- `META_WA_PLATFORM_APP_SECRET=`
- `META_WA_PLATFORM_ACCESS_TOKEN=` (only if architecture requires a system-user token; do not store per-tenant tokens globally)
- `META_WA_PLATFORM_WEBHOOK_VERIFY_TOKEN=`
- `META_WA_PLATFORM_ENCRYPTION_KEY=`
- `META_WA_PLATFORM_EMBEDDED_SIGNUP_CONFIG_ID=`
- `META_WA_PLATFORM_REDIRECT_URI=`

These names are proposed for the multi-tenant platform domain and must not silently alias or overwrite the existing OTP integration variables. Per-tenant tokens belong in encrypted tenant credential records, not shared environment variables.

## 13. Completion report format

Report PASS / FAIL / BLOCKED / NOT TESTED for each gate. Include branch, base SHA, candidate SHA, changed files, test commands/results, migration target proof, security evidence, and outstanding owner actions. Explicitly distinguish mocked tests from Meta test-account execution. Never claim approval, live delivery, production readiness, or deployment without direct evidence.

## 14. Authoritative references

- https://developers.facebook.com/docs/whatsapp/cloud-api/
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- https://developers.facebook.com/docs/whatsapp/embedded-signup/
