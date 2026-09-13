import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", process.env.PUBLIC_BASE_URL || "http://localhost:3000"), 303);
}

export async function GET() {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", process.env.PUBLIC_BASE_URL || "http://localhost:3000"), 303);
}
