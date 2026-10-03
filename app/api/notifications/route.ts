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

    // Every notification operation is tenant-scoped business activity: an anonymous caller
    // may neither read the business notification log nor trigger deliveries/retries (§22, §54).
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (action === "retry") {
      if (!notificationId) {
        return NextResponse.json({ error: "notificationId required for retry." }, { status: 400 });
      }
      if (!businessId) {
        return NextResponse.json({ error: "businessId is required to retry a notification." }, { status: 400 });
      }
      const allowedRetry = await canAccessBusiness(user.id, businessId, user.role);
      if (!allowedRetry) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }
      const result = await retryFailedNotification(notificationId, businessId);
      return NextResponse.json(result);
    }

    if (!businessId || !eventType || !title || !message) {
      return NextResponse.json(
        { error: "businessId, eventType, title, and message required." },
        { status: 400 },
      );
    }

    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
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

    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    // Every read is scoped to one tenant: a bare notificationId is never enough, otherwise an
    // authenticated member of one business could read another business's notification (§54).
    if (!businessId) {
      return NextResponse.json({ error: "businessId is required." }, { status: 400 });
    }
    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
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
