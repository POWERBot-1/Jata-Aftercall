import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  REFERRAL_COOKIE_NAME,
  createReferralAttribution,
  findAttributionByToken,
  isReferrerEligible,
  normalizeReferralCode,
  readReferralCookie,
  referralCookieOptions,
  resolveReferrerByCode,
} from "@/lib/referral";

export const dynamic = "force-dynamic";

/**
 * Stage 2 — self-service referral entry point. Unauthenticated by design: a recipient must be
 * able to open a shared link with no account and no admin assistance.
 *
 * On success this handler persists the attribution server-side and hands the browser only an
 * opaque token in an httpOnly cookie, then redirects to registration. Nothing about the referrer
 * is rendered here, and failures never explain themselves (no enumeration of valid codes).
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await ctx.params;
  const toRegister = (ref?: string) => NextResponse.redirect(new URL(ref ? `/register?ref=${ref}` : "/register", req.url), 303);

  const code = normalizeReferralCode(rawCode);
  if (!code) return toRegister();

  // The referrer is resolved and validated server-side; the code is only a lookup key.
  const referrer = await resolveReferrerByCode(code);
  const eligibility = isReferrerEligible({ referrer });
  if (!referrer || !eligibility.eligible) return toRegister();

  // An existing customer opening a referral link is not a new signup: no attribution.
  // (Also blocks the owner from self-referring through their own link.)
  try {
    const session = await getSession();
    if (session?.userId) return NextResponse.redirect(new URL("/dashboard", req.url), 303);
  } catch {
    // Session resolution must never leak or break the referral flow.
  }

  // First-touch wins: if this browser already carries a valid, unconverted attribution we keep
  // it — a later link from another referrer must not overwrite the first touch.
  const existingToken = readReferralCookie(req);
  if (existingToken) {
    const existing = await findAttributionByToken(existingToken);
    if (existing) return toRegister();
  }

  const created = await createReferralAttribution({
    code,
    referrerUserId: referrer.ownerId,
    referrerBusinessId: referrer.businessId,
  });
  if (!created) return toRegister();

  const response = toRegister(code);
  response.cookies.set(REFERRAL_COOKIE_NAME, created.token, referralCookieOptions());
  return response;
}
