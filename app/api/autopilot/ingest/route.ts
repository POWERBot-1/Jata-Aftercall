import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/auth";
import { assertBusinessRole, TenantError } from "@/lib/tenant";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { getAutopilotConfig } from "@/lib/autopilot/actions";
import { getAutopilotEntitlement } from "@/lib/autopilot/entitlement";
import { isGlobalAutopilotKillSwitchActive } from "@/lib/autopilot/policy";
import { ingestMultimodalArtifact } from "@/lib/autopilot/security";
import {
  releaseAutopilotBudgetReservation,
  reserveAutopilotBudget,
} from "@/lib/autopilot/usage";

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
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "text/plain";
  const textContent = typeof body.textContent === "string" ? body.textContent : "";
  const declaredByteSize =
    typeof body.byteSize === "number" && Number.isFinite(body.byteSize) && body.byteSize > 0
      ? Math.min(Math.round(body.byteSize), 10 * 1024 * 1024)
      : undefined;

  if (!businessId || !fileName) {
    return NextResponse.json(
      { error: "businessId and fileName are required." },
      { status: 400 },
    );
  }

  const rl = rateLimitByIdentity(`${session.userId}:${businessId}`, {
    key: "autopilot_ingest",
    max: 15,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Upload rate limit reached. Try again in a minute." },
      { status: 429 },
    );
  }

  try {
    await assertBusinessRole(businessId, session, "configure");

    if (isGlobalAutopilotKillSwitchActive()) {
      return NextResponse.json(
        {
          error: "Platform-wide JATA Autopilot kill switch is active; document ingestion is paused.",
          code: "GLOBAL_KILL_SWITCH_ACTIVE",
        },
        { status: 409 },
      );
    }

    const [config, entitlement] = await Promise.all([
      getAutopilotConfig(businessId),
      getAutopilotEntitlement(businessId),
    ]);
    if (config.operationalStatus === "PAUSED") {
      return NextResponse.json(
        {
          error: "Emergency Pause is active for this business; resume Autopilot before ingesting documents.",
          code: "TENANT_AUTOPILOT_PAUSED",
        },
        { status: 409 },
      );
    }

    const digestSeed = crypto
      .createHash("sha256")
      .update(`${businessId}:${fileName}:${mimeType}:${textContent.slice(0, 512)}:${declaredByteSize ?? 0}`)
      .digest("hex")
      .slice(0, 24);
    const budgetKey = `ingest_${digestSeed}`;
    const budget = await reserveAutopilotBudget({
      businessId,
      tierKey: entitlement.entitled ? entitlement.tier : "PREVIEW",
      capability: "VISION_EXTRACT",
      provider: "jata-multimodal-guard",
      idempotencyKey: budgetKey,
      dailySpendCapMinorKES: config.dailySpendCapMinorKES,
      unitsIn: textContent.length || declaredByteSize || 1,
      unitsOut: 1,
    });
    if (budget.allowed === false) {
      return NextResponse.json(
        { error: budget.reason, code: budget.code },
        { status: 429 },
      );
    }

    const syntheticBinaryHeader =
      !textContent && declaredByteSize
        ? new Uint8Array(Math.min(declaredByteSize, 64))
        : undefined;

    const result = await ingestMultimodalArtifact({
      businessId,
      uploadedByUserId: session.userId,
      fileName,
      mimeType,
      textContent,
      rawBytes: syntheticBinaryHeader,
      declaredKind: typeof body.declaredKind === "string" ? body.declaredKind : undefined,
    });

    if (!result.ok) {
      await releaseAutopilotBudgetReservation(budgetKey);
      return NextResponse.json(
        { error: result.error, code: result.errorCode },
        { status: 400 },
      );
    }
    return NextResponse.json({ record: result.record });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Document could not be ingested safely." },
      { status: 500 },
    );
  }
}
