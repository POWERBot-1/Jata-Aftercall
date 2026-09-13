import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET() {
  let db = "unknown";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch (e: unknown) {
    db = `down: ${(e as Error).message?.slice(0, 120)}`;
  }
  return NextResponse.json({
    status: db === "up" ? "ok" : "degraded",
    db,
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
}
