import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertBusinessRole, TenantError } from "@/lib/tenant";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { updateAutopilotConfiguration } from "@/lib/autopilot/actions";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
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
  if (!businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  }

  const rl = rateLimitByIdentity(`${session.userId}:${businessId}`, {
    key: "autopilot_config",
    max: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Configuration rate limit reached. Try again shortly." },
      { status: 429 },
    );
  }

  try {
    const role = await assertBusinessRole(businessId, session, "manage_settings");
    const result = await updateAutopilotConfiguration({
      businessId,
      actorUserId: session.userId,
      actorRole: role,
      patch: {
        autonomyMode: body.autonomyMode as any,
        operationalStatus: body.operationalStatus as any,
        industryPackKey:
          typeof body.industryPackKey === "string" ? body.industryPackKey : undefined,
        quietHoursStart:
          typeof body.quietHoursStart === "string" ? body.quietHoursStart : undefined,
        quietHoursEnd:
          typeof body.quietHoursEnd === "string" ? body.quietHoursEnd : undefined,
        dailySpendCapMinorKES:
          typeof body.dailySpendCapMinorKES === "number"
            ? body.dailySpendCapMinorKES
            : undefined,
        maxBatchRecipients:
          typeof body.maxBatchRecipients === "number" ? body.maxBatchRecipients : undefined,
        maxAutoDiscountPct:
          typeof body.maxAutoDiscountPct === "number" ? body.maxAutoDiscountPct : undefined,
        voiceEnabled:
          typeof body.voiceEnabled === "boolean" ? body.voiceEnabled : undefined,
      },
    });
    if (result.ok === false) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ config: result.config });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Could not save Autopilot configuration." },
      { status: 500 },
    );
  }
}
