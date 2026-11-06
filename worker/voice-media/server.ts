/**
 * Voice media worker HTTP/WebSocket server (§Voice deliverable 3 — transport layer).
 *
 * A single Node process owns:
 * - `WS /media` — Telnyx media-streaming ingress (Telnyx connects out to the configured
 *   VOICE_MEDIA_STREAM_URL; this process must therefore run OUTSIDE Vercel HTTP functions).
 * - `GET /healthz` — liveness/readiness for the deployment platform's health checks.
 *
 * Startup is fail-closed on readiness only for CALL HANDLING: the server always serves
 * health, but every call session also consults kill switches and limits before consuming
 * provider resources.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { createPrismaVoiceEventStore, type VoiceEventStore } from "@/lib/voice/call-events";
import { getCallControlClient, signMediaStreamToken, type TelnyxCallControlClient } from "@/lib/telnyx/call-control";
import { attemptHumanHandoff, type HandoffOutcome } from "@/lib/voice/handoff";
import { resolveSpeechAdapters, type ResolvedSpeech } from "@/lib/voice/speech";
import { resolveLlmAdapter } from "@/lib/voice/llm";
import { getVoiceReadiness } from "@/lib/telnyx/voice-readiness";
import { VoiceMediaSession, type SessionConfig } from "./session";

export type WorkerDeps = {
  store?: VoiceEventStore;
  speech?: ResolvedSpeech | null;
  client?: TelnyxCallControlClient | null;
  loadContext?: (businessId: string) => Promise<{ businessName: string; facts: string[]; businessPhone: string | null }>;
  sessionConfig?: Partial<SessionConfig>;
  llm?: ((input: { system: string; prompt: string; facts: string[] }) => Promise<string | null>) | null;
  env?: Record<string, string | undefined>;
};

export type WorkerHandle = {
  port: number;
  sessions: () => number;
  close: () => Promise<void>;
};

type StartMessage = { event?: string; start?: { call_control_id?: string } };

/**
 * Start the worker on `port` (0 = ephemeral, used by tests). Returns a handle for health
 * probing and shutdown. Never throws for missing provider config — it reports readiness
 * instead, so operators can run an unbaked deployment safely.
 */
