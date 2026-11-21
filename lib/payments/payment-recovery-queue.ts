import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import type { PaymentRecoveryQueueItem } from "@/lib/payments/payment-lifecycle-recovery";

export type ClaimedPaymentRecoveryTask = {
  id: string; idempotencyKey: string; exception: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM"; status: "LEASED";
  payload: Prisma.JsonValue; attempts: number; maxAttempts: number;
  availableAt: Date; leaseToken: string; leaseUntil: Date;
};

export type RecoveryQueueClient = {
  paymentRecoveryTask: {
    createMany(args: any): Promise<{ count: number }>;
    updateMany(args: any): Promise<{ count: number }>;
    findFirst(args: any): Promise<{ attempts: number; maxAttempts: number } | null>;
  };
  $transaction<T>(fn: (tx: {
    $executeRaw(query: Prisma.Sql): Promise<number>;
    $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  }) => Promise<T>): Promise<T>;
};

export function paymentRecoveryRetryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("PAYMENT_RECOVERY_ATTEMPT_INVALID");
  return Math.min(30_000 * 2 ** Math.min(attempt - 1, 10), 6 * 60 * 60 * 1000);
}

export async function enqueuePaymentRecoveryTasks(
  items: PaymentRecoveryQueueItem[],
  client: RecoveryQueueClient = prisma as unknown as RecoveryQueueClient,
): Promise<{ inserted: number; received: number }> {
  if (items.length === 0) return { inserted: 0, received: 0 };
  const result = await client.paymentRecoveryTask.createMany({
    data: items.map((item) => ({
      idempotencyKey: item.idempotencyKey, exception: item.exception, priority: item.priority,
      status: "READY", payload: item as unknown as Prisma.InputJsonValue, maxAttempts: 8,
    })),
    skipDuplicates: true,
  });
  return { inserted: result.count, received: items.length };
}

export async function claimPaymentRecoveryTask(
  options: { leaseMs?: number; now?: Date } = {},
  client: RecoveryQueueClient = prisma as unknown as RecoveryQueueClient,
): Promise<ClaimedPaymentRecoveryTask | null> {
  const leaseMs = options.leaseMs ?? 60_000;
  const now = options.now ?? new Date();
  if (!Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 15 * 60_000) {
    throw new Error("PAYMENT_RECOVERY_LEASE_DURATION_INVALID");
  }
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  return client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "PaymentRecoveryTask"
      SET "status" = 'DEAD_LETTER', "leaseToken" = NULL, "leaseUntil" = NULL,
          "lastErrorCode" = COALESCE("lastErrorCode", 'LEASE_EXPIRED_MAX_ATTEMPTS'), "updatedAt" = ${now}
      WHERE "status" = 'LEASED' AND "leaseUntil" <= ${now} AND "attempts" >= "maxAttempts"
    `);
    const rows = await tx.$queryRaw<ClaimedPaymentRecoveryTask[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id" FROM "PaymentRecoveryTask"
        WHERE "attempts" < "maxAttempts" AND (
          ("status" IN ('READY', 'RETRY') AND "availableAt" <= ${now}) OR
          ("status" = 'LEASED' AND "leaseUntil" <= ${now})
        )
        ORDER BY CASE "priority" WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
          "availableAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE "PaymentRecoveryTask" AS task
      SET "status" = 'LEASED', "attempts" = task."attempts" + 1,
          "leaseToken" = ${leaseToken}, "leaseUntil" = ${leaseUntil}, "updatedAt" = ${now}
      FROM candidate WHERE task."id" = candidate."id"
      RETURNING task."id", task."idempotencyKey", task."exception", task."priority",
        task."status", task."payload", task."attempts", task."maxAttempts",
        task."availableAt", task."leaseToken", task."leaseUntil"
    `);
    return rows[0] ?? null;
  });
}

export async function completePaymentRecoveryTask(
  id: string, leaseToken: string, now = new Date(),
  client: RecoveryQueueClient = prisma as unknown as RecoveryQueueClient,
): Promise<boolean> {
  const result = await client.paymentRecoveryTask.updateMany({
    where: { id, leaseToken, status: "LEASED" },
    data: { status: "COMPLETED", completedAt: now, leaseToken: null, leaseUntil: null, lastErrorCode: null },
  });
  return result.count === 1;
}

export async function failPaymentRecoveryTask(
  id: string, leaseToken: string, errorCode: string, options: { now?: Date } = {},
  client: RecoveryQueueClient = prisma as unknown as RecoveryQueueClient,
): Promise<"RETRY" | "DEAD_LETTER" | "STALE_LEASE"> {
  const safeCode = /^[A-Z0-9_:-]{1,80}$/.test(errorCode) ? errorCode : "UNCLASSIFIED_WORKER_ERROR";
  const now = options.now ?? new Date();
  const task = await client.paymentRecoveryTask.findFirst({
    where: { id, leaseToken, status: "LEASED" }, select: { attempts: true, maxAttempts: true },
  });
  if (!task) return "STALE_LEASE";
  const exhausted = task.attempts >= task.maxAttempts;
  const result = await client.paymentRecoveryTask.updateMany({
    where: { id, leaseToken, status: "LEASED" },
    data: exhausted
      ? { status: "DEAD_LETTER", leaseToken: null, leaseUntil: null, lastErrorCode: safeCode }
      : { status: "RETRY", availableAt: new Date(now.getTime() + paymentRecoveryRetryDelayMs(task.attempts)),
          leaseToken: null, leaseUntil: null, lastErrorCode: safeCode },
  });
  if (result.count !== 1) return "STALE_LEASE";
  return exhausted ? "DEAD_LETTER" : "RETRY";
}
