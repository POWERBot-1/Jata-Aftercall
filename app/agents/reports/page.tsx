import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import AgentReferralReports from "@/components/agents/AgentReferralReports";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Referral report snapshots — JATA AFTERCALL" };

/**
 * The agent's OWN referral report snapshots, read through the authorised API.
 *
 * Every request authorises itself. There is deliberately no administrator read path here: an ADMIN
 * account without its own active agent application sees the denial panel, and nothing about any
 * other agent is rendered or fetched. The API repeats the same active-agent check and scopes every
 * query to the caller's own application.
 */
export default async function AgentReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=agents");

  let eligible = false;
  try {
    const application = await prisma.agentApplication.findUnique({
      where: { userId: session.userId },
      select: { status: true, agentStatus: true },
    });
    eligible = application?.status === "PENDING" && application.agentStatus === "ACTIVE";
  } catch {
    return (
      <MarketingLayout signedIn eyebrow="Agent programme" title="Referral report snapshots" intro="Your own referral evidence, by completed period.">
        <MarketingSection title="Temporarily unavailable" id="unavailable">
          <div className="mk-prose jata-motion-section"><p role="alert">We could not check your agent access. Please try again later.</p><Link href="/agents/reports">Try again</Link></div>
        </MarketingSection>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout signedIn eyebrow="Agent programme" title="Referral report snapshots" intro="Your own referral evidence, by completed period.">
      <MarketingSection title={eligible ? "Your snapshots" : "Access"} id="reports">
        <div className="mk-prose jata-motion-section">
          {!eligible ? (
            <>
              <p>An active agent account is required to view referral report snapshots. No report data is shown for this account.</p>
              <p><Link href="/agents/dashboard">Return to your application status</Link></p>
            </>
          ) : process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED !== "true" ? (
            <p role="status">Referral report snapshots are not switched on for this service.</p>
          ) : (
            <AgentReferralReports />
          )}
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
