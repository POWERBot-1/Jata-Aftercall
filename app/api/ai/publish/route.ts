import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertBusinessRole } from "@/lib/tenant";
import { publishAIBusinessFrontDesk } from "@/lib/ai-readiness";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await req.json();
    const { businessId } = body || {};
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const roleCheck = await assertBusinessRole({
      userId: user.id,
      businessId,
      userRole: user.role,
      action: "publish",
    });
    if (!roleCheck.allowed) {
      return NextResponse.json(
        { error: "Forbidden — only business owners or admins can publish the AI Front Desk." },
        { status: 403 },
      );
    }

    const result = await publishAIBusinessFrontDesk({
      businessId,
      actorId: user.id,
    });

    if (result.ok === false) {
      const errResult = result as { code: string };
      const status = errResult.code === "SUBSCRIPTION_REQUIRED" ? 402 : 422;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to publish AI Front Desk.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
