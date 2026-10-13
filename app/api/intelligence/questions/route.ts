import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertBusinessRole, canAccessBusiness } from "@/lib/tenant";
import {
  approveAnswer,
  getTopCustomerQuestions,
  getUnansweredQuestions,
  recordUnansweredQuestion,
} from "@/lib/intelligence";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null);
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    // Unanswered customer questions are owner intelligence: never readable anonymously (§5, §54).
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const [questions, topQuestions] = await Promise.all([
      getUnansweredQuestions(businessId),
      getTopCustomerQuestions(businessId),
    ]);

    return NextResponse.json({ questions, topQuestions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch unanswered questions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null);
    const body = await req.json();
    const { businessId, action, question, questionId, approvedAnswer } = body || {};

    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }
    // Every write to a business's question queue is tenant business activity. Anonymous callers may not write
    // into another tenant's queue (the storefront records questions through the AI Front Desk turn, not here).
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (action === "approve") {
      if (!questionId || !approvedAnswer) {
        return NextResponse.json(
          { error: "questionId and approvedAnswer required." },
          { status: 400 },
        );
      }

      // Approving an answer writes the business's authoritative knowledge, so the caller must
      // be authenticated and hold edit_knowledge rights on that tenant (§5, §35, §46).
      if (!user) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
      }
      const roleCheck = await assertBusinessRole({
        userId: user.id,
        businessId,
        userRole: user.role,
        action: "edit_knowledge",
      });
      if (!roleCheck.allowed) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }

      const updated = await approveAnswer(businessId, questionId, approvedAnswer);

      await logAudit({
        actorId: user?.id ?? null,
        action: "FAQ_APPROVED",
        targetType: "UNANSWERED_QUESTION",
        targetId: questionId,
        newValue: { approvedAnswer, isResolved: true },
        metadata: { businessId },
      });

      return NextResponse.json({ question: updated });
    }

    if (!question) {
      return NextResponse.json({ error: "question required." }, { status: 400 });
    }
    const allowedToRecord = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowedToRecord) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const recorded = await recordUnansweredQuestion(businessId, question);
    return NextResponse.json({ question: recorded });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Operation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
