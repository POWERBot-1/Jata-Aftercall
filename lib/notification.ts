/**
 * Notification Service (§17, §18, §37, §63) — multi-tenant, deterministic,
 * auditable notification engine.
 *
 * Key principles:
 * - Transaction success ≠ notification success (§37)
 * - Never rolls back verified transactions merely because notification failed (§37)
 * - Keeps separate status for transaction and notification (§37)
 * - Uses nominated business number configured by the owner (§17)
 * - Audit events recorded without secrets (§47)
 */

import { PrismaClient } from "@prisma/client";
import prisma from "./db";

export type NotificationEvent = {
  businessId: string;
  eventType: string; // From Notification model
  title: string;
  message: string;
  channel?: string;
  referenceId?: string; // Order ID, PreOrder ID, etc.
};

export async function createNotification(event: NotificationEvent): Promise<{ id: string; status: string }> {
  // Look up nominated recipient for the business.
  const recipient = await prisma.notificationRecipient.findFirst({
    where: { businessId: event.businessId, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const notification = await prisma.notification.create({
    data: {
      businessId: event.businessId,
      eventType: event.eventType,
      title: event.title,
      message: event.message,
      channel: event.channel || "WHATSAPP",
      recipientNumber: recipient?.phone || null,
      recipientEmail: recipient?.email || null,
      status: "PENDING",
      deliveryAttempted: false,
      deliveryFailed: false,
      retryCount: 0,
      maxRetries: 3,
      referenceId: event.referenceId || null,
    },
  });

  return { id: notification.id, status: notification.status };
}

export async function getNotificationStatus(notificationId: string): Promise<{ id: string; status: string; deliveryFailed: boolean; retryCount: number; deliveredAt?: Date | null }> {
  const notif = await prisma.notification.findUnique({ where: { id: notificationId }, select: { id: true, status: true, deliveryFailed: true, retryCount: true, deliveredAt: true } });
  if (!notif) throw new Error(`Notification ${notificationId} not found.`);
  return notif;
}

export async function retryFailedNotification(notificationId: string): Promise<{ id: string; status: string; retryCount: number }> {
  const notif = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notif) throw new Error(`Notification ${notificationId} not found.`);
  if (notif.status !== "FAILED" && notif.status !== "RETRY_QUEUED") {
    throw new Error(`Notification not in retryable state: ${notif.status}`);
  }
  if (notif.retryCount >= notif.maxRetries) {
    throw new Error(`Max retries (${notif.maxRetries}) exceeded for notification ${notificationId}`);
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      status: "RETRY_QUEUED",
      retryCount: notif.retryCount + 1,
      deliveryFailed: false,
      deliveryAttempted: false,
    },
  });

  return { id: updated.id, status: updated.status, retryCount: updated.retryCount };
}
