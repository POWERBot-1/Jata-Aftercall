/**
 * Subscription flow helpers — authorized fixes
 *
 * 1. Existing-business unsubscribed customers go to /dashboard/subscription?businessId=... rather than looping through onboarding.
 * 2. Dashboard provides Subscribe / View plans and pay.
 * 3. Plan cards actionable and lead to /checkout?businessId=...&planId=...
 */

export type BusinessSubscriptionStatus = {
  id: string;
  hasActiveSubscription: boolean;
};

export function getSubscriptionPageUrl(businessId: string): string {
  return `/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`;
}

export function getCheckoutUrl(businessId: string, planId: string): string {
  return `/checkout?businessId=${encodeURIComponent(businessId)}&planId=${encodeURIComponent(planId)}`;
}

export function getCheckoutUrlWithPlanOnly(planId: string): string {
  return `/checkout?planId=${encodeURIComponent(planId)}`;
}

/**
 * Resolve where onboarding should redirect when user already owns businesses.
 * - 0 businesses => null (stay in onboarding)
 * - >0 businesses, first unsubscribed => /dashboard/subscription?businessId=...
 * - >0 businesses, all active => /dashboard
 */
export function resolveOnboardingRedirect(params: {
  ownedBusinessCount: number;
  businesses: BusinessSubscriptionStatus[];
}): string | null {
  const { ownedBusinessCount, businesses } = params;
  if (!Number.isFinite(ownedBusinessCount) || ownedBusinessCount < 0) return null;
  if (ownedBusinessCount === 0) return null;

  const unsubscribed = businesses.find((b) => !b.hasActiveSubscription);
  if (unsubscribed) {
    return getSubscriptionPageUrl(unsubscribed.id);
  }
  return "/dashboard";
}

/**
 * Data access needed to decide the onboarding redirect. Injected so the decision is unit-testable
 * without a database and so this module stays free of server-only imports (it is also used by a
 * client component).
 */
export type OnboardingBusinessSource = {
  /** Owned businesses with their subscription state (primary read). */
  listOwnedBusinesses: (userId: string) => Promise<BusinessSubscriptionStatus[]>;
  /** Owned business count (cheaper fallback when the primary read fails). */
  countOwnedBusinesses: (userId: string) => Promise<number>;
};

/**
 * Decide where /onboarding should send an authenticated user.
 *
 * Next.js implements `redirect()` by throwing a NEXT_REDIRECT signal, so a page must never call it
 * inside try/catch — a catch block swallows the signal and the onboarding form renders instead of
 * redirecting. All fallible data access therefore happens here, and this function only *returns*
 * the destination; the page calls `redirect()` outside any try/catch.
 *
 * - primary read ok:      0 businesses => null (stay on onboarding)
 *                         first unsubscribed business => /dashboard/subscription?businessId=...
 *                         all active => /dashboard
 * - primary read failed:  count > 0 => /dashboard, else null
 * - both reads failed:    null (stay on onboarding; never throws)
 *
 * The result is never "/onboarding", and only account-with-business states leave onboarding while
 * the dashboard only sends account-without-business states here, so no redirect loop is possible.
 */
export async function resolveOnboardingDestination(userId: string, source: OnboardingBusinessSource): Promise<string | null> {
  try {
    const businesses = await source.listOwnedBusinesses(userId);
    return resolveOnboardingRedirect({ ownedBusinessCount: businesses.length, businesses });
  } catch {
    // fall through to the count-only fallback
  }
  try {
    const owned = await source.countOwnedBusinesses(userId);
    return onboardingRedirectTarget(owned);
  } catch {
    return null;
  }
}

/**
 * Legacy simple helpers retained for backward compatibility with existing layout files.
 */
export function dashboardRedirectTarget(ownedBusinessCount: number): "/onboarding" | null {
  if (!Number.isFinite(ownedBusinessCount) || ownedBusinessCount < 0) return null;
  return ownedBusinessCount === 0 ? "/onboarding" : null;
}

export function onboardingRedirectTarget(ownedBusinessCount: number): "/dashboard" | null {
  if (!Number.isFinite(ownedBusinessCount) || ownedBusinessCount < 0) return null;
  return ownedBusinessCount > 0 ? "/dashboard" : null;
}
