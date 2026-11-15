import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import prisma from "@/lib/db";
import { signAutomationPayload } from "@/lib/automation/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.AUTOMATION_WORKER_SECRET ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (secret.length < 32 || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** Bounded outbox runner. Configure an external scheduler only after deploying and staging this endpoint. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const destination = process.env.JATA_N8N_EVENTS_URL;
  const hmacSecret = process.env.JATA_AUTOMATION_HMAC_SECRET ?? "";
  if (!destination || hmacSecret.length < 32) return NextResponse.json({ error: "automation_not_configured" }, { status: 503 });
  let target: URL;
  try { target = new URL(destination); } catch { return NextResponse.json({ error: "invalid_destination" }, { status: 503 }); }
  if (process.env.NODE_ENV === "production" && target.protocol !== "https:") return NextResponse.json({ error: "https_required" }, { status: 503 });

  const now = new Date();
  const due = await prisma.automationEvent.findMany({
    where: { direction: "OUTBOUND", attempts: { lt: 8 }, availableAt: { lte: now }, OR: [{ status: "PENDING" }, { status: "PROCESSING", leaseUntil: { lt: now } }] },
    orderBy: { availableAt: "asc" }, take: 20,
  });
  let delivered = 0;
  let deferred = 0;
  for (const row of due) {
    if (row.attempts >= row.maxAttempts) {
      await prisma.automationEvent.update({ where: { id: row.id }, data: { status: "FAILED", leaseUntil: null, lastError: row.lastError ?? "RETRY_LIMIT_REACHED" } });
      continue;
    }
    const leaseUntil = new Date(Date.now() + 30_000);
    const claimed = await prisma.automationEvent.updateMany({
      where: { id: row.id, direction: "OUTBOUND", attempts: row.attempts, OR: [{ status: "PENDING" }, { status: "PROCESSING", leaseUntil: { lt: now } }] },
      data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil },
    });
    if (claimed.count !== 1) continue;
    const body = JSON.stringify(row.payload);
    try {
      const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "x-jata-signature": signAutomationPayload(body, hmacSecret), "x-jata-event-id": row.eventId }, body, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      await prisma.automationEvent.update({ where: { id: row.id }, data: { status: "DELIVERED", completedAt: new Date(), leaseUntil: null, lastError: null } });
      delivered++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= row.maxAttempts;
      const delayMs = Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attempts - 1, 10));
      await prisma.automationEvent.update({ where: { id: row.id }, data: {
        status: exhausted ? "FAILED" : "PENDING", leaseUntil: null,
        availableAt: exhausted ? now : new Date(Date.now() + delayMs),
        lastError: error instanceof Error ? error.message.slice(0, 160) : "DELIVERY_FAILED",
      } });
      deferred++;
    }
  }
  return NextResponse.json({ claimed: due.length, delivered, deferred });
}
