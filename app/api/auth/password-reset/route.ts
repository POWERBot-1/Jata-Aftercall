import { after, NextResponse } from "next/server";
import { isPasswordResetEmailConfigured } from "@/lib/password-reset-email";
import { requestPasswordReset } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { validateEmail } from "@/lib/validation";

const accepted = {
  message: "If an account exists for that address, a password reset link may arrive by email.",
};

export async function POST(req: Request) {
  const limit = rateLimit(req, { key: "auth-password-reset-request", max: 5, windowMs: 15 * 60_000 });
  if (!limit.allowed) return limit.response ?? NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  // Check global capability before looking up an account. This gives every address the same
  // disabled response and avoids account-dependent behavior when no delivery channel is set.
  if (!isPasswordResetEmailConfigured()) {
    return NextResponse.json(
      { error: "Password reset is not available in this deployment. Please contact your account administrator." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validateEmail(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    // Defer account lookup and delivery until after the same generic response is sent for every
    // valid address; otherwise SMTP latency could act as an account-enumeration side channel.
    after(async () => {
      try {
        await requestPasswordReset(email);
      } catch {
        // Do not log the address, token, SMTP URL, or provider error.
        console.error("Password reset request processing failed.");
      }
    });
    return NextResponse.json(accepted, { status: 202 });
  } catch {
    // Scheduling failure is global and independent of whether the address belongs to an account.
    return NextResponse.json(
      { error: "Password reset could not be processed right now. Please try again later." },
      { status: 503 },
    );
  }
}
