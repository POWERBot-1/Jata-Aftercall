import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";
import AgentRegistrationForm from "@/components/agents/AgentRegistrationForm";
import { agentRegistrationEnabled } from "@/lib/agent-registration";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent account registration — JATA AFTERCALL" };

export default function AgentRegistrationPage() {
  return <MarketingLayout eyebrow="Agent programme" title="Create an agent application" intro="An agent-only account does not require a business page.">
    <MarketingSection title="Registration" id="registration">
      {agentRegistrationEnabled() ? <AgentRegistrationForm /> : <div className="mk-prose"><p>Agent-only registration is not available yet. Existing account holders can submit an application, but phone verification and activation are not available.</p><Link href="/agents/apply">Apply with an existing account</Link></div>}
    </MarketingSection>
  </MarketingLayout>;
}
