"use client";

/**
 * Renders the REAL AutopilotCommandCenter with FICTIONAL data (development and test only;
 * the page is 404 in production). Its `/api/autopilot/*` requests are answered by the fixture
 * transport below:
 *   - reads and writes that the fixture simulates are sent to /dev/autopilot-fixture/decide
 *     with a session id and an action. The state lives on the server (see
 *     lib/autopilot/fixtures/autopilotFixtureSessions.ts), so the browser cannot send or edit
 *     state. Decisions run the real policy functions on fictional state.
 *   - anything the fixture does not simulate (command turns, ingestion, checkout, any other
 *     /api path) fails closed with 501. Nothing is sent, spent or changed.
 * Every request is logged to window.__jataAutopilotRequests for tests.
 */

import { useEffect } from "react";
import { AutopilotCommandCenter, type AutopilotOverviewPayload } from "@/components/autopilot/AutopilotCommandCenter";
import { AUTOPILOT_FIXTURE_NOTICE, type FixtureRole, type FixtureScenarioId } from "@/lib/autopilot/fixtures/autopilotFixtureModel";

type LogEntry = { method: string; path: string; status: number };
declare global {
  interface Window {
    __jataAutopilotRequests?: LogEntry[];
  }
}

const DECIDE_PATH = "/dev/autopilot-fixture/decide";
let installed = false;
/** Set by the rendered component from the server-created session. Never a state payload. */
let activeSessionId: string | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function installAutopilotFixtureTransport() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return realFetch(input, init);
    }
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const log = (status: number) => {
      window.__jataAutopilotRequests ??= [];
      window.__jataAutopilotRequests.push({ method, path: url.pathname, status });
    };
    const notSimulated = () => {
      log(501);
      return jsonResponse(501, {
        error:
          "FICTIONAL FIXTURE: this request is not simulated here (command turns, document ingestion, checkout and other endpoints). Nothing was sent, spent or changed.",
      });
    };
    if (!activeSessionId) {
      log(503);
      return jsonResponse(503, { error: "FICTIONAL FIXTURE: no fixture session. Reload the fixture page." });
    }
    const sessionId = activeSessionId;

    if (method === "GET" && url.pathname === "/api/autopilot/overview") {
      const businessId = url.searchParams.get("businessId") ?? "";
      const res = await realFetch(DECIDE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "OVERVIEW", sessionId, businessId }),
      });
      log(res.status);
      return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
    }

    let request: Record<string, unknown> | null = null;
    if (method === "PATCH" && url.pathname === "/api/autopilot/config") {
      const { businessId, ...patch } = body;
      request = { kind: "CONFIG_PATCH", businessId, patch };
    } else if (method === "POST" && url.pathname === "/api/autopilot/proposals") {
      request = {
        kind: "PROPOSE",
        businessId: body.businessId,
        candidate: {
          actionType: body.actionType,
          title: body.title,
          rationale: body.rationale,
          expectedImpact: body.expectedImpact ?? null,
          payload: body.payload ?? {},
          idempotencyKey: body.idempotencyKey,
        },
      };
    } else if (method === "PATCH" && url.pathname === "/api/autopilot/proposals") {
      request = { kind: "PROPOSAL_OP", businessId: body.businessId, proposalId: body.proposalId, operation: body.operation };
    } else if (method === "POST" && url.pathname === "/api/autopilot/consent") {
      request = {
        kind: "CONSENT_RECORD",
        businessId: body.businessId,
        channel: body.channel ?? "WHATSAPP",
        scope: body.scope ?? "TRANSACTIONAL",
        status: body.status === "OPTED_OUT" ? "OPTED_OUT" : "OPTED_IN",
        label: typeof body.displayName === "string" && body.displayName ? `FIXTURE ${body.displayName}` : "FIXTURE customer (no name)",
      };
    }

    if (!request) return notSimulated();

    const res = await realFetch(DECIDE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "REQUEST", sessionId, request }),
    });
    log(res.status);
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  };
}

// Install at module load, before the Command Center can send a request.
installAutopilotFixtureTransport();

export function AutopilotFixtureClient({
  sessionId,
  businessId,
  scenario,
  role,
  tenant,
  initialData,
}: {
  sessionId: string;
  businessId: string;
  scenario: FixtureScenarioId;
  role: FixtureRole;
  tenant: "a" | "b";
  initialData: AutopilotOverviewPayload;
}) {
  // Assigned in an effect (not during render). User-triggered requests run after mount.
  useEffect(() => {
    activeSessionId = sessionId;
  }, [sessionId]);
  return (
    <div data-autopilot-fixture="true" className="space-y-4">
      <div
        role="note"
        aria-label="Development fixture notice"
        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
      >
        {AUTOPILOT_FIXTURE_NOTICE}
        <span className="mt-1 block text-xs font-normal">
          Fixture scenario: <code>{scenario}</code> · role <code>{role}</code> · tenant{" "}
          <code>{tenant === "b" ? "B" : "A"}</code> · development only
        </span>
      </div>
      <AutopilotCommandCenter businessId={businessId} initialData={initialData} />
    </div>
  );
}

export default AutopilotFixtureClient;
