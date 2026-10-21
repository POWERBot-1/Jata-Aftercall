import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  evaluateHealth,
  evaluateHomepage,
  evaluateStorefront,
  runSmoke,
} from "../ci/smoke-production.mjs";

// The production smoke script is tested against a local fixture server, never
// against production. Every failure mode below is exercised for real over HTTP.

const HTML = "<!DOCTYPE html><html><head><title>t</title></head><body>ok</body></html>";

let server;
let baseUrl;
let routes = {};

before(async () => {
  server = createServer((req, res) => {
    const handler = routes[req.url];
    if (!handler) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    handler(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const html = (res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(HTML); };
const json = (body) => (res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

test("PASS: a healthy deployment passes every check", async () => {
  routes = { "/": html, "/health": json({ status: "ok", db: "up", version: "1.0.0" }) };
  const { exitCode, results } = await runSmoke({ baseUrl, log: () => {} });
  assert.equal(exitCode, 0, JSON.stringify(results));
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok));
});

test("FAIL: a 500 homepage fails the smoke", async () => {
  routes = { "/": (res) => { res.writeHead(500); res.end("boom"); }, "/health": json({ status: "ok", db: "up" }) };
  const { exitCode, results } = await runSmoke({ baseUrl, log: () => {} });
  assert.equal(exitCode, 1);
  assert.equal(results.find((r) => r.name === "homepage").ok, false);
});

test("FAIL: db:unconfigured is a failure, not a pass", async () => {
  routes = { "/": html, "/health": json({ status: "degraded", db: "unconfigured" }) };
  const { exitCode, results } = await runSmoke({ baseUrl, log: () => {} });
  assert.equal(exitCode, 1);
  const health = results.find((r) => r.name === "health");
  assert.equal(health.ok, false);
  assert.match(health.reason, /offline stub/);
});

test("FAIL: db:down is a failure", async () => {
  routes = { "/": html, "/health": json({ status: "degraded", db: "down" }) };
  const { exitCode } = await runSmoke({ baseUrl, log: () => {} });
  assert.equal(exitCode, 1);
});

test("PASS: an optional storefront is checked when configured", async () => {
  routes = { "/": html, "/health": json({ status: "ok", db: "up" }), "/b/acme": html };
  const { exitCode, results } = await runSmoke({ baseUrl, slug: "acme", log: () => {} });
  assert.equal(exitCode, 0);
  assert.equal(results.length, 3);
});

test("FAIL: a missing storefront fails when one was configured", async () => {
  routes = { "/": html, "/health": json({ status: "ok", db: "up" }) };
  const { exitCode, results } = await runSmoke({ baseUrl, slug: "does-not-exist", log: () => {} });
  assert.equal(exitCode, 1);
  assert.equal(results.find((r) => r.name.startsWith("storefront")).ok, false);
});

test("BLOCKED: no base URL is exit 2, never 0", async () => {
  const { exitCode, error } = await runSmoke({ baseUrl: "", log: () => {} });
  assert.equal(exitCode, 2);
  assert.match(error, /no base URL/);
});

test("BLOCKED: an unreachable deployment is exit 2, distinct from a failed check", async () => {
  const { exitCode, error } = await runSmoke({ baseUrl: "http://127.0.0.1:1", timeoutMs: 800, attempts: 1, log: () => {} });
  assert.equal(exitCode, 2);
  assert.match(error, /could not be reached/);
});

test("evaluateHomepage rejects an empty or non-HTML body", () => {
  assert.equal(evaluateHomepage({ status: 200, body: "" }).ok, false);
  assert.equal(evaluateHomepage({ status: 200, body: '{"json":true}' }).ok, false);
  assert.equal(evaluateHomepage({ status: 200, body: HTML }).ok, true);
});

test("evaluateHealth rejects non-JSON and missing fields", () => {
  assert.equal(evaluateHealth({ status: 200, body: "not json" }).ok, false);
  assert.equal(evaluateHealth({ status: 200, body: "{}" }).ok, false);
  assert.equal(evaluateHealth({ status: 200, body: '{"db":"up"}' }).ok, false, "status must be ok");
});

test("evaluateStorefront requires HTML", () => {
  assert.equal(evaluateStorefront({ status: 200, body: HTML }).ok, true);
  assert.equal(evaluateStorefront({ status: 404, body: HTML }).ok, false);
});

import { readFileSync } from "node:fs";

test("Vercel SSO HTML login challenge on /health fails cleanly rather than passing", () => {
  const ssoHtml = "<!doctype html><html><head><title>Protected Deployment – Vercel</title></head><body><h1>Log in to Vercel</h1></body></html>";
  const res = evaluateHealth({ status: 200, body: ssoHtml });
  assert.equal(res.ok, false);
  assert.match(res.reason, /not JSON/);
});

test("production-smoke.yml targets canonical production domain rather than SSO-protected per-deployment URL", () => {
  const wf = readFileSync(".github/workflows/production-smoke.yml", "utf8");
  assert.match(wf, /CONFIGURED_PRODUCTION_URL:-https:\/\/jata-aftercall\.vercel\.app/);
  assert.equal(/BASE="\$\{\{\s*github\.event\.deployment_status\.environment_url\s*\}\}"/.test(wf), false);
});
