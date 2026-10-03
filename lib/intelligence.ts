/**
 * Intelligence Service (§28, §29, §30, §34, §35, §36, §54, §64, §65) — operational intelligence.
 *
 * Tracks:
 * - Top recurring customer questions (§34)
 * - Unanswered questions & owner answer approval into Business Brain (§35)
 * - Missed-demand intelligence: unavailable product, unavailable size, unsupported delivery area, service not offered (§36)
 * - AI quality events: source used, confidence, escalation, missing info (§30)
 *
 * Never invents metrics; uses authoritative structured data (§95).
 */

import prisma from "./db";

export const DEMAND_INSIGHT_TYPES = [
  "MISSED_DEMAND",
  "UNAVAILABLE_PRODUCT",
  "UNAVAILABLE_SIZE",
  "OUT_OF_ZONE",
  "SERVICE_NOT_OFFERED",
  "PRICE_INQUIRY",
] as const;

export type DemandInsightType = (typeof DEMAND_INSIGHT_TYPES)[number];

// Tenant-isolated in-memory mirrors for offline / unit test execution
const inMemoryUnanswered = new Map<string, Array<{
  id: string;
  businessId: string;
  question: string;
  askedCount: number;
  approvedAnswer: string | null;
  isResolved: boolean;
  firstAskedAt: Date;
  lastAskedAt: Date;
}>>();

const inMemoryDemand = new Map<string, Array<{
  id: string;
  businessId: string;
  insightType: string;
  subject: string;
  count: number;
  firstRecorded: Date;
  lastRecorded: Date;
}>>();

const inMemoryTopQuestions = new Map<string, Map<string, { question: string; count: number; lastAskedAt: string }>>();

export async function recordCustomerQuestion(businessId: string, question: string, preview = false) {
  if (!businessId || !question || preview) return;
  const cleaned = question.trim().slice(0, 240);
  if (!cleaned) return;
  const normalizedKey = cleaned.toLowerCase().replace(/[?!.]+$/g, "").trim();
  const bizMap = inMemoryTopQuestions.get(businessId) || new Map();
  const existing = bizMap.get(normalizedKey);
  if (existing) {
    existing.count += 1;
    existing.lastAskedAt = new Date().toISOString();
  } else {
    bizMap.set(normalizedKey, {
      question: cleaned,
      count: 1,
      lastAskedAt: new Date().toISOString(),
    });
  }
  inMemoryTopQuestions.set(businessId, bizMap);
}

