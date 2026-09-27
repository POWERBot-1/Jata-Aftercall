import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { getBaseUrl } from "@/lib/url";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", getBaseUrl()), 303);
}

export async function GET() {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", getBaseUrl()), 303);
}
