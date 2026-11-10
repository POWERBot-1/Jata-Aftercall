# Voice media worker — production deployment (§Voice deliverable 3)

**Status: DEPLOYMENT PACKAGE READY — actual hosting instance awaits the approved
always-on host and provider credentials (external facilitation).**

The real-time audio worker is a **persistent WebSocket/media process**. Vercel HTTP
functions cannot host it (request-scoped, no long-lived sockets) — this is why it ships as
its own container with health checks.

## What ships

| Artifact | Purpose |
|---|---|
| `worker/voice-media/index.ts` | Process entry: port, health, graceful SIGTERM/SIGINT |
| `worker/voice-media/server.ts` | `WS /media` (Telnyx media ingress) + `GET /healthz` |
| `worker/voice-media/session.ts` | Per-call session: VAD, barge-in, speech loop, limits, cleanup |
| `Dockerfile.voice-media-worker` | Node 22 image with `HEALTHCHECK` against `/healthz` |
| `docker-compose.voice-worker.yml` | Reference orchestration (restart policy + healthcheck) |
| `tests/unit/voice-media-server.test.ts` | End-to-end worker test over a real WebSocket |

## Configuration (secret-management only — never committed)

| Variable | Meaning |
|---|---|
| `VOICE_MEDIA_PORT` | Listen port (default 8787; must match platform exposure) |
| `VOICE_MEDIA_STREAM_URL` | Public `wss://…/media` URL Telnyx connects to (set in the Next app env too) |
| `VOICE_MEDIA_STREAM_TOKEN` | Shared secret for the media handshake (set in the Next app + worker). The webhook mints a per-call HMAC token into the stream URL; the worker recomputes and verifies it in constant time before any session starts. **Without it the worker refuses every connection and readiness keeps Voice unsellable.** |
| `TELNYX_PUBLIC_KEY` / `TELNYX_API_KEY` / `TELNYX_CONNECTION_ID` / `TELNYX_PHONE_NUMBER` | Provider gates (Next app + command client) |
| `VOICE_AI_PROVIDER` | `loopback` (tests) or approved provider id (`openai` reference adapter) |
| `OPENAI_API_KEY` (or approved provider key) | Speech synthesis/recognition — approved provider only |
| `VOICE_KILL_SWITCH` | `true` refuses every answer deployment-wide |
| `VOICE_CONCURRENT_CALLS_LIMIT` / `VOICE_DAILY_SPEND_LIMIT_MINOR` | Hard caps (defaults: 2; spend cap binds when provider cost data exists) |
| `VOICE_CALLS_ENABLED` / `TELNYX_VOICE_LIVE_VERIFIED` / `VOICE_CUSTOMER_BILLING_ENABLED` | Readiness gates (`lib/telnyx/voice-readiness.ts`) |

## Platform steps (run on the approved host)

1. Provision the always-on host (owner-approved provider; not purchased by engineering).
2. `docker build -f Dockerfile.voice-media-worker -t jata-voice-media .`
3. Provide env via the platform secret store; expose port `VOICE_MEDIA_PORT`.
4. Publish a public `wss://<host>/media` URL → set `VOICE_MEDIA_STREAM_URL` in **both**
   worker and Next app environments, and set the same `VOICE_MEDIA_STREAM_TOKEN` secret in
   both (per-call HMAC handshake authentication).
5. Point the health probe at `GET /healthz` (30 s interval, 3-failure kill) — matches the
   Dockerfile `HEALTHCHECK`.
6. Confirm `{"ok":true,"speechProvider":…,"callsEnabled":…}` before enabling any Telnyx
   media streaming on live calls.

## Failure behaviour

- Missing/invalid `VOICE_MEDIA_STREAM_TOKEN` handshake (missing token, wrong token, or no
  secret configured) → socket closed with 1008 before any session starts (fail closed).
- `start` frame naming a different call than the handshake authenticated → refused with `CALL_ID_MISMATCH`.
- Missing speech provider → sessions are refused with `SPEECH_PROVIDER_UNAVAILABLE` (fail closed).
- Unknown `call_control_id` (media arrives without a durable call row) → refused with `UNKNOWN_CALL`.
- `call_control_id` already terminal (COMPLETED/FAILED) → refused with `CALL_ALREADY_ENDED`.
- Process death → platform restart policy + healthcheck; in-flight calls drop and the
  provider's hangup events still finalize metering on the app side.
- Kill switch/readiness gates are re-evaluated per call at the application layer, so a
  live-but-disabled deployment cannot answer.
