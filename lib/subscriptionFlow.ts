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
