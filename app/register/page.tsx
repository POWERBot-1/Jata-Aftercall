import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import RegisterForm from "@/components/RegisterForm";
import { PageShell } from "@/components/ui/PageShell";
import type { Metadata } from "next";
import {
  REFERRAL_COOKIE_NAME,
  findAttributionByToken,
  isReferrerEligible,
  publicReferralInvite,
  resolveReferrerByBusiness,
  resolveReferrerByCode,
} from "@/lib/referral";

export const metadata: Metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

/**
 * Stage 2: only public business data (the name already shown on the public page) is rendered
 * for a referral. Codes, tokens, ids and internal reject reasons never reach the browser.
 */
async function resolveInvite(ref?: string) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(REFERRAL_COOKIE_NAME)?.value ?? null;
    const attribution = token ? await findAttributionByToken(token) : null;
    if (attribution?.referrerBusinessId) {
      const referrer = await resolveReferrerByBusiness(attribution.referrerBusinessId);
      if (isReferrerEligible({ referrer }).eligible) {
        const invite = publicReferralInvite(referrer);
        if (invite) return invite;
      }
    }
    if (ref) {
      const referrer = await resolveReferrerByCode(ref);
      if (isReferrerEligible({ referrer }).eligible) {
        const invite = publicReferralInvite(referrer);
        if (invite) return invite;
      }
    }
  } catch {
    // A referral banner is decoration: never let it break the signup page.
  }
  return null;
}

export default async function RegisterPage({ searchParams }: { searchParams?: Promise<{ ref?: string }> }) {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const params = (await searchParams) || {};
  const invite = await resolveInvite(params.ref);

  return (
    <PageShell title="Create your account" subtitle="We'll open a draft business page with you as the owner. Publish once your subscription payment is confirmed.">
      {invite && (
        <p role="status" className="jata-card mt-6 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          You were invited by <span className="font-semibold">{invite.businessName}</span>. You still create your own
          account, your own page and your own plan — nothing is shared between your pages.
        </p>
      )}
      <RegisterForm refCode={params.ref ? String(params.ref) : null} />
      <p className="mt-4 text-center text-xs text-zinc-500">Already have an account? <a href="/login" className="font-semibold underline">Login</a></p>
    </PageShell>
  );
}
