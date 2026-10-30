import type { Metadata } from "next";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";
import ApplicationForm from "@/components/agents/ApplicationForm";

export const metadata: Metadata = { title: "Agent application — JATA AFTERCALL" };

export default function AgentApplicationPage() {
  return <MarketingLayout eyebrow="Agent programme" title="Apply to become an agent" intro="Register your interest using an existing JATA AFTERCALL account.">
    <MarketingSection title="Your application" id="application"><ApplicationForm /></MarketingSection>
  </MarketingLayout>;
}
