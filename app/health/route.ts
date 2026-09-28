import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { allowStubPrismaClient } from "@/lib/prismaRuntime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /health — deployment check (§26).
 *
 * A health check may only claim `db: "up"` when a real database client is possible.
 * With `DATABASE_URL` absent the runtime uses the offline stub (lib/db.ts), whose
 * `$queryRaw` resolves synthetically — trusting that result would report a healthy
 * database on a deployment that has none. In that case we report `db: "unconfigured"`
 * and `status: "degraded"` instead of probing the stub.
 *
 * When `DATABASE_URL` is configured the behaviour is unchanged: probe the real client
 * and report `up`/`down` (production contract, DEPLOYMENT.md §2 step 6).
 */
export async function GET() {
  if (allowStubPrismaClient(process.env.DATABASE_URL)) {
    return NextResponse.json({
      status: "degraded",
      db: "unconfigured",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    });
  }

  let db: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }
  return NextResponse.json({
    status: db === "up" ? "ok" : "degraded",
    db,
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
}
