import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership } from "@/lib/tenant";
import { postJournal } from "@/lib/erp/accounting";
import { verifyMjengoOrigin } from "@/lib/mjengo/csrf";
import { rateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/db";
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" } as const;
function reply(body: unknown, status: number) { return NextResponse.json(body, { status, headers: noStore }); }
export async function POST(req: Request) {
  const origin = verifyMjengoOrigin(req);
  if (!origin.ok) return reply({ error: `Origin: ${origin.reason}` }, 403);
  const limit = rateLimit(req, { key: "mjengo-journal", max: 60, windowMs: 60_000 });
  if (!limit.allowed) return reply({ error: "Too many requests." }, 429);
  const session = await getSession();
  if (!session) return reply({ error: "Sign in." }, 401);
  let body: any; try { body = await req.json(); } catch { return reply({ error: "Invalid JSON." }, 400); }
  const businessId = String(body.businessId ?? "").trim();
  try { await assertBusinessOwnership(businessId, session); } catch (e: any) { return reply({ error: e.message }, e.status ?? 403); }
  if (!body.description || String(body.description).trim().length < 2) return reply({ error: "Describe what this journal is for." }, 400);
  if (!Array.isArray(body.lines) || body.lines.length < 2) return reply({ error: "At least two lines required." }, 400);
  for (const l of body.lines) {
    const d = Number(l.debitCents ?? 0), c = Number(l.creditCents ?? 0);
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0) return reply({ error: "Amounts must be non-negative integer cents." }, 400);
    if ((d > 0 && c > 0) || (d === 0 && c === 0)) return reply({ error: "Each line must be debit or credit, not both/neither." }, 400);
  }
  try {
    const posted = await postJournal(null, { businessId, actorId: session.userId, actorName: session.name ?? session.email, entryDate: body.entryDate ?? new Date(), description: String(body.description), sourceType: body.sourceType ?? "MANUAL", sourceId: body.sourceId ?? null, branchId: body.branchId ?? null, lines: body.lines, idempotencyKey: body.idempotencyKey ?? null });
    return reply({ ok: true, journal: posted }, 201);
  } catch (e: any) { return reply({ error: e.message ?? "Journal failed.", code: e.code ?? "ACCOUNTING_ERROR" }, e.status ?? 400); }
}
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  const session = await getSession();
  if (!session) return reply({ error: "Sign in." }, 401);
  try { await assertBusinessOwnership(businessId, session); } catch (e: any) { return reply({ error: e.message }, e.status ?? 403); }
  try {
    const journals: any[] = await (prisma as any).erpJournal.findMany({ where: { businessId, status: { in: ["POSTED", "REVERSED"] } } });
    const lines: any[] = await (prisma as any).erpJournalLine.findMany({ where: { businessId } });
    const byJournal = new Map<string, any[]>();
    for (const l of lines) { const arr = byJournal.get(l.journalId) ?? []; arr.push(l); byJournal.set(l.journalId, arr); }
    const empty: string[] = []; const unbalanced: string[] = []; const orphaned: any[] = [];
    const journalIds = new Set(journals.map((j) => j.id));
    for (const j of journals) {
      const js = byJournal.get(j.id) ?? [];
      if (js.length === 0) empty.push(j.id);
      else { const deb = js.reduce((s: number, x: any) => s + Number(x.debitCents ?? 0), 0); const cred = js.reduce((s: number, x: any) => s + Number(x.creditCents ?? 0), 0); if (deb !== cred) unbalanced.push(j.id); }
    }
    for (const l of lines) if (!journalIds.has(l.journalId)) orphaned.push(l.id);
    let viewRows: any[] = []; try { viewRows = await (prisma as any).$queryRawUnsafe('SELECT * FROM "ErpJournalIntegrity" WHERE "businessId" = $1 AND ("balanced" = false OR "empty" = true)', businessId); } catch {}
    return reply({ ok: empty.length === 0 && unbalanced.length === 0 && orphaned.length === 0, empty, unbalanced, orphaned, viewAnomalies: viewRows }, 200);
  } catch (e: any) { return reply({ error: e.message ?? "Integrity check failed." }, 500); }
}
