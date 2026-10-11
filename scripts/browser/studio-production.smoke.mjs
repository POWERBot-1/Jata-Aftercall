#!/usr/bin/env node
/** One-shot production HTTP smoke: starts a temporary server, checks development harness isolation, always stops it. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { existsSync } from "node:fs";

if (!existsSync(".next/BUILD_ID")) { console.error("Production build missing. Smoke NOT RUN."); process.exit(2); }
const require = createRequire(import.meta.url);
const socket = net.createServer();
await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "0.0.0.0", resolve); });
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "0.0.0.0", "-p", String(port)], {
  env: { ...process.env, NODE_ENV: "production", ARENA_LIVE_PREVIEW: "1", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
const stopped = new Promise((resolve) => server.once("exit", resolve));
let failed = 0, passed = 0;
function check(name, ok) { if (ok) passed += 1; else failed += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); }
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Production server startup timeout")), 60000);
    timeout.unref();
    const data = (chunk) => {
      log = (log + String(chunk)).slice(-8000);
      if (/Ready in/.test(log)) { clearTimeout(timeout); resolve(); }
    };
    server.stdout.on("data", data); server.stderr.on("data", data);
    server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Production server exited ${code}`)); });
  });
  for (const path of ["/dev/motion-preview?preference=immersive", "/dev/immersive-preview"]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(20000) });
    const html = await response.text();
    check(`${path}: production returns 404`, response.status === 404);
    check(`${path}: no fixture storefront/canvas data in response HTML`, !html.includes("Fresh coastal dishes") && !html.includes("data-motion-recipe") && !html.includes('<canvas'));
    check(`${path}: production DENY survives ARENA_LIVE_PREVIEW=1`, response.headers.get("x-frame-options") === "DENY");
  }
} catch (error) {
  check(`smoke executed (${String(error.message || error)})`, false);
} finally {
  server.kill("SIGTERM");
  const killTimeout = setTimeout(() => server.kill("SIGKILL"), 5000);
  killTimeout.unref();
  await stopped;
  clearTimeout(killTimeout);
}
console.log(`${passed} passed, ${failed} failed, 0 skipped. Temporary server stopped. Not a deployment/database/provider check.`);
process.exit(failed ? 1 : 0);
