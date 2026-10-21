import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runSmoke } from "../ci/smoke-production.mjs";

// The existing smoke tests exercise the pure evaluators. They cannot catch a
// defect in `runSmoke` itself — a wrong URL, a wrong fetch option, a swallowed
// status. These start a real HTTP server on loopback and drive the same code
// path the workflow drives, so the loop is closed without touching production.
//
// The fixture answers exactly as `app/health/route.ts` does: {status, db,
// version, timestamp}. An earlier hand-written fixture omitted `status` and the
// smoke correctly failed it — which is the behaviour these tests lock in.

function startFixture(healthBody) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method !== "GET") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><html><body>fixture</body></html>");
        return;
      }
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(healthBody));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const silent = () => {};

test("a healthy endpoint passes every read-only check", async () => {
  const { server, port } = await startFixture({
    status: "ok",
    db: "up",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
  try {
    const result = await runSmoke({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 5000, log: silent });
    assert.equal(result.exitCode, 0, JSON.stringify(result.results));
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((row) => row.ok));
  } finally {
    server.close();
  }
});

test("db:unconfigured is a FAIL, never a pass", async () => {
  const { server, port } = await startFixture({
    status: "degraded",
    db: "unconfigured",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
  try {
    const result = await runSmoke({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 5000, log: silent });
    assert.equal(result.exitCode, 1, "an unconfigured database must not read as healthy");
    const health = result.results.find((row) => row.name === "health");
    assert.equal(health.ok, false);
    assert.match(health.reason, /unconfigured/);
  } finally {
    server.close();
  }
});

test("status:ok with db:down still fails — both fields are required", async () => {
  const { server, port } = await startFixture({
    status: "ok",
    db: "down",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
  try {
    const result = await runSmoke({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 5000, log: silent });
    assert.equal(result.exitCode, 1);
    const health = result.results.find((row) => row.name === "health");
    assert.match(health.reason, /db:down/);
  } finally {
    server.close();
  }
});

test("an unreachable target is BLOCKED (2), not FAIL and not PASS", async () => {
  // Port 1 is reserved and nothing listens there. Retries are kept at 1 so the
  // test does not wait for the production retry backoff.
  const result = await runSmoke({ baseUrl: "http://127.0.0.1:1", timeoutMs: 1500, attempts: 1, log: silent });
  assert.equal(result.exitCode, 2, "an unreachable deployment must be BLOCKED");
  assert.ok(result.error, "a BLOCKED result must explain itself");
});

test("every request the smoke makes is a GET", async () => {
  const methods = [];
  const { server, port } = await startFixture({
    status: "ok",
    db: "up",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
  const original = server.listeners("request")[0];
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    methods.push(req.method);
    original(req, res);
  });
  try {
    await runSmoke({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 5000, log: silent });
    assert.deepEqual([...new Set(methods)], ["GET"], `observed methods: ${methods.join(", ")}`);
  } finally {
    server.close();
  }
});
