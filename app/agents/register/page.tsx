import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";
import AgentRegistrationForm from "@/components/agents/AgentRegistrationForm";
import { referralLifetimeSeconds } from "@/lib/agents/referral-registration";
import { agentRegistrationEnabled } from "@/lib/agent-registration";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent account registration — JATA AFTERCALL", referrer: "no-referrer" };

export default async function AgentRegistrationPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const params = await searchParams;
  const referralCode = referralLifetimeSeconds() && typeof params.ref === "string" && /^[A-Za-z0-9_-]{43}$/.test(params.ref) ? params.ref : "";
  return <MarketingLayout eyebrow="Agent programme" title="Create an agent application" intro="An agent-only account does not require a business page.">
    <MarketingSection title="Registration" id="registration">
      {agentRegistrationEnabled() ? <AgentRegistrationForm referralCode={referralCode} /> : <div className="mk-prose"><p>Agent-only registration is not available yet. Existing account holders can submit an application, but phone verification and activation are not available.</p><Link href="/agents/apply">Apply with an existing account</Link></div>}
    </MarketingSection>
  </MarketingLayout>;
}
