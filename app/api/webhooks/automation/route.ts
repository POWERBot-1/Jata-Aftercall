import { NextRequest, NextResponse } from "next/server";
import { validateAutomationEvent, verifyAutomationSignature } from "@/lib/automation/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated event ingress for n8n callbacks. This endpoint intentionally exposes no business-data API. */
export async function POST(request: NextRequest) {
  const secret = process.env.JATA_AUTOMATION_HMAC_SECRET ?? "";
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  if (!verifyAutomationSignature(raw, request.headers.get("x-jata-signature"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!validateAutomationEvent(payload)) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  // Acknowledgement only: consumers must perform authorised product actions through existing APIs.
  return NextResponse.json({ accepted: true, eventId: payload.id }, { status: 202 });
}
