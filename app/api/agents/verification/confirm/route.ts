import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/agent-application";
import { readSmallJson } from "@/lib/agent-registration";
import { confirmPhoneChallenge, verificationConfig, verificationLimit } from "@/lib/agents/phone-verification";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const config = verificationConfig();
  if (!config) return NextResponse.json({ error: "Phone verification is not available yet." }, { status: 503 });
  try {
    if (!await verificationLimit(config.secret, session.userId, "confirm")) return NextResponse.json({ error: "Too many attempts. Try later." }, { status: 429 });
    const input = await readSmallJson(req);
    const code = input && typeof input === "object" && "code" in input ? input.code : null;
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the six-digit code." }, { status: 400 });
    const result = await confirmPhoneChallenge(session.userId, code, config.secret);
    if (result === "invalid") return NextResponse.json({ error: "Code is invalid, expired or unavailable." }, { status: 400 });
    return NextResponse.json({ status: "VERIFIED", active: false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Verification could not be completed." }, { status: 503 }); }
}
