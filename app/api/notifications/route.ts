/**
 * Notification Trigger (§63, §64, §65) — transactional and operational notifications.
 * Keeps notification status separate from transaction status (§37).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { createNotification } from "@/lib/notification";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    // For notifications triggered by events (not always user-initiated),
    // we enforce business ownership if a session exists.
    const guardResult = await (async () => {
      try {
        return await guardTenantMutation(session, businessId);
      } catch {
        return { ok: false, status: 403, error: "Business context required for notification." };
      }
    })();
    if (!guardResult.ok) return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });

    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "GENERAL";
    const title = typeof body.title === "string" ? body.title.trim() : "Notification";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const channel = typeof body.channel === "string" ? body.channel.trim() : "WHATSAPP";
    const referenceId = typeof body.referenceId === "string" ? body.referenceId.trim() || null : null;

    if (!businessId) return NextResponse.json({ error: "Business required." }, { status: 400 });
    if (!message || message.length < 1) return NextResponse.json({ error: "Message required." }, { status: 400 });

    const notificationResult = await createNotification({
      businessId: businessId!,
      eventType,
      title,
      message,
      channel,
      referenceId,
    });

    return NextResponse.json({
      notificationId: notificationResult.id,
      status: notificationResult.status,
      businessId,
      eventType,
      message: "Notification queued. Transaction success and notification delivery are recorded separately (§37).",
    }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
