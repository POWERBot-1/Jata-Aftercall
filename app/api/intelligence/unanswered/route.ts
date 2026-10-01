/**
 * Intelligence Route — Unanswered Questions (§28, §29, §54, §65)
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { recordUnansweredQuestion, getUnansweredQuestions, approveAnswer } from "@/lib/intelligence";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const questions = await getUnansweredQuestions(businessId!);
  return NextResponse.json({ unansweredQuestions: questions });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!businessId) return NextResponse.json({ error: "Business required." }, { status: 400 });
    if (!question || question.length < 3) return NextResponse.json({ error: "Question required." }, { status: 400 });
    const result = await recordUnansweredQuestion(businessId!, question);
    await logAudit({ actorId: session.userId, action: "UNANSWERED_QUESTION_RECORDED", targetType: "UNANSWERED_QUESTION", targetId: result.id, metadata: { question } });
    return NextResponse.json({ unansweredQuestion: result }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const questionId = body.questionId || body.id;
    const approvedAnswer = typeof body.approvedAnswer === "string" ? body.approvedAnswer.trim() : "";
    if (!businessId || !questionId) return NextResponse.json({ error: "Business and question required." }, { status: 400 });
    if (!approvedAnswer || approvedAnswer.length < 5) return NextResponse.json({ error: "Approved answer must be at least 5 characters." }, { status: 400 });
    const updated = await approveAnswer(businessId!, questionId, approvedAnswer);
    await logAudit({ actorId: session.userId, action: "UNANSWERED_QUESTION_RESOLVED", targetType: "UNANSWERED_QUESTION", targetId: updated.id, metadata: { approved: true } });
    return NextResponse.json({ unansweredQuestion: updated });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
