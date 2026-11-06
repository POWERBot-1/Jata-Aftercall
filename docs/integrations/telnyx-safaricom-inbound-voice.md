# JATA AFTERCALL — Safaricom inbound AI receptionist

**Status: SOFTWARE PIPELINE IMPLEMENTED AND LOCALLY TESTED — NOT LIVE / NOT CUSTOMER-SELLABLE.
Provider connection, carrier forwarding and handset acceptance remain blocked on external
approvals; no live call has been placed or received by this system.**

Public business number supplied by the owner: **0724317010**  
E.164 form: **+254724317010**  
Current carrier: **Safaricom Kenya**  
Preferred public identity: retain the existing Safaricom number.

## Target call path

Safaricom caller → +254724317010 → owner-approved call forwarding → Telnyx inbound DID → signed Call Control webhook → tenant/number resolver → JATA Front Desk engine → streaming speech pipeline → caller.

Do not port the Safaricom number as the default route. Porting can affect the SIM's existing voice, SMS, M-Pesa and WhatsApp identity. First obtain Safaricom's written confirmation of supported forwarding to the selected destination, billing, caller-ID presentation and service coexistence.

## Implemented in this change (software only — no provider connection)

- Server-only Ed25519 webhook verifier using the exact raw body and Telnyx timestamp/signature headers, with a five-minute replay window.
- Voice webhook ingress endpoint with the full contract: **401** invalid/missing signature (fail-closed), **400** unparseable body, **503** persistence/processing failure (safe — ingest is idempotent and the provider may redeliver), **202** otherwise (including recorded tenant rejections).
- Durable call-event pipeline: every provider event persisted exactly once (`providerEventId` unique), called-DID → business routing with Kenya number canonicalisation, unknown-number and cross-tenant rejection, monotonic call-state transitions (terminal states absorbing), RETRY recording and oldest-first recovery sweep.
- Telnyx Call Control client: authenticated answer / media-stream start / transfer / hangup commands recorded under a unique dedupe key **before** any network I/O (a command is never issued twice), capped-exponential retry for 5xx/network failures, terminal 4xx handling, provider "already in state" recorded as a no-op.
- Persistent bidirectional media worker (`worker/voice-media/`, own container + `/healthz`, **not** a Vercel function): per-call WebSocket sessions with strict message ordering, tenant binding from the durable call row (unknown `call_control_id` is refused), VAD silence detection with pre-roll, barge-in playout clear, idle prompts, call-duration cap, and deterministic session cleanup on stop/socket drop.
- Bilingual (English/Kiswahili) assistant turns with explicit caller-driven language switching, deterministic rule-based replies plus an optional injected LLM port, and speech provider adapters selected by `VOICE_AI_PROVIDER` (loopback for tests; an HTTP reference adapter is implemented but inert without an approved provider key — fail-closed when unconfigured).
- Human handoff to the owner-configured business number with bounded retries and convergence on fallback-to-agent or prompt termination for busy/unavailable/outage/no-number outcomes; the caller hears an acknowledgement before the transfer attempt.
- Usage metering (one row per call — duplicate billing structurally impossible; duration from real timestamps; provider cost only when the provider reports it), pure reconciliation report (entitlement, outage, duplicate, provider-mismatch detection), concurrency/spend/kill-switch answer gates, and a source-level guard test proving metering never writes Payment rows.
- Automated evidence: 93 voice tests across 10 suites (signature, readiness, webhook route contract, call events/tenant routing, call control, lifecycle/metering/reconciliation, handoff/bilingual speech, audio/VAD, media-worker WebSocket sessions, full journey integration) — all green locally; CI runs them via `.github/workflows/telnyx-voice-verify.yml` and the migration is authorized in `tests/unit/repair-guards.test.ts` (additive-only, CREATE TABLE/INDEX only).

**No call is answered, transferred, streamed or billed against a real provider by this code until the readiness gates below are satisfied by real configuration and evidence.** The webhook fails closed without `TELNYX_PUBLIC_KEY`; the media worker refuses sessions without an approved speech provider; answers require `TELNYX_*` configuration **and** `TELNYX_VOICE_LIVE_VERIFIED=true` **and** `VOICE_CALLS_ENABLED=true`; customer billing additionally requires `VOICE_CUSTOMER_BILLING_ENABLED=true`.

## Required before enabling live routing

