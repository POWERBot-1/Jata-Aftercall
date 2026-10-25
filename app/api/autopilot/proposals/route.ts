import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertBusinessRole, TenantError } from "@/lib/tenant";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import {
  approveAndExecuteProposal,
  proposeAutopilotAction,
  rejectProposal,
  rollbackExecutedProposal,
} from "@/lib/autopilot/actions";
import type { AutopilotActionPayload, AutopilotActionType } from "@/lib/autopilot/types";

export const dynamic = "force-dynamic";

const ALLOWED_ACTION_TYPES: ReadonlySet<string> = new Set([
  "CREATE_OR_UPDATE_OFFER",
  "RESOLVE_UNANSWERED_FAQ",
  "QUEUE_CONSENTED_FOLLOWUP",
]);

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
  const actionType = typeof body.actionType === "string" ? body.actionType.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!businessId || !ALLOWED_ACTION_TYPES.has(actionType) || !title || !idempotencyKey) {
    return NextResponse.json(
      { error: "businessId, valid actionType, title, and idempotencyKey are required." },
      { status: 400 },
    );
  }

  const rl = rateLimitByIdentity(`${session.userId}:${businessId}`, {
    key: "autopilot_proposals_post",
    max: 40,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Proposal rate limit reached. Try again in a moment." },
      { status: 429 },
    );
  }

  try {
    const role = await assertBusinessRole(businessId, session, "configure");
    const result = await proposeAutopilotAction({
      businessId,
      actorUserId: session.userId,
      actorRole: role,
      actionType: actionType as AutopilotActionType,
      title,
      rationale: rationale || title,
      expectedImpact:
        typeof body.expectedImpact === "string" ? body.expectedImpact : undefined,
      payload: (body.payload ?? { actionType }) as AutopilotActionPayload,
      idempotencyKey,
      modality:
        body.modality === "VOICE_TRANSCRIPT"
          ? "VOICE_TRANSCRIPT"
          : body.modality === "DOCUMENT_EXTRACT"
            ? "DOCUMENT_EXTRACT"
            : "TEXT",
      voiceTranscriptConfirmed: Boolean(body.voiceTranscriptConfirmed),
    });

    if (result.ok === false) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      );
    }
    return NextResponse.json({
      proposal: result.proposal,
      autoExecuted: result.autoExecuted,
      duplicate: result.duplicate,
    });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Could not create Autopilot proposal." },
      { status: 500 },
    );
  }
}

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
  const proposalId = typeof body.proposalId === "string" ? body.proposalId.trim() : "";
  const operation = typeof body.operation === "string" ? body.operation.trim() : "";

  if (!businessId || !proposalId || !operation) {
    return NextResponse.json(
      { error: "businessId, proposalId, and operation are required." },
      { status: 400 },
    );
  }

  const rl = rateLimitByIdentity(`${session.userId}:${businessId}`, {
    key: "autopilot_proposals_patch",
    max: 40,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Proposal operation rate limit reached. Try again in a moment." },
      { status: 429 },
    );
  }

  try {
    const role = await assertBusinessRole(businessId, session, "configure");
    if (operation === "APPROVE_AND_EXECUTE") {
      const res = await approveAndExecuteProposal({
        businessId,
        proposalId,
        actorUserId: session.userId,
        actorRole: role,
      });
      if (res.ok === false) {
        return NextResponse.json(
          { error: res.error, code: res.code },
          { status: res.status },
        );
      }
      return NextResponse.json({
        proposal: res.proposal,
        idempotentReplay: Boolean(res.idempotentReplay),
      });
    }

    if (operation === "REJECT") {
      const res = await rejectProposal({
        businessId,
        proposalId,
        actorUserId: session.userId,
        actorRole: role,
      });
      if (res.ok === false) {
        return NextResponse.json({ error: res.error }, { status: res.status });
      }
      return NextResponse.json({ proposal: res.proposal });
    }

    if (operation === "ROLLBACK") {
      const res = await rollbackExecutedProposal({
        businessId,
        proposalId,
        actorUserId: session.userId,
        actorRole: role,
      });
      if (res.ok === false) {
        return NextResponse.json(
          { error: res.error, code: res.code },
          { status: res.status },
        );
      }
      return NextResponse.json({ proposal: res.proposal });
    }

    return NextResponse.json({ error: "Unsupported operation." }, { status: 400 });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Proposal operation could not be completed." },
      { status: 500 },
    );
  }
}
