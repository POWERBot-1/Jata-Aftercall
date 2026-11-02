import { NextResponse } from "next/server";
import { decideFixtureRequest, type FixtureRequest } from "@/lib/autopilot/fixtures/autopilotFixtureDecide";
import { buildFixtureOverview } from "@/lib/autopilot/fixtures/autopilotFixtureModel";
import { getFixtureSession, saveFixtureSession } from "@/lib/autopilot/fixtures/autopilotFixtureSessions";

/**
 * FICTIONAL Autopilot fixture endpoint (development and test only; 404 in production).
 *
 * Accepts only { action, sessionId, ... }. Fixture state is held on the server; any `state`
 * field sent by the client is ignored. Decisions run the real policy functions.
 * No database, provider, message or payment is touched.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON", error: "Invalid JSON body." }, { status: 400 });
  }
  const state = getFixtureSession(body.sessionId);
  if (!state) {
    return NextResponse.json({ ok: false, code: "FIXTURE_SESSION_NOT_FOUND", error: "Fixture session not found." }, { status: 404 });
  }
  const businessId = typeof body.businessId === "string" ? body.businessId : "";

  if (body.action === "OVERVIEW") {
    if (businessId !== state.activeBusinessId) {
      return NextResponse.json({ ok: false, code: "TENANT_FORBIDDEN", error: "You are not a member of this business." }, { status: 403 });
    }
    return NextResponse.json(buildFixtureOverview(state, businessId));
  }

  if (body.action === "REQUEST") {
    const result = decideFixtureRequest({ state, request: body.request as FixtureRequest }, new Date());
    if (typeof body.sessionId === "string") saveFixtureSession(body.sessionId, result.state);
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ ok: false, code: "UNKNOWN_ACTION", error: "Unknown fixture action." }, { status: 400 });
}
