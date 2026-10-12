import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { validateExperienceJson } from "@/lib/experience/schema";
import { validateEnquiryInput, saveProfessionalEnquiry, listProfessionalEnquiries, EnquiryReplayConflict } from "@/lib/experience/enquiries";
import { recordEvent, hashSession, hashIp } from "@/lib/analytics";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
const hits = new Map<string, { count: number; until: number }>();
function throttled(ip: string): boolean {
  const key = hashIp(ip) || "unknown"; const now = Date.now();
  for (const [id, entry] of hits) if (entry.until < now) hits.delete(id);
  const entry = hits.get(key);
  if (entry) { entry.count += 1; return entry.count > 20; }
  if (hits.size >= 10000) return true;
  hits.set(key, { count: 1, until: now + 60000 }); return false;
}
function reply(body: unknown, status: number) { return NextResponse.json(body, { status, headers: noStore }); }

/** Public request-only intake. The stored slug/service/published document determines the tenant. */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (throttled(ip)) return reply({ error: "Too many requests. Please wait a minute before trying again." }, 429);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return reply({ error: "Send your enquiry from this business's website." }, 403);
  if (!req.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "We couldn't read that request." }, 400);
  let raw: unknown;
  try {
    if (Number(req.headers.get("content-length") || 0) > 4096) return reply({ error: "Keep the enquiry within the form limits." }, 413);
    const text = await req.text(); if (Buffer.byteLength(text, "utf8") > 4096) return reply({ error: "Keep the enquiry within the form limits." }, 413);
    raw = JSON.parse(text);
  } catch { return reply({ error: "We couldn't read that request. Your details have not been saved." }, 400); }
  const parsed = validateEnquiryInput(raw);
  if (parsed.kind === "error") return reply({ error: parsed.error }, 400);
  // Never acknowledge an offline/in-memory fallback as a durable customer request.
  if (!process.env.DATABASE_URL) return reply({ error: "We couldn't save your enquiry. Please retry or contact the business directly." }, 503);
  const { input } = parsed;
  try {
    const business = await prisma.business.findUnique({ where: { slug: input.slug }, select: { id: true, isPublished: true, status: true } });
    if (!business || !business.isPublished || business.status === "SUSPENDED") return reply({ error: "This business is not accepting enquiries right now." }, 404);
    const experience = await prisma.businessExperience.findUnique({ where: { businessId: business.id }, select: { status: true, publishedJson: true, categoryKey: true } });
    const validated = validateExperienceJson(experience?.publishedJson || "", experience?.categoryKey);
    if (!experience || experience.status !== "PUBLISHED" || !validated.ok || validated.document.categoryKey !== "professional") {
      return reply({ error: "This business is not accepting enquiries right now." }, 404);
    }
    const service = await prisma.service.findFirst({ where: { id: input.serviceId, businessId: business.id, isActive: true }, select: { id: true, title: true } });
    if (!service) return reply({ error: "Choose an available service from this business." }, 404);
    const saved = await saveProfessionalEnquiry({ businessId: business.id, service, input });
    if (!saved.idempotent) {
      // Analytics contain no contact fields. A failed measurement cannot undo the already durable request.
      await recordEvent({ businessId: business.id, eventType: "ENQUIRY_SUBMITTED", subjectId: service.id, ip,
        userAgent: req.headers.get("user-agent"), sessionHash: hashSession({ ip, userAgent: req.headers.get("user-agent") }) })
        .catch(() => console.warn("Enquiry measurement unavailable"));
    }
    return reply({ received: true, idempotent: saved.idempotent, enquiry: { id: saved.record.id, serviceName: saved.record.serviceName, status: "RECEIVED" },
      message: "Enquiry received. The business will reply directly. No appointment or payment has been confirmed." }, saved.idempotent ? 200 : 201);
  } catch (error) {
    if (error instanceof EnquiryReplayConflict) return reply({ error: error.message }, 409);
    console.error("Professional enquiry persistence unavailable");
    return reply({ error: "We couldn't save your enquiry. Please retry with the same details or contact the business directly." }, 503);
  }
}

/** Owner-only ledger read; no public receipt lookup or customer contact leakage. */
export async function GET(req: Request) {
  const session = await getSession();
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  const guard = await guardTenantMutation(session, businessId, "read");
  if (!guard.ok) return reply({ error: guard.error }, guard.status);
  if (!process.env.DATABASE_URL) return reply({ error: "Enquiries are temporarily unavailable." }, 503);
  try { return reply({ enquiries: await listProfessionalEnquiries(businessId) }, 200); }
  catch { return reply({ error: "We couldn't load your enquiries. Please try again." }, 503); }
}
