import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import {
  createNotification,
  getNotificationStatus,
  listNotificationsForBusiness,
  retryFailedNotification,
} from "@/lib/notification";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null);
    const body = await req.json();
    const {
      businessId,
      eventType,
      title,
      message,
      channel,
      referenceId,
      idempotencyKey,
      preview,
      action,
      notificationId,
    } = body || {};

    if (action === "retry") {
      if (!notificationId) {
        return NextResponse.json({ error: "notificationId required for retry." }, { status: 400 });
      }
      if (user && businessId) {
        const allowed = await canAccessBusiness(user.id, businessId, user.role);
        if (!allowed) {
          return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
        }
      }
      const result = await retryFailedNotification(notificationId, businessId || undefined);
      return NextResponse.json(result);
    }

    if (!businessId || !eventType || !title || !message) {
      return NextResponse.json(
        { error: "businessId, eventType, title, and message required." },
        { status: 400 },
      );
    }

    if (user) {
      const allowed = await canAccessBusiness(user.id, businessId, user.role);
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }
    }

    const result = await createNotification({
      businessId,
      eventType,
      title,
      message,
      channel,
      referenceId,
      idempotencyKey,
      preview: Boolean(preview),
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Notification operation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null);
    const { searchParams } = new URL(req.url);
    const notificationId = searchParams.get("notificationId");
    const businessId = searchParams.get("businessId");

    if (businessId && user) {
      const allowed = await canAccessBusiness(user.id, businessId, user.role);
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }
    }

    if (notificationId) {
      const result = await getNotificationStatus(notificationId, businessId || undefined);
      return NextResponse.json(result);
    }

    if (businessId) {
      const notifications = await listNotificationsForBusiness(businessId);
      return NextResponse.json({ notifications });
    }

    return NextResponse.json({ error: "notificationId or businessId required." }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch notification status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
