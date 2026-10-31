import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/agent-application";
import { issuePhoneChallenge, verificationConfig, verificationLimit } from "@/lib/agents/phone-verification";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const config = verificationConfig();
  if (!config) return NextResponse.json({ error: "Phone verification is not available yet." }, { status: 503 });
  try {
    if (!await verificationLimit(config.secret, session.userId, "issue")) return NextResponse.json({ error: "Too many attempts. Try later." }, { status: 429 });
    const result = await issuePhoneChallenge(session.userId, config);
    if (result === "unavailable") return NextResponse.json({ error: "Verification is temporarily unavailable." }, { status: 503 });
    return NextResponse.json({ status: result === "already" ? "VERIFIED" : "CODE_REQUESTED" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Verification is temporarily unavailable." }, { status: 503 }); }
}
