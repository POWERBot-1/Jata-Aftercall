import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = { title: "Agent programme — JATA AFTERCALL" };

export default function AgentsPage() {
  return (
    <MarketingLayout
      eyebrow="Agent programme"
      title="Become a JATA AFTERCALL Agent"
      intro="Connect businesses with JATA AFTERCALL and help them discover tools for reaching customers."
    >
      <MarketingSection title="Programme availability" id="availability">
        <div className="mk-prose">
          <p>Applications can be submitted using an existing account, but phone verification, agent activation, referral links and the agent dashboard are not yet available.</p>
          <p>Submitting an application does not activate you as an agent. Programme terms and verification must be available before activation.</p>
        </div>
        <div className="mk-btn-row"><Link href="/agents/apply" className="mk-btn">Apply using an existing account</Link></div>
      </MarketingSection>
      <MarketingSection title="How the programme is intended to work" id="how-it-works" tone="cream">
        <div className="mk-prose">
          <p>Agents will be able to introduce businesses directly. Recruiting another agent is separate from referring a business and does not automatically earn a reward.</p>
          <p>Registration alone will not guarantee a commission. Eligibility will depend on verified transactions and approved programme rules. Commission rates, payment schedules and payout arrangements have not been activated.</p>
          <p>Agents will be expected to respect privacy, obtain appropriate consent and give businesses accurate information. Eligibility and the agent agreement will be provided before applications open.</p>
        </div>
        <div className="mk-btn-row">
          <Link href="/privacy" className="mk-btn mk-btn--ghost">Privacy policy</Link>
          <Link href="/terms" className="mk-btn mk-btn--ghost">Terms of service</Link>
          <Link href="/contact" className="mk-btn mk-btn--ghost">Support options</Link>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
