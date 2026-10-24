/**
 * Restore the four advertised demo businesses — and nothing else.
 *
 *   # Use an isolated non-production database only; default is a dry run.
 *   DATABASE_URL=... npx tsx scripts/restore-demo-businesses.ts
 *   DATABASE_URL=... DEMO_OWNER_EMAIL=demo@jata.link npx tsx scripts/restore-demo-businesses.ts --apply
 *
 * This never creates a user, writes subscriptions or payments, or changes a row unless it belongs
 * to the dedicated demo account and has no non-demo payment. It refuses arbitrary owner emails.
 * See `lib/demoData.ts` for the full identity and write boundary.
 */
import { PrismaClient } from "@prisma/client";
import { installInlineMediaPrismaWritePolicy } from "../lib/media/prisma-write-policy";
import { DEMO_SLUGS, restoreDemoBusinesses, type DemoDb } from "../lib/demoData";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — refusing to run.");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const prisma = installInlineMediaPrismaWritePolicy(new PrismaClient());
  try {
    console.log(`Demo restore (${apply ? "APPLY" : "dry run"}) for: ${DEMO_SLUGS.join(", ")}`);
    const report = await restoreDemoBusinesses(prisma as unknown as DemoDb, { apply, ownerEmail: process.env.DEMO_OWNER_EMAIL });
    for (const outcome of report.outcomes) {
      console.log(`- ${outcome.slug}: ${outcome.action}${outcome.reason ? ` (${outcome.reason})` : ""} services +${outcome.servicesCreated} ~${outcome.servicesUpdated}`);
    }
    if (!apply) console.log("Dry run only — re-run with --apply to write.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
