import { NextResponse } from "next/server";
import { isRegisterFailure, registerOwner } from "@/lib/registration";
import { SAFE_ERRORS } from "@/lib/safeError";
import { readReferralCookie } from "@/lib/referral";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: SAFE_ERRORS.registerUnreadable }, { status: 400 });
    }
    const result = await registerOwner({
      name: body.name,
      email: body.email,
      phone: body.phone,
      password: body.password,
      businessName: body.businessName,
      // Stage 2: both values are hints. The referrer is resolved server-side from the persisted
      // attribution; a missing/tampered value simply means the signup proceeds unreferred.
      referral: { code: body.ref, token: readReferralCookie(req) },
    });
    if (isRegisterFailure(result)) return NextResponse.json({ error: result.error }, { status: result.status });
    // Only the recipient's own outcome is returned; internal reject reasons are not exposed.
    return NextResponse.json(result.referral ? { ok: true, user: result.user, referral: { recorded: result.referral.recorded } } : { ok: true, user: result.user });
  } catch {
    console.error("registration failed");
    return NextResponse.json({ error: SAFE_ERRORS.registerUnexpected }, { status: 500 });
  }
}
