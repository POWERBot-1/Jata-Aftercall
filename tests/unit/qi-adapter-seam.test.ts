/**
 * JATA Qi adapter seam — mocked contract tests (owner directive 2026-10-27, Phase 4).
 *
 * There is deliberately no live Qi runtime in this build (packages not published publicly; Qi has
 * no HTTP surface; no credentials exist here). These tests pin the T-03 ingress behaviour the
 * future owner-approved runtime must satisfy, against an injected mock transport: fail-closed
 * defaults, credential boundary, tenant pinning, default-deny capabilities, envelope validation,
 * idempotency/correlation propagation, and secret hygiene. Every result is labelled as seam-level
 * evidence — none of it proves a live Qi deployment.
 */
import { describe, expect, it, vi } from "vitest";
import { enqueueQiWork } from "@/lib/qi/client";
import { redactQiConfig, resolveQiConfig, scrubQiSecret } from "@/lib/qi/config";
import type { QiPrincipal, QiTransport, QiWorkEnvelope } from "@/lib/qi/types";

const SECRET = "jataqi-secret-token-value-9f3a";
const TENANT = "biz-demo-0001";
const CAPABILITY = "agent.react.run";

function mockTransport(): QiTransport & { calls: Array<{ principal: QiPrincipal; envelope: QiWorkEnvelope }> } {
  const calls: Array<{ principal: QiPrincipal; envelope: QiWorkEnvelope }> = [];
  return {
    id: "mock-qi-transport",
    calls,
    enqueue: vi.fn(async (principal: QiPrincipal, envelope: QiWorkEnvelope) => {
      calls.push({ principal, envelope });
      return { reference: `qi-work-${envelope.idempotencyKey}`, durable: true };
    }),
  };
}

const validInput = {
  tenantId: TENANT,
  capability: CAPABILITY,
  payload: { task: "aftercall-summary", locale: "sw-KE" },
  idempotencyKey: "idem-20261027-0001",
  correlationId: "corr-abc-123",
};

const configured = {
  config: { authMode: "static-token", environment: "sandbox", hasToken: true } as const,
  grants: { [TENANT]: [CAPABILITY] } as const,
};

