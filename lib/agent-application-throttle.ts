import { createHmac, randomInt } from "node:crypto";
import prisma from "@/lib/db";

/** Shared, atomic per-account limit for agent applications. No account IDs are stored in the bucket. */
export async function allowAgentApplication(userId: string): Promise<boolean> {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Application limiter unavailable");
  const key = createHmac("sha256", secret).update(`agent-application-account:v1:${userId}`).digest("hex");
  // The registration flow can be disabled indefinitely, so it cannot own cleanup for this bucket.
  if (randomInt(100) === 0) {
    await prisma.agentRegistrationThrottle.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
  }
  const rows: Array<{ count: number }> = await prisma.$queryRaw`
    INSERT INTO "AgentRegistrationThrottle" ("key", "count", "expiresAt")
    VALUES (${key}, 1, NOW() + INTERVAL '1 minute')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AgentRegistrationThrottle"."expiresAt" <= NOW() THEN 1 ELSE "AgentRegistrationThrottle"."count" + 1 END,
      "expiresAt" = CASE WHEN "AgentRegistrationThrottle"."expiresAt" <= NOW() THEN NOW() + INTERVAL '1 minute' ELSE "AgentRegistrationThrottle"."expiresAt" END
    WHERE "AgentRegistrationThrottle"."expiresAt" <= NOW() OR "AgentRegistrationThrottle"."count" < 5
    RETURNING "count"`;
  // In particular, do not treat an offline fallback or malformed DB response as permission.
  return rows.length === 1 && Number.isInteger(rows[0].count) && rows[0].count >= 1 && rows[0].count <= 5;
}