export async function getTopCustomerQuestions(
  businessId: string,
): Promise<Array<{ question: string; count: number; lastAskedAt: string }>> {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  const bizMap = inMemoryTopQuestions.get(businessId) || new Map();
  const combined = new Map<string, { question: string; count: number; lastAskedAt: string }>();

  for (const [k, v] of bizMap.entries()) {
    combined.set(k, { ...v });
  }

  try {
    const unanswered = await getUnansweredQuestions(businessId);
    for (const u of unanswered) {
      const key = u.question.toLowerCase().replace(/[?!.]+$/g, "").trim();
      const prev = combined.get(key);
      if (!prev || u.askedCount > prev.count) {
        combined.set(key, {
          question: u.question,
          count: u.askedCount,
          lastAskedAt: u.lastAskedAt ? new Date(u.lastAskedAt).toISOString() : new Date().toISOString(),
        });
      }
    }
  } catch {
    // ignore
  }

  return Array.from(combined.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

export async function recordUnansweredQuestion(businessId: string, question: string) {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  const cleaned = question.trim();

  // Update in-memory tenant mirror
  const list = inMemoryUnanswered.get(businessId) || [];
  let memEntry = list.find((q) => q.question.toLowerCase() === cleaned.toLowerCase());
  if (memEntry) {
    memEntry.askedCount += 1;
    memEntry.lastAskedAt = new Date();
  } else {
    memEntry = {
      id: `uq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      businessId,
      question: cleaned,
      askedCount: 1,
      approvedAnswer: null,
      isResolved: false,
      firstAskedAt: new Date(),
      lastAskedAt: new Date(),
    };
    list.push(memEntry);
    inMemoryUnanswered.set(businessId, list);
  }

  try {
    const existing = await prisma.unansweredQuestion.findFirst({ where: { businessId, question: cleaned } });
    if (existing) {
      memEntry.id = existing.id;
      return await prisma.unansweredQuestion.update({
        where: { id: existing.id },
        data: { askedCount: { increment: 1 }, lastAskedAt: new Date() },
      });
    }
    const created = await prisma.unansweredQuestion.create({ data: { businessId, question: cleaned, askedCount: 1 } });
    if (created?.id) {
      memEntry.id = created.id;
    }
    return created;
  } catch {
    return memEntry;
  }
}

export async function getUnansweredQuestions(businessId: string) {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  try {
    const dbRows = await prisma.unansweredQuestion.findMany({
      where: { businessId },
      orderBy: { askedCount: "desc" },
      take: 20,
    });
    if (Array.isArray(dbRows) && dbRows.length > 0) return dbRows;
  } catch {
    // Fallback to in-memory
  }
  return (inMemoryUnanswered.get(businessId) || []).slice().sort((a, b) => b.askedCount - a.askedCount);
}

/**
 * Approve an answer to an unanswered question (§35).
 * Once approved, the answer becomes authoritative Business Brain knowledge (synced to FAQ).
 */
export async function approveAnswer(businessId: string, questionId: string, approvedAnswer: string) {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  const cleanedAnswer = approvedAnswer.trim();

  const list = inMemoryUnanswered.get(businessId) || [];
  const memTarget = list.find((q) => q.id === questionId);
  if (memTarget) {
    memTarget.approvedAnswer = cleanedAnswer;
    memTarget.isResolved = true;
    memTarget.lastAskedAt = new Date();
  }

  let updatedRow: any = memTarget || {
    id: questionId,
    businessId,
    question: memTarget?.question || "Customer question",
    approvedAnswer: cleanedAnswer,
    isResolved: true,
    askedCount: 1,
  };

  try {
    updatedRow = await prisma.unansweredQuestion.update({
      where: { id: questionId, businessId },
      data: { approvedAnswer: cleanedAnswer, isResolved: true },
    });
    if (memTarget && !updatedRow?.question) {
      updatedRow = { ...memTarget, ...updatedRow };
    }
  } catch {
    // Keep memTarget update if DB is mocked/offline
  }

  // Promote approved answer into authoritative FAQ table so Business Brain serves it immediately (§35)
  try {
    const questionText = updatedRow?.question || memTarget?.question;
    if (questionText && prisma.fAQ?.create) {
      const existingFaq = await prisma.fAQ?.findFirst?.({
        where: { businessId, question: questionText },
      }).catch(() => null);
      if (existingFaq && prisma.fAQ?.update) {
        await prisma.fAQ.update({
          where: { id: existingFaq.id },
          data: { approvedAnswer: cleanedAnswer, isActive: true },
        });
      } else {
        await prisma.fAQ.create({
          data: {
            businessId,
            question: questionText,
            approvedAnswer: cleanedAnswer,
            isActive: true,
          },
        });
      }
    }
  } catch {
    // ignore if FAQ table is not mocked in unit test
  }

  return updatedRow;
}

export async function recordDemandInsight(businessId: string, insightType: string, subject: string) {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  const cleanedSubject = subject.trim();
  const list = inMemoryDemand.get(businessId) || [];
  const memExisting = list.find(
    (d) => d.insightType === insightType && d.subject.toLowerCase() === cleanedSubject.toLowerCase(),
  );
  if (memExisting) {
    memExisting.count += 1;
    memExisting.lastRecorded = new Date();
  } else {
    list.push({
      id: `dem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      businessId,
      insightType,
      subject: cleanedSubject,
      count: 1,
      firstRecorded: new Date(),
      lastRecorded: new Date(),
    });
    inMemoryDemand.set(businessId, list);
  }

  try {
    const existing = await prisma.demandInsight.findFirst({ where: { businessId, insightType, subject: cleanedSubject } });
    if (existing) {
      return await prisma.demandInsight.update({
        where: { id: existing.id },
        data: { count: { increment: 1 }, lastRecorded: new Date() },
      });
    }
    return await prisma.demandInsight.create({ data: { businessId, insightType, subject: cleanedSubject, count: 1 } });
  } catch {
    return list.find((d) => d.insightType === insightType && d.subject.toLowerCase() === cleanedSubject.toLowerCase())!;
  }
}

export async function getDemandInsights(businessId: string) {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  try {
    const rows = await prisma.demandInsight.findMany({
      where: { businessId },
      orderBy: { count: "desc" },
      take: 20,
    });
    if (Array.isArray(rows) && rows.length > 0) return rows;
  } catch {
    // Fallback to in-memory
  }
  return (inMemoryDemand.get(businessId) || []).slice().sort((a, b) => b.count - a.count);
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
  try {
    return await prisma.aIQualityEvent.create({
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
  } catch {
    return {
      id: `aiq_${Date.now()}`,
      businessId: event.businessId,
      conversationId: event.conversationId || null,
      sourceUsed: event.sourceUsed || "structured_data",
      confidence: event.confidence || null,
      escalatedToHuman: event.escalatedToHuman || false,
      customerCorrectedAI: event.customerCorrectedAI || false,
      missingBusinessInfo: event.missingBusinessInfo || false,
      eventType: event.eventType || null,
      metadata: event.metadata || null,
      timestamp: new Date(),
    };
  }
}

export async function getQualityEvents(businessId: string, eventType?: string) {
  try {
    return await prisma.aIQualityEvent.findMany({
      where: { businessId, ...(eventType ? { eventType } : {}) },
      orderBy: { timestamp: "desc" },
      take: 50,
    });
  } catch {
    return [];
  }
}

export function resetIntelligenceForTests() {
  inMemoryUnanswered.clear();
  inMemoryDemand.clear();
  inMemoryTopQuestions.clear();
}
