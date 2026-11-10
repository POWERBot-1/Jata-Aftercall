# Front Desk Voice — real handset acceptance (Safaricom & Airtel) (§Voice deliverable 7)

**Status: HARNESS READY — CALLS NOT EXECUTED. Actual handset results are BLOCKED on
external facilitation: an approved Telnyx inbound DID, owner-approved Safaricom
forwarding, live provider credentials and physical test phones. Nothing in this file is
a recorded result; the evidence tables are empty by design and may only be filled from
calls that actually happened.**

## What is automated today (runs in CI/local — see `tests/integration/voice-e2e.test.ts`)

- Full call lifecycle: signed webhook → durable event idempotency → tenant routing →
  answer command issuance (deduped) → media session (real WebSocket, loopback speech) →
  barge-in → language switch → human-handoff success/failure paths → hangup → usage
  finalization → reconciliation report.
- Worker behaviour: unknown-call refusal, missing-speech refusal, idle/max-duration
  termination, health endpoint.

## Manual handset matrix (execute only when the gates below are open)

**Prerequisites (all required):** Telnyx DID provisioned + connection configured ·
`TELNYX_*` secrets loaded · media worker healthy on the public `wss://…/media` URL ·
`VOICE_CALLS_ENABLED=true` after live verification · owner-approved Safaricom forwarding
(never dialed by engineering) · kill switch off · at least one Safaricom and one Airtel
SIM in ordinary handsets.

| # | Step | Safaricom (07… SIM) | Airtel (07…/01… SIM) | Record |
|---|---|---|---|---|
| 1 | Outbound caller ID shows the JATA/public number as presented by the carrier path | ☐ | ☐ | observed CLIP: ___ |
| 2 | Call answered within 5 s (measure: answer latency from ring → audio) | ☐ | ☐ | ___ ms |
| 3 | Two-way audio clear both directions ≥ 60 s | ☐ | ☐ | score 1–5 / notes |
| 4 | Caller interrupts agent speech (barge-in) → agent stops ≤ 500 ms | ☐ | ☐ | observed: ___ |
| 5 | Agent falls silent after caller silence (silence detection + idle prompt) | ☐ | ☐ | observed: ___ |
| 6 | English turn and Kiswahili turn both understood; "switch to kiswahili" works | ☐ | ☐ | transcripts |
| 7 | "agent"/"mtu" handoff rings the owner's configured number | ☐ | ☐ | result: ___ |
| 8 | Handoff to a busy/unavailable owner → caller gets fallback then clear end | ☐ | ☐ | observed: ___ |
| 9 | Caller hangs up → call row COMPLETED, usage row finalized with real duration | ☐ | ☐ | callId: ___ |
| 10 | Provider outage (simulate: stop media worker) → call terminates cleanly, no hang | ☐ | ☐ | observed: ___ |
| 11 | Webhook replay (provider redelivery) → no duplicate commands, no double usage rows | ☐ | ☐ | event ids: ___ |
| 12 | Usage reconciliation: local duration vs provider usage vs subscription period | ☐ | ☐ | report: ___ |

**Latency capture method:** worker logs session `startedAtMs` vs first media frame and
assistant turn boundaries; paste the JSON metrics line per call into the evidence table.

## Evidence table (append only real observations)

| timestamp | device/SIM | network | callId | metric | observed | pass? |
|---|---|---|---|---|---|---|
| _(empty — no handset call has been executed)_ | | | | | | |

## Sign-off

- Engineering harness: **PASS** (automated lifecycle + worker tests in CI)
- Safaricom handset run: **BLOCKED** (external: DID + forwarding approval + handset)
- Airtel handset run: **BLOCKED** (external: same)
- Customer billing enablement (`VOICE_CUSTOMER_BILLING_ENABLED`): **BLOCKED** until the
  above rows are PASS with recorded evidence — enforced by `getVoiceReadiness().canSell`.
