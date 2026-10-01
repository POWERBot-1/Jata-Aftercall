/**
 * Intelligence Service (§28, §29, §30, §54, §64, §65) — operational intelligence.
 * Tracks unanswered questions, missed-demand, and AI quality events.
 * Never invents metrics (§30); uses authoritative structured data (§95).
 */

import prisma from "./db";

export async function recordUnansweredQuestion(businessId: string, question: string) {
  const existing = await prisma.unansweredQuestion.findFirst({ where: { businessId, question } });
  if (existing) {
    return prisma.unansweredQuestion.update({ where: { id: existing.id }, data: { askedCount: { increment: 1 }, lastAskedAt: new Date() } });
  }
  return prisma.unansweredQuestion.create({ data: { businessId, question, askedCount: 1 } });
}

export async function getUnansweredQuestions(businessId: string) {
  return prisma.unansweredQuestion.findMany({ where: { businessId }, orderBy: { askedCount: "desc" }, take: 20 });
}

export async function approveAnswer(businessId: string, questionId: string, approvedAnswer: string) {
  return prisma.unansweredQuestion.update({ where: { id: questionId, businessId }, data: { approvedAnswer, isResolved: true } });
}

export async function recordDemandInsight(businessId: string, insightType: string, subject: string) {
  const existing = await prisma.demandInsight.findFirst({ where: { businessId, insightType, subject } });
  if (existing) {
    return prisma.demandInsight.update({ where: { id: existing.id }, data: { count: { increment: 1 }, lastRecorded: new Date() } });
  }
  return prisma.demandInsight.create({ data: { businessId, insightType, subject, count: 1 } });
}

export async function getDemandInsights(businessId: string) {
  return prisma.demandInsight.findMany({ where: { businessId }, orderBy: { count: "desc" }, take: 20 });
}

export async function recordAIQualityEvent(event: {
  businessId: string;
  conversationId?: string;
  sourceUsed?: string;
  confidence?: string;
  escalatedToHuman?: boolean;
  customerCorrectedAI?: boolean;
  missingBusinessInfo?: boolean;
  eventType?: string;
  metadata?: string;
}) {
  return prisma.aIQualityEvent.create({
    data: {
      businessId: event.businessId,
      conversationId: event.conversationId || null,
      sourceUsed: event.sourceUsed || "structured_data",
      confidence: event.confidence || null,
      escalatedToHuman: event.escalatedToHuman || false,
      customerCorrectedAI: event.customerCorrectedAI || false,
      missingBusinessInfo: event.missingBusinessInfo || false,
      eventType: event.eventType || null,
      metadata: event.metadata || null,
    },
  });
}

export async function getQualityEvents(businessId: string, eventType?: string) {
  return prisma.aIQualityEvent.findMany({ where: { businessId, ...(eventType ? { eventType } : {}) }, orderBy: { timestamp: "desc" }, take: 50 });
}
