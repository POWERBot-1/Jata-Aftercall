import type { Prisma } from "@prisma/client";

type Client = Pick<Prisma.TransactionClient, "$queryRaw">;
export type ReferralEvidenceDrift = "MATCHED" | "RECONCILIATION_REQUIRED" | "LEGACY_UNVERIFIABLE" | "REPORT_NOT_FOUND";

/** Compare a retained revision against currently visible evidence, not against payment or
 * historical eligibility. This never fabricates legacy membership or modifies history. */
export async function inspectReferralEvidenceDrift(tx: Client, applicationId: string, periodKey: string, revision: number): Promise<ReferralEvidenceDrift> {
  const rows = await tx.$queryRaw<Array<{ status: ReferralEvidenceDrift }>>`
    SELECT CASE
      WHEN r."revision" IS NULL THEN 'LEGACY_UNVERIFIABLE'
      WHEN EXISTS (
        SELECT 1 FROM "AgentReferralAttribution" a
        WHERE a."referrerApplicationId" = s."applicationId" AND a."createdAt" >= s."startInclusive" AND a."createdAt" < s."endExclusive"
          AND a."source" IN ('REGISTRATION', 'EXISTING_ACCOUNT')
          AND NOT EXISTS (SELECT 1 FROM "AgentReferralReportMember" m
            WHERE m."applicationId" = s."applicationId" AND m."periodKey" = s."periodKey" AND m."revision" = r."revision"
              AND m."eventId" = a."id" AND m."source" = a."source" AND m."eventCreatedAt" = a."createdAt")
      ) OR EXISTS (
        SELECT 1 FROM "AgentReferralReportMember" m
        WHERE m."applicationId" = s."applicationId" AND m."periodKey" = s."periodKey" AND m."revision" = r."revision"
          AND NOT EXISTS (SELECT 1 FROM "AgentReferralAttribution" a
            WHERE a."id" = m."eventId" AND a."referrerApplicationId" = s."applicationId" AND a."createdAt" >= s."startInclusive" AND a."createdAt" < s."endExclusive"
              AND a."source" = m."source" AND a."createdAt" = m."eventCreatedAt")
      ) THEN 'RECONCILIATION_REQUIRED' ELSE 'MATCHED' END AS "status"
    FROM "AgentReferralReportSnapshot" s
    LEFT JOIN "AgentReferralReportRevision" r ON r."applicationId" = s."applicationId" AND r."periodKey" = s."periodKey" AND r."revision" = ${revision}
    WHERE s."applicationId" = ${applicationId} AND s."periodKey" = ${periodKey}`;
  return rows[0]?.status ?? "REPORT_NOT_FOUND";
}
