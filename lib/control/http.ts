import { NextResponse } from "next/server";

/** Control responses may contain tenant, account, payment-status or security data. */
export function controlJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("Vary", "Cookie");
  return response;
}
