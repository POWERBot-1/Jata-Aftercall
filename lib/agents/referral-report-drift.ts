import type { Prisma } from "@prisma/client";

type Client = Pick<Prisma.TransactionClient, "$queryRaw">;
export type ReferralEvidenceDrift = "MATCHED" | "RECONCILIATION_REQUIRED" | "LEGACY_UNVERIFIABLE" | "REPORT_NOT_FOUND";

/** Compare a retained revision against currently visible evidence, not against payment or
 * historical eligibility. This never fabricates legacy membership or modifies history. */
export async function inspectReferralEvidenceDrift(tx: Client, applicationId: string, periodKey: string, revision: number): Promise<ReferralEvidenceDrift> {
  // Set-based comparison: one full outer join on (eventId, source, eventCreatedAt) between the current
  // evidence in the period and the retained members of this revision. A difference on either side is
  // RECONCILIATION_REQUIRED. This replaces correlated NOT EXISTS subqueries, whose cost grew with the
  // square of the membership when statistics were stale (measured at about 2.8 s for 5,001 members).
  const rows = await tx.$queryRaw<Array<{ status: ReferralEvidenceDrift }>>`
    SELECT CASE
      WHEN r."revision" IS NULL THEN 'LEGACY_UNVERIFIABLE'
      WHEN EXISTS (
        SELECT 1 FROM (
          SELECT a."id", a."source", a."createdAt" FROM "AgentReferralAttribution" a
          WHERE a."referrerApplicationId" = s."applicationId" AND a."createdAt" >= s."startInclusive" AND a."createdAt" < s."endExclusive"
            AND a."source" IN ('REGISTRATION', 'EXISTING_ACCOUNT')
        ) c
        FULL OUTER JOIN (
          SELECT m."eventId", m."source", m."eventCreatedAt" FROM "AgentReferralReportMember" m
          WHERE m."applicationId" = s."applicationId" AND m."periodKey" = s."periodKey" AND m."revision" = r."revision"
        ) k ON c."id" = k."eventId" AND c."source" = k."source" AND c."createdAt" = k."eventCreatedAt"
        WHERE c."id" IS NULL OR k."eventId" IS NULL
      ) THEN 'RECONCILIATION_REQUIRED' ELSE 'MATCHED' END AS "status"
    FROM "AgentReferralReportSnapshot" s
    LEFT JOIN "AgentReferralReportRevision" r ON r."applicationId" = s."applicationId" AND r."periodKey" = s."periodKey" AND r."revision" = ${revision}
    WHERE s."applicationId" = ${applicationId} AND s."periodKey" = ${periodKey}`;
  return rows[0]?.status ?? "REPORT_NOT_FOUND";
}
