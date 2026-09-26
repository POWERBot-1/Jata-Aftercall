/** Dashboard sends an authenticated account with no business into onboarding. */
export function dashboardRedirectTarget(ownedBusinessCount: number): "/onboarding" | null {
  if (!Number.isFinite(ownedBusinessCount) || ownedBusinessCount < 0) return null;
  return ownedBusinessCount === 0 ? "/onboarding" : null;
}

/** Onboarding sends an account that already has a business back to the dashboard. */
export function onboardingRedirectTarget(ownedBusinessCount: number): "/dashboard" | null {
  if (!Number.isFinite(ownedBusinessCount) || ownedBusinessCount < 0) return null;
  return ownedBusinessCount > 0 ? "/dashboard" : null;
}
