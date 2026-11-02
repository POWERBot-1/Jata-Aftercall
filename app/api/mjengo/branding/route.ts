import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership } from "@/lib/tenant";
import { sanitizeBrandingText, isSafeBrandingName } from "@/lib/mjengo/sanitize";
import { verifyMjengoOrigin } from "@/lib/mjengo/csrf";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" } as const;
function reply(body: unknown, status: number) { return NextResponse.json(body, { status, headers: noStore }); }
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  const session = await getSession();
  if (!session) return reply({ error: "Sign in to continue." }, 401);
  try { await assertBusinessOwnership(businessId, session); } catch (e: any) { return reply({ error: e.message ?? "Not allowed." }, e.status ?? 403); }
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, slug: true } });
  if (!business) return reply({ error: "Business not found." }, 404);
  return reply({ businessId, business_name: business.name, slug: business.slug }, 200);
}
export async function POST(req: Request) {
  const originCheck = verifyMjengoOrigin(req);
  if (!originCheck.ok) return reply({ error: `Origin check failed: ${originCheck.reason}` }, 403);
  const limit = rateLimit(req, { key: "mjengo-branding", max: 30, windowMs: 60_000 });
  if (!limit.allowed) return reply({ error: "Too many requests." }, 429);
  if (!process.env.DATABASE_URL) return reply({ error: "Database unavailable." }, 503);
  const session = await getSession();
  if (!session) return reply({ error: "Sign in to continue." }, 401);
  let body: any; try { body = await req.json(); } catch { return reply({ error: "Invalid JSON." }, 400); }
  const businessId = String(body.businessId ?? "").trim();
  try { await assertBusinessOwnership(businessId, session); } catch (e: any) { return reply({ error: e.message ?? "Not allowed." }, e.status ?? 403); }
  const rawName = String(body.business_name ?? "");
  const safeName = sanitizeBrandingText(rawName, 200);
  if (!safeName || safeName.length < 2) return reply({ error: "Business name must be 2-200 characters of plain text." }, 400);
  if (!isSafeBrandingName(safeName)) return reply({ error: "Business name must be plain text (no HTML tags or scripts)." }, 400);
  const updated = await prisma.business.update({ where: { id: businessId }, data: { name: safeName } });
  return reply({ ok: true, business_name: updated.name }, 200);
}
