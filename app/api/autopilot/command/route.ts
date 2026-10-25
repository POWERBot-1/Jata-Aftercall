import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertBusinessRole, TenantError } from "@/lib/tenant";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { handleOwnerCommandTurn } from "@/lib/autopilot/command-center";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  const message = typeof body.message === "string" ? body.message : "";
  if (!businessId || !message.trim()) {
    return NextResponse.json(
      { error: "businessId and message are required." },
      { status: 400 },
    );
  }

  const rl = rateLimitByIdentity(`${session.userId}:${businessId}`, {
    key: "autopilot_cmd",
    max: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Command rate limit reached. Wait a moment before sending another prompt." },
      { status: 429 },
    );
  }

  try {
    const role = await assertBusinessRole(businessId, session, "read");
    const result = await handleOwnerCommandTurn({
      businessId,
      actorUserId: session.userId,
      actorRole: role,
      message,
      modality: body.modality === "VOICE_TRANSCRIPT" ? "VOICE_TRANSCRIPT" : "TEXT",
      voiceTranscriptConfirmed: Boolean(body.voiceTranscriptConfirmed),
    });

    const status = result.ok
      ? 200
      : result.blockedCode === "RBAC_FORBIDDEN"
        ? 403
        : result.requiresVoiceConfirmation
          ? 409
          : 422;

    return NextResponse.json(result, { status });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Command Center could not process this request." },
      { status: 500 },
    );
  }
}
