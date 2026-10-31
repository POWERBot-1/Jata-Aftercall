import { randomInt, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

// Internal persistence primitives only: no recipient resolution, sender, scheduler or endpoint.
// A claim is NOT proof that a provider has accepted or delivered a notification.
export type NotificationClaim = { applicationId: string; recipientKey: string; claimToken: string; attempts: number };
export type ClaimOutcome = "ACCEPTED" | "UNKNOWN" | "SAFE_TRANSIENT_REJECTION" | "SAFE_PERMANENT_REJECTION";
type Client = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
const enabled = () => process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED === "true";

/** One atomic PostgreSQL claim. An existing expired claim is never reclaimed as safe to send. */
export async function claimAdminNotification(db: Client): Promise<NotificationClaim | null> {
  if (!enabled()) return null;
  const token = randomUUID();
  const result = await db.$queryRaw<NotificationClaim[]>`
    WITH candidate AS (
      SELECT d."applicationId", d."recipientKey"
      FROM "AgentAdminNotificationDelivery" d
      LEFT JOIN "AgentAdminNotificationClaimState" s USING ("applicationId", "recipientKey")
      WHERE s."state" IS NULL OR (s."state" = 'RETRY' AND s."nextAttemptAt" <= clock_timestamp())
      ORDER BY d."createdAt", d."applicationId", d."recipientKey"
      FOR UPDATE OF d SKIP LOCKED LIMIT 1
    )
    INSERT INTO "AgentAdminNotificationClaimState" ("applicationId", "recipientKey", "state", "attempts", "claimToken", "leaseUntil")
    SELECT "applicationId", "recipientKey", 'CLAIMED', 1, ${token}, clock_timestamp() + INTERVAL '5 minutes' FROM candidate
    ON CONFLICT ("applicationId", "recipientKey") DO UPDATE
    SET "state" = 'CLAIMED', "attempts" = "AgentAdminNotificationClaimState"."attempts" + 1,
        "claimToken" = ${token}, "leaseUntil" = clock_timestamp() + INTERVAL '5 minutes',
        "nextAttemptAt" = NULL, "updatedAt" = clock_timestamp()
    WHERE "AgentAdminNotificationClaimState"."state" = 'RETRY'
      AND "AgentAdminNotificationClaimState"."nextAttemptAt" <= clock_timestamp()
      AND "AgentAdminNotificationClaimState"."attempts" < 5
    RETURNING "applicationId", "recipientKey", "claimToken", "attempts"`;
  return result[0] ?? null;
}

/** Only caller-classified, provider-confirmed rejection that created no message can be retried.
 * Timeouts, exceptions, ambiguous results and lease expiry must be UNKNOWN, never a safe rejection. */
export async function finishAdminNotificationClaim(db: Client, claim: NotificationClaim, outcome: ClaimOutcome): Promise<boolean> {
  if (!enabled()) return false;
  if (!["ACCEPTED", "UNKNOWN", "SAFE_TRANSIENT_REJECTION", "SAFE_PERMANENT_REJECTION"].includes(outcome)) throw new Error("INVALID_NOTIFICATION_OUTCOME");
  // Attempts are taken from the locked database row, never the caller's claim object.
  // Exponential delay (1,2,4,8 minutes) plus 0–30 seconds jitter, bounded at four retries.
  const jitter = randomInt(0, 31);
  const count = await db.$executeRaw`
    UPDATE "AgentAdminNotificationClaimState"
    SET "state" = CASE
          WHEN ${outcome} = 'ACCEPTED' THEN 'ACCEPTED'
          WHEN ${outcome} = 'UNKNOWN' THEN 'UNKNOWN'
          WHEN ${outcome} = 'SAFE_TRANSIENT_REJECTION' AND "attempts" < 5 THEN 'RETRY'
          ELSE 'DEAD' END,
        "nextAttemptAt" = CASE WHEN ${outcome} = 'SAFE_TRANSIENT_REJECTION' AND "attempts" < 5
          THEN clock_timestamp() + (power(2, "attempts" - 1) * 60 + ${jitter}) * INTERVAL '1 second' ELSE NULL END,
        "claimToken" = NULL, "leaseUntil" = NULL, "updatedAt" = clock_timestamp()
    WHERE "applicationId" = ${claim.applicationId} AND "recipientKey" = ${claim.recipientKey}
      AND "state" = 'CLAIMED' AND "claimToken" = ${claim.claimToken} AND "leaseUntil" > clock_timestamp()`;
  return count === 1;
}

/** Recovery is conservative: an expired lease is ambiguous, never automatically requeued. */
export async function markExpiredAdminNotificationClaimsUnknown(db: Client): Promise<number> {
  if (!enabled()) return 0;
  return db.$executeRaw`
    WITH expired AS (
      SELECT "applicationId", "recipientKey" FROM "AgentAdminNotificationClaimState"
      WHERE "state" = 'CLAIMED' AND "leaseUntil" <= clock_timestamp()
      ORDER BY "leaseUntil", "applicationId", "recipientKey"
      FOR UPDATE SKIP LOCKED LIMIT 100
    ), recovered AS (
      UPDATE "AgentAdminNotificationClaimState" s SET "state" = 'UNKNOWN', "claimToken" = NULL,
        "leaseUntil" = NULL, "updatedAt" = clock_timestamp()
      FROM expired e WHERE s."applicationId" = e."applicationId" AND s."recipientKey" = e."recipientKey"
        AND s."state" = 'CLAIMED' AND s."leaseUntil" <= clock_timestamp()
      RETURNING s."applicationId", s."recipientKey", s."attempts"
    )
    INSERT INTO "AgentAdminNotificationRecovery" ("applicationId", "recipientKey", "attempt", "reason")
    SELECT "applicationId", "recipientKey", "attempts", 'LEASE_EXPIRED_UNKNOWN' FROM recovered`;
}
