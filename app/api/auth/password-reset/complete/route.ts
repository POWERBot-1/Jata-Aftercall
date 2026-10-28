import { NextResponse } from "next/server";
import { completePasswordReset, validPasswordResetToken, validRecoveryPassword } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const limit = rateLimit(req, { key: "auth-password-reset-complete", max: 10, windowMs: 15 * 60_000 });
  if (!limit.allowed) return limit.response ?? NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  const body = await req.json().catch(() => null) as { token?: unknown; password?: unknown } | null;
  if (!validPasswordResetToken(body?.token)) {
    return NextResponse.json({ error: "This reset link is invalid or expired. Request a new one." }, { status: 400 });
  }
  if (!validRecoveryPassword(body?.password)) {
    return NextResponse.json({ error: "Use a password of at least 8 characters and no more than 72 bytes." }, { status: 400 });
  }

  try {
    const userId = await completePasswordReset(body.token, body.password);
    if (!userId) {
      return NextResponse.json({ error: "This reset link is invalid or expired. Request a new one." }, { status: 400 });
    }
    await logAudit({ actorId: userId, action: "PASSWORD_RESET_COMPLETED", targetType: "USER", targetId: userId }).catch(() => {
      console.error("Password reset audit write failed.");
    });
    return NextResponse.json({ ok: true, message: "Your password has been updated. Please sign in again." });
  } catch {
    return NextResponse.json({ error: "Password reset could not be completed right now. Please try again." }, { status: 503 });
  }
}