export async function startVoiceMediaWorker(port: number, deps: WorkerDeps = {}): Promise<WorkerHandle> {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const store = deps.store ?? createPrismaVoiceEventStore();
  const speech = deps.speech !== undefined ? deps.speech : resolveSpeechAdapters(env);
  const client = deps.client !== undefined ? deps.client : getCallControlClient(env);
  const loadContext = deps.loadContext ?? defaultLoadContext;

  const activeSessions = new Map<string, VoiceMediaSession>();

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz" || req.url === "/healthz/") {
      const readiness = getVoiceReadiness(env as any);
      const body = JSON.stringify({
        ok: true,
        service: "jata-voice-media-worker",
        sessions: activeSessions.size,
        speechProvider: speech?.providerId ?? null,
        callsEnabled: readiness.canReceiveCalls,
        killSwitch: env.VOICE_KILL_SWITCH === "true",
        uptimeSec: Math.floor(process.uptime()),
      });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "NOT_FOUND" }));
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/media" });

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    let session: VoiceMediaSession | null = null;
    let sessionKey = "";
    // Messages are processed strictly in arrival order: `start` performs async tenant
    // binding, and media frames that arrive during it must not be dropped on the floor.
    let queue: Promise<void> = Promise.resolve();

    const sendJson = (message: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    // Handshake authentication: every connection must present the per-call HMAC minted by
    // the webhook under the shared secret. Without the secret (either side) nothing connects
    // — fail closed, never open the media plane to unauthenticated peers.
    const secret = env.VOICE_MEDIA_STREAM_TOKEN?.trim();
    const authedCallId = (() => {
      if (!secret || !request.url) return null;
      const url = new URL(request.url, "http://media.invalid");
      const callId = url.searchParams.get("callControlId");
      const token = url.searchParams.get("token");
      if (!callId || !token) return null;
      const expected = signMediaStreamToken(secret, callId);
      const a = Buffer.from(token);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b) ? callId : null;
    })();
    if (!authedCallId) {
      socket.close(1008, "media handshake not authenticated");
      return;
    }
    const authenticatedCallId = authedCallId;

    socket.on("message", (raw: Buffer | string) => {
      queue = queue.then(async () => {
        let message: any;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const start = message as StartMessage;
        if (!session && start.event === "start" && start.start?.call_control_id) {
          // The start frame must name exactly the call the handshake was minted for.
          if (start.start.call_control_id !== authenticatedCallId) {
            sendJson({ event: "jata.refused", reason: "CALL_ID_MISMATCH" });
            socket.close(1008, "call id mismatch");
            return;
          }
          if (!speech) {
            // No approved speech provider: refuse the media session deterministically.
            sendJson({ event: "jata.refused", reason: "SPEECH_PROVIDER_UNAVAILABLE" });
            socket.close(1013, "speech provider unavailable");
            return;
          }
          const callControlId = start.start.call_control_id;
          // Tenant binding comes from the durable call row — never from the media payload.
          const call = await store.findCallByControlId(callControlId).catch(() => null);
          if (!call) {
            sendJson({ event: "jata.refused", reason: "UNKNOWN_CALL" });
            socket.close(1008, "unknown call");
            return;
          }
          if (call.state === "COMPLETED" || call.state === "FAILED") {
            sendJson({ event: "jata.refused", reason: "CALL_ALREADY_ENDED" });
            socket.close(1008, "call already ended");
            return;
          }
          sessionKey = `${callControlId}:${randomUUID()}`;
          session = new VoiceMediaSession({
            callControlId,
            businessId: call.businessId,
            language: call.language === "sw" ? "sw" : "en",
            transport: { sendJson, close: (code) => socket.close(code ?? 1000) },
            speech,
            config: deps.sessionConfig,
            loadContext: async (businessId) => loadContext(businessId),
            onHangup: async (cause) => {
              const current = await store.findCallByControlId(callControlId);
              if (current) await store.updateCall(current.id, { endedAt: new Date(), hangupCause: `media:${cause}` });
              if (client && current) await client.hangup(store, callControlId, `jata:media:${cause.slice(0, 40)}`).catch(() => undefined);
            },
            onHandoff: async ({ businessPhone }): Promise<HandoffOutcome> => {
              const current = await store.findCallByControlId(callControlId);
              if (!current) return { result: "FALLBACK_TO_AGENT", target: null, reason: "CALL_NOT_FOUND" };
              if (!client) return { result: "FALLBACK_TO_AGENT", target: businessPhone, reason: "NO_CLIENT" };
              return attemptHumanHandoff(current, { store, client, businessPhone });
            },
            onUpdateLanguage: async (language) => {
              const current = await store.findCallByControlId(callControlId);
              if (current) await store.updateCall(current.id, { language });
            },
            llm: deps.llm !== undefined ? (deps.llm || undefined) : resolveLlmAdapter(env),
          });
          activeSessions.set(sessionKey, session);
          session.handleMessage(message);
          return;
        }
        session?.handleMessage(message);
      }).catch(() => undefined);
    });

    const cleanup = () => {
      if (session) {
        void session.stop("socket_closed");
        activeSessions.delete(sessionKey);
        session = null;
      }
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "0.0.0.0", () => resolve());
  });
  const address = httpServer.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    port: boundPort,
    sessions: () => activeSessions.size,
    close: async () => {
      for (const session of activeSessions.values()) await session.stop("worker_shutdown").catch(() => undefined);
      activeSessions.clear();
      // Terminate lingering sockets first — otherwise wss.close()/http.close() wait forever.
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      });
    },
  };
}

/** Default context loader: owner-controlled business facts from the durable store. */
async function defaultLoadContext(businessId: string): Promise<{ businessName: string; facts: string[]; businessPhone: string | null }> {
  const prisma = (await import("@/lib/db")).default as any;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, phone: true, openingHours: true },
  });
  if (!business) return { businessName: "your business", facts: [], businessPhone: null };
  const facts: string[] = [`Business name: ${business.name}`];
  if (business.openingHours) facts.push(`Opening hours: ${JSON.stringify(business.openingHours)}`);
  return { businessName: business.name, facts, businessPhone: business.phone ?? null };
}
