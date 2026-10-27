import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getTeamAccessStatus } from "@/lib/team-access";
import { TeamAccessVerificationForm } from "@/components/TeamAccessVerificationForm";
import { WorkspaceHero, WorkspacePanel } from "@/components/workspace/WorkspaceUI";

export const metadata: Metadata = { title: "Team access" };
export const dynamic = "force-dynamic";

/** No phone number, user id or entitlement flag is accepted from this page's client. */
export default async function TeamAccessPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const status = await getTeamAccessStatus(session.userId);
  return (
    <div className="ws-stack">
      <WorkspaceHero compact kicker="Account" title="JATA Team Free Access" subtitle="Verify the phone number an administrator confirmed for your account. Eligible features are then included without a subscription or payment." meta={status.entitled ? status.label || "Active" : "Not active on this account"} />
      <WorkspacePanel title="Current status">
        <p className="ws-small" data-team-access={status.entitled ? "active" : "inactive"}>
          {status.entitled ? <strong>{status.label}</strong> : "This account uses the standard subscription rules. Verification changes nothing for ineligible accounts."}
        </p>
      </WorkspacePanel>
      <WorkspacePanel title="Enter your verification code">
        <TeamAccessVerificationForm />
      </WorkspacePanel>
    </div>
  );
}
