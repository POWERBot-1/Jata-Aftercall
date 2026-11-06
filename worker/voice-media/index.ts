/**
 * Voice media worker entry point — runs as its own persistent process (Docker/Fly/VPS),
 * never inside Vercel HTTP functions.
 *
 * Environment:
 *   VOICE_MEDIA_PORT     — listen port (default 8787; health server included)
 *   VOICE_MEDIA_STREAM_URL — public wss:// URL Telnyx should connect to (…/media)
 *   TELNYX_* / VOICE_*   — readiness and control (see lib/telnyx/voice-readiness.ts)
 */
import { startVoiceMediaWorker } from "./server";

async function main(): Promise<void> {
  const port = Number(process.env.VOICE_MEDIA_PORT ?? 8787);
  const handle = await startVoiceMediaWorker(Number.isFinite(port) && port > 0 ? port : 8787);
  console.log(
    JSON.stringify({
      service: "jata-voice-media-worker",
      listening: `0.0.0.0:${handle.port}`,
      healthz: `http://0.0.0.0:${handle.port}/healthz`,
      mediaPath: "/media",
    }),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ service: "jata-voice-media-worker", signal }));
    await handle.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error(JSON.stringify({ service: "jata-voice-media-worker", fatal: true, error: String(error) }));
  process.exit(1);
});