describe("Qi seam — fail-closed defaults", () => {
  it("is unavailable/not_configured when no Qi configuration exists at all", async () => {
    const result = await enqueueQiWork(validInput, { config: { authMode: "none", environment: "sandbox", hasToken: false } });
    expect(result).toMatchObject({ status: "unavailable", code: "not_configured" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("keeps failing closed in explicit none mode even with a token and transport present", async () => {
    const transport = mockTransport();
    const result = await enqueueQiWork(validInput, {
      config: { authMode: "none", environment: "production", hasToken: true },
      grants: configured.grants,
      transport,
    });
    expect(result).toMatchObject({ status: "unavailable", code: "not_configured" });
    expect(transport.calls).toHaveLength(0);
  });

  it("refuses static-token/oidc modes when the server-side credential is absent", async () => {
    for (const authMode of ["static-token", "oidc"] as const) {
      const result = await enqueueQiWork(validInput, {
        config: { authMode, environment: "sandbox", hasToken: false },
        grants: configured.grants,
        transport: mockTransport(),
      });
      expect(result).toMatchObject({ status: "unavailable", code: "missing_credential" });
    }
  });

  it("reports transport_failed honestly when no runtime is registered, never a fake success", async () => {
    const result = await enqueueQiWork(validInput, { ...configured, transport: null });
    expect(result).toMatchObject({ status: "unavailable", code: "transport_failed" });
    const implicit = await enqueueQiWork(validInput, { ...configured });
    expect(implicit).toMatchObject({ status: "unavailable", code: "transport_failed" });
  });
});

describe("Qi seam — principal boundary and default-deny", () => {
  it("rejects a tenant the credential has no relationship with before touching the transport", async () => {
    const transport = mockTransport();
    const result = await enqueueQiWork({ ...validInput, tenantId: "biz-stranger-9999" }, { ...configured, transport });
    expect(result).toMatchObject({ status: "rejected", code: "tenant_mismatch" });
    expect(transport.calls).toHaveLength(0);
  });

  it("denies a capability the tenant was not explicitly granted", async () => {
    const transport = mockTransport();
    const result = await enqueueQiWork({ ...validInput, capability: "kernel.admin.exec" }, { ...configured, transport });
    expect(result).toMatchObject({ status: "rejected", code: "capability_denied" });
    expect(transport.calls).toHaveLength(0);
  });

  it("treats an empty grants map as default-deny for every tenant", async () => {
    const result = await enqueueQiWork(validInput, { ...configured, grants: {} });
    expect(result).toMatchObject({ status: "rejected", code: "tenant_mismatch" });
  });
});

describe("Qi seam — envelope validation", () => {
  it.each([
    [{ tenantId: "bad tenant!" }, "invalid_input"],
    [{ tenantId: "" }, "invalid_input"],
    [{ capability: "UPPER-CASE" }, "invalid_input"],
    [{ capability: "" }, "invalid_input"],
    [{ idempotencyKey: "short" }, "invalid_input"],
    [{ idempotencyKey: "x".repeat(101) }, "invalid_input"],
    [{ correlationId: "has spaces" }, "invalid_input"],
  ])("rejects %j with invalid_input", async (patch, code) => {
    const transport = mockTransport();
    const result = await enqueueQiWork({ ...validInput, ...patch } as any, { ...configured, transport });
    expect(result).toMatchObject({ status: "rejected", code });
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects payloads that cannot survive durable JSON serialisation", async () => {
    const transport = mockTransport();
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    for (const payload of [{ fn: () => 1 }, { big: BigInt(10) }, circular]) {
      const result = await enqueueQiWork({ ...validInput, payload }, { ...configured, transport });
      expect(result).toMatchObject({ status: "rejected", code: "invalid_input" });
    }
    expect(transport.calls).toHaveLength(0);
  });
});

describe("Qi seam — successful mocked dispatch", () => {
  it("enqueues through the transport with a narrow, tenant-pinned principal and full envelope", async () => {
    const transport = mockTransport();
    const fixedNow = new Date("2026-10-27T07:30:00.000Z");
    const result = await enqueueQiWork(validInput, { ...configured, transport, now: () => fixedNow });

    expect(result).toMatchObject({
      status: "enqueued",
      reference: "qi-work-idem-20261027-0001",
      durable: true,
      transportId: "mock-qi-transport",
    });
    expect(transport.calls).toHaveLength(1);
    const { principal, envelope } = transport.calls[0];
    expect(principal).toEqual({
      tenantId: TENANT,
      capabilities: [CAPABILITY],
      authMode: "static-token",
      environment: "sandbox",
    });
    expect(envelope).toMatchObject({
      tenantId: TENANT,
      capability: CAPABILITY,
      payload: validInput.payload,
      idempotencyKey: validInput.idempotencyKey,
      correlationId: validInput.correlationId,
      requestedAt: "2026-10-27T07:30:00.000Z",
    });
    // The credential value never crosses the seam into principal, envelope or result.
    expect(JSON.stringify({ principal, envelope, result })).not.toContain(SECRET);
  });

  it("supports the test-only auth mode and omits correlationId when none is supplied", async () => {
    const transport = mockTransport();
    const { correlationId: _omit, ...withoutCorrelation } = validInput;
    const result = await enqueueQiWork(withoutCorrelation, {
      config: { authMode: "test-only", environment: "sandbox", hasToken: false },
      grants: configured.grants,
      transport,
    });
    expect(result.status).toBe("enqueued");
    expect(transport.calls[0].principal.authMode).toBe("test-only");
    expect(transport.calls[0].envelope).not.toHaveProperty("correlationId");
  });

  it("surfaces a transport throw or empty reference as unavailable/transport_failed", async () => {
    const throwing: QiTransport = {
      id: "broken",
      enqueue: async () => {
        throw new Error(`runtime refused work token=${SECRET}`);
      },
    };
    const thrown = await enqueueQiWork(validInput, { ...configured, transport: throwing });
    expect(thrown).toMatchObject({ status: "unavailable", code: "transport_failed" });
    expect(JSON.stringify(thrown)).not.toContain(SECRET);

    const empty: QiTransport = { id: "empty", enqueue: async () => ({ reference: "", durable: true }) };
    const blank = await enqueueQiWork(validInput, { ...configured, transport: empty });
    expect(blank).toMatchObject({ status: "unavailable", code: "transport_failed" });
  });
});

describe("Qi seam — configuration and secret hygiene", () => {
  it("resolves env configuration with none/sandbox as the safe defaults and ignores unknown modes", () => {
    const empty = resolveQiConfig({} as NodeJS.ProcessEnv);
    expect(empty).toEqual({ authMode: "none", environment: "sandbox", hasToken: false });
    expect(empty).not.toHaveProperty("token");

    const configured = resolveQiConfig({
      JATAQI_AUTH_MODE: "static-token",
      JATAQI_AUTH_TOKEN: ` ${SECRET} `,
      JATAQI_ENV: "production",
    } as unknown as NodeJS.ProcessEnv);
    expect(configured).toEqual({ authMode: "static-token", environment: "production", hasToken: true, token: SECRET });

    const bogus = resolveQiConfig({ JATAQI_AUTH_MODE: "made-up", JATAQI_AUTH_TOKEN: " " } as unknown as NodeJS.ProcessEnv);
    expect(bogus).toEqual({ authMode: "none", environment: "sandbox", hasToken: false });
    expect(bogus).not.toHaveProperty("token");
  });

  it("redacts configuration to booleans and scrubs credential-shaped text from messages", () => {
    const redacted = redactQiConfig({ authMode: "static-token", environment: "production", hasToken: true, token: SECRET });
    expect(redacted).toEqual({ authMode: "static-token", environment: "production", hasToken: true });
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    const scrubbed = scrubQiSecret(`failure: JATAQI_AUTH_TOKEN=${SECRET} and Bearer ${SECRET}`);
    expect(scrubbed).not.toContain(SECRET);
    expect(scrubbed).toContain("[redacted-qi-credential]");
    // Value-based second layer catches leaks in shapes no pattern anticipated.
    const oddShape = scrubQiSecret(`runtime dumped ${SECRET} mid-sentence`, SECRET);
    expect(oddShape).not.toContain(SECRET);
  });
});
