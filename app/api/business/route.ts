import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { slugify, validateSlug } from "@/lib/slug";
import { sanitizeText, validatePhone } from "@/lib/validation";
import { guardTenantMutation } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { resolveTheme } from "@/lib/themes";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { canSetPublished } from "@/lib/publication";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const businesses = await prisma.business.findMany({
    where: session.role === "ADMIN" ? {} : { ownerId: session.userId },
    include: { subscription: { include: { plan: true } }, services: true, offer: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ businesses });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const nameRaw = sanitizeText(body.name || "", 80);
    const category = sanitizeText(body.category || "Other", 40);
    const phone = (body.phone || "").trim();
    const whatsapp = (body.whatsapp || body.phone || "").trim();
    const location = sanitizeText(body.location || "", 120);
    const description = sanitizeText(body.description || "", 1000);
    const theme = body.theme || "clean";
    const aftercallMsg = body.aftercallMsg ? sanitizeText(body.aftercallMsg, 120) : null;

    if (!nameRaw || nameRaw.length < 2) return NextResponse.json({ error: "Business name required (min 2)" }, { status: 400 });

    // Derive slug: explicit slug if provided else from name
    let slug = body.slug ? slugify(body.slug) : slugify(nameRaw);
    const v = validateSlug(slug);
    if (!v.valid) return NextResponse.json({ error: v.reason }, { status: 400 });

    // Collision protection
    const existing = await prisma.business.findUnique({ where: { slug } });
    if (existing) {
      // auto-suffix
      let i = 2;
      let candidate = `${slug}-${i}`;
      while (await prisma.business.findUnique({ where: { slug: candidate } })) {
        i++;
        candidate = `${slug}-${i}`;
        if (i > 100) return NextResponse.json({ error: "Slug collision — try a different business name" }, { status: 409 });
      }
      slug = candidate;
    }

    const resolvedTheme = resolveTheme(theme).key;

    if (phone && !validatePhone(phone)) return NextResponse.json({ error: "Valid phone required" }, { status: 400 });

    const business = await prisma.business.create({
      data: {
        ownerId: session.userId,
        slug,
        name: nameRaw,
        category: category || "Other",
        phone: phone || null,
        whatsapp: whatsapp || phone || null,
        location: location || null,
        description: description || null,
        theme: resolvedTheme,
        aftercallMsg,
        openingHours: body.openingHours ? sanitizeText(JSON.stringify(body.openingHours), 2000) : null,
        socialLinks: body.socialLinks ? sanitizeText(JSON.stringify(body.socialLinks), 2000) : null,
      },
    });

    await prisma.businessMember.create({
      data: { userId: session.userId, businessId: business.id, role: "OWNER" },
    });

    await logAudit({ actorId: session.userId, action: "BUSINESS_CREATED", targetType: "BUSINESS", targetId: business.id, metadata: { slug } });

    // Create empty subscription PENDING for flow tracking
    // Plan selection happens at checkout; we leave subscription null until checkout

    return NextResponse.json({ business }, { status: 201 });
  } catch {
    console.error("business create failed");
    return NextResponse.json({ error: SAFE_ERRORS.businessFailed }, { status: 500 });
  }
}

// PATCH for updating business (dashboard edit)
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const n = sanitizeText(body.name, 80);
      if (n.length < 2) return NextResponse.json({ error: "Name too short" }, { status: 400 });
      data.name = n;
    }
    if (body.category !== undefined) data.category = sanitizeText(body.category, 40);
    if (body.phone !== undefined) data.phone = (body.phone || "").trim() || null;
    if (body.whatsapp !== undefined) data.whatsapp = (body.whatsapp || "").trim() || null;
    if (body.location !== undefined) data.location = sanitizeText(body.location, 120) || null;
    if (body.description !== undefined) data.description = sanitizeText(body.description, 1000) || null;
    if (body.theme !== undefined) data.theme = resolveTheme(body.theme).key;
    if (body.aftercallMsg !== undefined) data.aftercallMsg = body.aftercallMsg ? sanitizeText(body.aftercallMsg, 120) : null;
    if (body.isPublished !== undefined && canSetPublished(!!body.isPublished)) data.isPublished = !!body.isPublished;
    if (body.openingHours !== undefined) data.openingHours = body.openingHours ? sanitizeText(JSON.stringify(body.openingHours), 2000) : null;
    if (body.socialLinks !== undefined) data.socialLinks = body.socialLinks ? sanitizeText(JSON.stringify(body.socialLinks), 2000) : null;

    const updated = await prisma.business.update({ where: { id: businessId }, data: data as any });
    await logAudit({ actorId: session.userId, action: "BUSINESS_UPDATED", targetType: "BUSINESS", targetId: businessId });
    return NextResponse.json({ business: updated });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("business update failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
