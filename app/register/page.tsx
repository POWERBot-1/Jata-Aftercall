import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import RegisterForm from "@/components/RegisterForm";
import Link from "next/link";
import { WorkspaceAuthShell } from "@/components/workspace/WorkspaceAuthShell";
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
    <WorkspaceAuthShell
      title="Create your account"
      subtitle="We open a draft business page with you as the owner. Your page goes live once your subscription payment is confirmed."
      asideTitle={
        <>
          One page your customers can <em>act on</em>.
        </>
      }
      asideCopy="Seven short steps: name, contact, location, services, look, plan and publish. Your answers save as you go, so you can finish today or come back tomorrow."
      points={[
        "No website build and no developer",
        "Pay with M-Pesa or card on Paystack",
        "Shareable link at /b/your-business",
      ]}
      backHref="/"
      backLabel="Home"
      footnote={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-[color:var(--ws-amber-deep)] underline">
            Log in
          </Link>
        </>
      }
    >
      {invite && (
        <p role="status" className="jata-alert mb-3 text-sm" data-tone="success">
          <span>
            You were invited by <span className="font-semibold">{invite.businessName}</span>. You still create your own account,
            your own page and your own plan — nothing is shared between your pages.
          </span>
        </p>
      )}
      <RegisterForm refCode={params.ref ? String(params.ref) : null} />
    </WorkspaceAuthShell>
  );
}