1. Obtain Telnyx written Kenya-specific quote and KYC/number eligibility confirmation. — **BLOCKED (external)**
2. Provision an inbound Telnyx DID and configure a dedicated Voice API / Call Control application. — **BLOCKED (external)**
3. Configure TELNYX_PUBLIC_KEY and the remaining `TELNYX_*` / `VOICE_*` secrets in the deployment secret store; never commit them or paste them into chat. — **operator step**
4. ~~Implement durable webhook event idempotency, persistence, retries and tenant-safe DID mapping.~~ — **DONE (implemented and tested in this change)**
5. ~~Implement signed Call Control commands with idempotency and strict call-state handling.~~ — **DONE (implemented and tested in this change)**
6. ~~Implement the real-time media WebSocket service outside a standard Next.js request handler.~~ — **DONE (worker + container + health check implemented and tested; hosting instance still needs an approved always-on host — see `voice-media-worker-deployment.md`)**
7. Connect approved streaming STT/TTS (EN/KiSwahili) with consent/recording controls. — **adapters + switching + failure handling DONE; approved provider connection PENDING (keys/provider approval)**
8. ~~Add per-business usage metering, spend caps, concurrency limits and kill switches.~~ — **DONE (implemented and tested; customer billing stays disabled until gate 10)**
9. Test calls from ordinary Safaricom and Airtel mobile numbers (caller ID, latency, audio, barge-in, silence, hangup, transfer, retries, provider failure). — **BLOCKED (external: DID + forwarding approval + handsets); harness and evidence table ready in `voice-handset-acceptance.md`**
10. Only after all evidence passes: enable the Voice plan for checkout and activate Safaricom forwarding from the owner's handset. — **GATED in code (`canSell`); not executed**

## Safaricom forwarding safety

No forwarding code has been dialled and no SIM settings have been changed. Do not enable unconditional forwarding until the Telnyx destination is provisioned and tested. Prefer a controlled no-answer or busy-only forwarding pilot first, if Safaricom confirms support and charges. Keep a verified rollback instruction ready before any carrier change.

## Environment variables

- TELNYX_PUBLIC_KEY: Telnyx webhook signing public key (base64). Required for signature verification.
- Telnyx API credentials must be added only after an approved secret-management and spend-control review. Never store them in source control.
- Do not set a production voice-enable flag until all gates above are complete.

## Release evidence

Evidence below records only what was actually executed. "Tested" means the automated suites
named in this file ran and passed; it never means a provider-connected call worked.

| Gate | Status |
|---|---|
| Existing Safaricom number and carrier identified by owner | PASS |
| Webhook signature verification (Ed25519, raw body, replay window) | PASS — unit suite green locally; CI rerun tracked on PR #81 |
| Durable call-event persistence + provider-event idempotency | PASS (automated) — `voice-call-events` + route contract + e2e journey |
| Called-DID → tenant routing; unknown/cross-tenant rejection | PASS (automated) — unit + e2e (reject reasons asserted) |
| Call-state ordering, duplicate/delayed/out-of-order webhooks | PASS (automated) — monotonic transition + replay tests |
| Telnyx Call Control commands (answer/transfer/hangup, retry, dedupe) | PASS (automated, fake transport) — `voice-call-control` |
| Persistent bidirectional media WebSocket worker + health check | PASS (automated, real WebSocket) — `voice-media-server` (7 sessions incl. refusal paths, cleanup) |
| Bilingual EN/KiSwahili speech loop, language switch, barge-in, silence | PASS (automated, loopback provider) — `voice-handoff-speech`, `voice-audio-vad`, e2e |
| Human handoff: success, busy/unavailable, outage fallback, no-number | PASS (automated) — ack spoken first, bounded retries, explicit termination |
| Retry/recovery of persisted-but-failed events | PASS (automated) — `recoverVoiceEvents` sweep test |
| Usage metering, spend/concurrency/kill-switch gates, reconciliation | PASS (automated) — one-row-per-call guard + reconciliation report; no Payment writes (source guard) |
| Customer billing enablement (`VOICE_CUSTOMER_BILLING_ENABLED`) | NOT ENABLED — gated in code until live evidence exists |
| Telnyx account / Kenyan DID eligibility | BLOCKED — provider confirmation pending |
| Approved always-on host for the media worker | BLOCKED — deployment package ready (`voice-media-worker-deployment.md`) |
| Approved STT/TTS provider connection | PENDING — adapters behind `VOICE_AI_PROVIDER` readiness gate; no provider key approved |
| Safaricom forwarding change | NOT EXECUTED — owner approval + written provider confirmation required |
| Safaricom handset acceptance (caller ID, audio, latency, transfer…) | NOT TESTED — BLOCKED (external); harness + empty evidence table in `voice-handset-acceptance.md` |
| Airtel handset acceptance | NOT TESTED — BLOCKED (external); same harness |
| End-to-end live inbound call | NOT TESTED — no provider connection exists |

**Release rule:** unavailable for customer purchase until every required gate has verifiable evidence. A successful webhook signature test is not evidence of a working telephone receptionist.
