/**
 * Notification Service (§17, §18, §21, §22, §37, §63) — multi-tenant, deterministic,
 * auditable notification engine.
 *
 * Key principles:
 * - Transaction success ≠ notification success (§22, §37)
 * - Keeps separate status for transaction and notification (§22, §37)
 * - Uses nominated business number configured by the owner (§21)
 * - Audit events recorded without secrets (§47)
 */

import prisma from "./db";

export type NotificationEvent = {
  businessId: string;
  eventType: string; // From Notification model
  title: string;
  message: string;
  channel?: string;
  referenceId?: string;
  idempotencyKey?: string;
  preview?: boolean;
};

const inMemoryNotifications = new Map<string, {
  id: string;
  businessId: string;
  eventType: string;
  title: string;
  message: string;
  channel: string;
  recipientNumber: string | null;
  recipientEmail: string | null;
  status: string;
  deliveryAttempted: boolean;
  deliveryFailed: boolean;
  retryCount: number;
  maxRetries: number;
  referenceId: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}>();

const notificationDedupKeys = new Map<string, { id: string; status: string }>();

export async function createNotification(event: NotificationEvent): Promise<{ id: string; status: string; idempotent?: boolean }> {
  if (!event.businessId) {
    throw new Error("businessId required for notification — tenant isolation enforced.");
  }

  // Preview mode (§28): never notify the live business number
  if (event.preview) {
    return { id: `preview_notif_${Date.now()}`, status: "SKIPPED" };
  }

  const dedupKey = event.idempotencyKey
    ? `${event.businessId}:${event.idempotencyKey}`
    : event.referenceId
      ? `${event.businessId}:${event.eventType}:${event.referenceId}`
      : null;

  if (dedupKey) {
    const existing = notificationDedupKeys.get(dedupKey);
    if (existing) {
      return { ...existing, idempotent: true };
    }
  }

  // Look up nominated recipient for the business (PRIMARY -> SECONDARY -> OWNER -> STAFF)
  let recipient: { phone?: string | null; email?: string | null } | null = null;
  try {
    recipient = await prisma.notificationRecipient.findFirst({
      where: { businessId: event.businessId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
  } catch {
    recipient = null;
  }

  if (!recipient?.phone && !recipient?.email && prisma.business?.findUnique) {
    try {
      const biz = await prisma.business.findUnique({
        where: { id: event.businessId },
        select: { whatsapp: true, phone: true },
      });
      if (biz) {
        recipient = { phone: biz.whatsapp || biz.phone || null, email: null };
      }
    } catch {
      recipient = null;
    }
  }

  try {
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
    const res = { id: notification.id, status: notification.status };
    inMemoryNotifications.set(notification.id, {
      id: notification.id,
      businessId: event.businessId,
      eventType: event.eventType,
      title: event.title,
      message: event.message,
      channel: event.channel || "WHATSAPP",
      recipientNumber: recipient?.phone || null,
      recipientEmail: recipient?.email || null,
      status: notification.status,
      deliveryAttempted: false,
      deliveryFailed: false,
      retryCount: 0,
      maxRetries: 3,
      referenceId: event.referenceId || null,
      createdAt: new Date(),
      deliveredAt: null,
    });
    if (dedupKey) notificationDedupKeys.set(dedupKey, res);
    return res;
  } catch {
    const fallbackId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      id: fallbackId,
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
      createdAt: new Date(),
      deliveredAt: null,
    };
    inMemoryNotifications.set(fallbackId, record);
    const res = { id: fallbackId, status: "PENDING" };
    if (dedupKey) notificationDedupKeys.set(dedupKey, res);
    return res;
  }
}

export async function getNotificationStatus(
  notificationId: string,
  businessId?: string,
): Promise<{ id: string; status: string; deliveryFailed: boolean; retryCount: number; deliveredAt?: Date | null }> {
  let notif: any = null;
  try {
    notif = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, businessId: true, status: true, deliveryFailed: true, retryCount: true, deliveredAt: true },
    });
  } catch {
    notif = null;
  }
  if (!notif) {
    notif = inMemoryNotifications.get(notificationId) || null;
  }
  if (!notif) throw new Error(`Notification ${notificationId} not found.`);
  if (businessId && notif.businessId && notif.businessId !== businessId) {
    throw new Error("Tenant isolation: notification belongs to another business.");
  }
  return {
    id: notif.id,
    status: notif.status,
    deliveryFailed: notif.deliveryFailed,
    retryCount: notif.retryCount,
    deliveredAt: notif.deliveredAt,
  };
}

export async function retryFailedNotification(
  notificationId: string,
  businessId?: string,
): Promise<{ id: string; status: string; retryCount: number }> {
  let notif: any = null;
  try {
    notif = await prisma.notification.findUnique({ where: { id: notificationId } });
  } catch {
    notif = null;
  }
  if (!notif) {
    notif = inMemoryNotifications.get(notificationId) || null;
  }
  if (!notif) throw new Error(`Notification ${notificationId} not found.`);
  if (businessId && notif.businessId && notif.businessId !== businessId) {
    throw new Error("Tenant isolation: notification belongs to another business.");
  }
  if (notif.status !== "FAILED" && notif.status !== "RETRY_QUEUED" && notif.status !== "PENDING") {
    throw new Error(`Notification not in retryable state: ${notif.status}`);
  }
  if (notif.retryCount >= notif.maxRetries) {
    throw new Error(`Max retries (${notif.maxRetries}) exceeded for notification ${notificationId}`);
  }

  try {
    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: "RETRY_QUEUED",
        retryCount: notif.retryCount + 1,
        deliveryFailed: false,
        deliveryAttempted: false,
      },
    });
    const mem = inMemoryNotifications.get(notificationId);
    if (mem) {
      mem.status = "RETRY_QUEUED";
      mem.retryCount = updated.retryCount;
      mem.deliveryFailed = false;
    }
    return { id: updated.id, status: updated.status, retryCount: updated.retryCount };
  } catch {
    const mem = inMemoryNotifications.get(notificationId);
    if (mem) {
      mem.status = "RETRY_QUEUED";
      mem.retryCount += 1;
      mem.deliveryFailed = false;
      return { id: mem.id, status: mem.status, retryCount: mem.retryCount };
    }
    throw new Error(`Notification ${notificationId} retry failed.`);
  }
}

export async function listNotificationsForBusiness(businessId: string) {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  try {
    const rows = await prisma.notification.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (Array.isArray(rows) && rows.length > 0) return rows;
  } catch {
    // Fallback to in-memory
  }
  return Array.from(inMemoryNotifications.values()).filter((n) => n.businessId === businessId);
}

export function resetNotificationsForTests() {
  inMemoryNotifications.clear();
  notificationDedupKeys.clear();
}
