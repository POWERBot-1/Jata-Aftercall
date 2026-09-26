import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
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
