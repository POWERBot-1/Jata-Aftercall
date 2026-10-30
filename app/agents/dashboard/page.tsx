import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import PhoneVerification from "@/components/agents/PhoneVerification";
import { formatDateTime } from "@/lib/dateFormat";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent application status — JATA AFTERCALL" };

type OwnApplication = { fullName: string; status: string; createdAt: Date; phoneVerifiedAt: Date | null };

/** Every request authorizes itself; do not rely on a parent layout for the tenant boundary. */
export default async function AgentDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=agents");
  let application: OwnApplication | null;
  try {
    application = await prisma.agentApplication.findUnique({
      where: { userId: session.userId },
      select: { fullName: true, status: true, createdAt: true, phoneVerifiedAt: true },
    });
  } catch {
    return <MarketingLayout eyebrow="Agent programme" title="Application status" intro="Your account's agent application.">
      <MarketingSection title="Temporarily unavailable" id="unavailable"><div className="mk-prose"><p role="alert">We could not load your application. Please try again later.</p><Link href="/agents/dashboard">Try again</Link></div></MarketingSection>
    </MarketingLayout>;
  }
  return <MarketingLayout eyebrow="Agent programme" title="Application status" intro="Your account's agent application.">
    <MarketingSection title="Your application" id="application">
      <div className="mk-prose">
        {!application ? <><p>No application is recorded for this account.</p><Link href="/agents/apply">Apply as an agent</Link></> : <>
          <p><strong>Applicant:</strong> {application.fullName}</p>
          <p><strong>Submitted:</strong> {formatDateTime(application.createdAt)} (Africa/Nairobi)</p>
          {application.status === "PENDING" ? <><p><strong>Status:</strong> {application.phoneVerifiedAt ? "Phone verified; awaiting administrator eligibility review." : "Awaiting verification. Your phone has not been verified."} Your agent account is not active.</p>{!application.phoneVerifiedAt && <PhoneVerification />}</> :
            application.status === "ACTIVE" ? <p><strong>Status:</strong> Active after administrator review. Referral and commission tools are not available.</p> :
            application.status === "SUSPENDED" ? <p><strong>Status:</strong> Agent access suspended. Please contact support.</p> :
            application.status === "REJECTED" ? <p><strong>Status:</strong> Application rejected. This account is not active as an agent.</p> :
              <p><strong>Status:</strong> Unavailable. Please contact support for assistance.</p>}
        </>}
      </div>
    </MarketingSection>
    <MarketingSection title="Referrals and commissions" id="programme-status" tone="cream">
      <div className="mk-prose"><p>Referral links, performance reporting and commission records are not available yet. Registration does not guarantee activation or commission. No reward rates or payouts have been activated.</p><Link href="/contact">Support options</Link></div>
    </MarketingSection>
  </MarketingLayout>;
}
