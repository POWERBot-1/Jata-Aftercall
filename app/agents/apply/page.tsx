import type { Metadata } from "next";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";
import { referralLifetimeSeconds } from "@/lib/agents/referral-registration";
import ApplicationForm from "@/components/agents/ApplicationForm";

export const metadata: Metadata = { title: "Agent application — JATA AFTERCALL", referrer: "no-referrer" };

export const dynamic = "force-dynamic";
export default async function AgentApplicationPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const params = await searchParams;
  const referralCode = referralLifetimeSeconds() && typeof params.ref === "string" && /^[A-Za-z0-9_-]{43}$/.test(params.ref) ? params.ref : "";
  return <MarketingLayout eyebrow="Agent programme" title="Apply to become an agent" intro="Register your interest using an existing JATA AFTERCALL account.">
    <MarketingSection title="Your application" id="application"><ApplicationForm referralCode={referralCode} /></MarketingSection>
  </MarketingLayout>;
}
