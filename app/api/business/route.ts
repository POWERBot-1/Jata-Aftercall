import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { slugify, validateSlug } from "@/lib/slug";
import { sanitizeText, validatePhone } from "@/lib/validation";
import { guardTenantMutation } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { resolveTheme } from "@/lib/themes";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { canSetPublished, hasVerifiedPublicationRight, PUBLISH_REQUIRES_PAYMENT } from "@/lib/publication";
import { parseCoordinates } from "@/lib/location";
import { deriveDraftBusinessId, isValidDraftKey } from "@/lib/businessDraft";

function prismaErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

/**
 * Makes sure the business owner has the OWNER membership row that the rest of the app expects.
 * Used when a retry finds a draft business that already exists, so a partial state left by an
 * earlier failure is completed before success is reported. Throws (-> 500) if it cannot confirm
 * the membership, so a retry never reports success for a business without its owner membership.
 */
async function ensureOwnerMembership(userId: string, businessId: string): Promise<void> {
  const key = { userId_businessId: { userId, businessId } };
  try {
    await prisma.businessMember.upsert({ where: key, create: { userId, businessId, role: "OWNER" }, update: { role: "OWNER" } });
  } catch (error) {
    // Two retries raced to create the same membership; the other one won. Confirm it, else fail.
    if (prismaErrorCode(error) !== "P2002") throw error;
    const member = await prisma.businessMember.findUnique({ where: key });
    if (!member || member.role !== "OWNER") throw error;
  }
}

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
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid business details." }, { status: 400 });
    const nameRaw = sanitizeText(body.name || "", 80);
    const category = sanitizeText(body.category || "Other", 40);
    const phone = (body.phone || "").trim();
    const whatsapp = (body.whatsapp || body.phone || "").trim();
    if (body.location !== undefined && body.location !== null && typeof body.location !== "string") {
      return NextResponse.json({ error: "Location must be plain text." }, { status: 400 });
    }
    const locationValue = typeof body.location === "string" ? body.location.trim() : "";
    if (locationValue.length > 160) return NextResponse.json({ error: "Location must be 160 characters or fewer." }, { status: 400 });
    const location = sanitizeText(locationValue, 160);
    const coordinates = parseCoordinates(body.lat, body.lng);
    if (coordinates.valid === false) return NextResponse.json({ error: coordinates.error }, { status: 400 });
    const description = sanitizeText(body.description || "", 1000);
    const theme = body.theme || "clean";
    const aftercallMsg = body.aftercallMsg ? sanitizeText(body.aftercallMsg, 120) : null;

    if (!nameRaw || nameRaw.length < 2) return NextResponse.json({ error: "Business name required (min 2)" }, { status: 400 });

    // Onboarding retries (double taps, refreshes, flaky networks) send the same draft key.
    // It maps to one deterministic business id, so the same draft can never create two businesses.
    const draftBusinessId = isValidDraftKey(body.draftKey) ? deriveDraftBusinessId(session.userId, body.draftKey) : null;
    if (draftBusinessId) {
      const already = await prisma.business.findUnique({ where: { id: draftBusinessId } });
      if (already) {
        if (already.ownerId !== session.userId) return NextResponse.json({ error: "This draft could not be saved. Refresh and try again." }, { status: 409 });
        await ensureOwnerMembership(session.userId, already.id);
        return NextResponse.json({ business: already, idempotent: true }, { status: 200 });
      }
    }

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

    let business;
    try {
      business = await prisma.business.create({
      data: {
        ...(draftBusinessId ? { id: draftBusinessId } : {}),
        ownerId: session.userId,
        slug,
        name: nameRaw,
        category: category || "Other",
        phone: phone || null,
        whatsapp: whatsapp || phone || null,
        location: location || null,
        lat: coordinates.lat,
        lng: coordinates.lng,
        description: description || null,
        theme: resolvedTheme,
        aftercallMsg,
        openingHours: body.openingHours ? sanitizeText(JSON.stringify(body.openingHours), 2000) : null,
        socialLinks: body.socialLinks ? sanitizeText(JSON.stringify(body.socialLinks), 2000) : null,
        // Nested write: Prisma creates the business and its OWNER membership in one transaction,
        // so a failure can never leave a business without its owner membership.
        members: { create: { userId: session.userId, role: "OWNER" } },
      },
      });
    } catch (error) {
      // A concurrent request for the same draft won the primary-key race: return that business.
      if (draftBusinessId && prismaErrorCode(error) === "P2002") {
        const winner = await prisma.business.findUnique({ where: { id: draftBusinessId } });
        if (winner && winner.ownerId === session.userId) {
          await ensureOwnerMembership(session.userId, winner.id);
          return NextResponse.json({ business: winner, idempotent: true }, { status: 200 });
        }
      }
      throw error;
    }

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
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid business details." }, { status: 400 });
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
    if (body.location !== undefined) {
      if (body.location !== null && typeof body.location !== "string") {
        return NextResponse.json({ error: "Location must be plain text." }, { status: 400 });
      }
      if (typeof body.location === "string" && body.location.trim().length > 160) {
        return NextResponse.json({ error: "Location must be 160 characters or fewer." }, { status: 400 });
      }
      data.location = typeof body.location === "string" ? sanitizeText(body.location, 160) || null : null;
    }
    if (body.lat !== undefined || body.lng !== undefined) {
      const coordinates = parseCoordinates(body.lat, body.lng);
      if (coordinates.valid === false) return NextResponse.json({ error: coordinates.error }, { status: 400 });
      data.lat = coordinates.lat;
      data.lng = coordinates.lng;
    }
    if (body.description !== undefined) data.description = sanitizeText(body.description, 1000) || null;
    if (body.theme !== undefined) data.theme = resolveTheme(body.theme).key;
    if (body.aftercallMsg !== undefined) data.aftercallMsg = body.aftercallMsg ? sanitizeText(body.aftercallMsg, 120) : null;
    if (body.isPublished !== undefined) {
      if (typeof body.isPublished !== "boolean") return NextResponse.json({ error: "Publish status must be true or false." }, { status: 400 });
      if (body.isPublished) {
        // Payment-before-publication is enforced here, server-side. The UI is not the boundary:
        // a direct API request while unpaid is rejected the same way.
        const isAdmin = session.role === "ADMIN";
        let verifiedPayment = false;
        if (!isAdmin && PUBLISH_REQUIRES_PAYMENT) {
          const [paidPayment, subscription] = await Promise.all([
            prisma.payment.findFirst({ where: { businessId, status: "PAID" }, select: { status: true } }),
            prisma.subscription.findUnique({ where: { businessId }, select: { status: true, expiresAt: true, graceUntil: true } }),
          ]);
          verifiedPayment = hasVerifiedPublicationRight({ paidPayment, subscription });
        }
        if (!canSetPublished(true, { isAdmin, verifiedPayment })) {
          return NextResponse.json({ error: SAFE_ERRORS.publishPaymentRequired }, { status: 403 });
        }
        data.isPublished = true;
      } else {
        // Unpublishing is always allowed.
        data.isPublished = false;
      }
    }
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
