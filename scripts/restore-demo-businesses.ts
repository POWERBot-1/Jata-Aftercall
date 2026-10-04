/**
 * Restore the four advertised demo businesses — and nothing else.
 *
 *   DATABASE_URL=... npx tsx scripts/restore-demo-businesses.ts            # dry run (default)
 *   DATABASE_URL=... npx tsx scripts/restore-demo-businesses.ts --apply    # write
 *   DEMO_OWNER_EMAIL=existing@user  ... --apply    # only needed if a demo row is MISSING
 *
 * Unlike `prisma/seed.ts` this never creates a user (no admin, no demo account), never writes
 * subscriptions or payments, and never touches a row whose slug is not one of the four demos.
 * See `lib/demoData.ts` for the exact boundary and the rows it refuses to overwrite.
 */
import { PrismaClient } from "@prisma/client";
import { DEMO_SLUGS, restoreDemoBusinesses, type DemoDb } from "../lib/demoData";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — refusing to run.");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
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
