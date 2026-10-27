import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/adminGuard";
import { TeamAccessConsole } from "@/components/admin/TeamAccessConsole";
import { WorkspaceHero, WorkspacePanel } from "@/components/workspace/WorkspaceUI";
import { getRecentTeamAccessEvents } from "@/lib/team-access";

export const metadata: Metadata = { title: "Team access" };
export const dynamic = "force-dynamic";

/**
 * ADMIN-ONLY. The page itself is guarded (a layout is not an authorization boundary), and every
 * action is re-checked in `/api/admin/team-access`.
 */
export default async function AdminTeamAccessPage() {
  await requireAdminPage();
  const events = await getRecentTeamAccessEvents();
  return (
    <div className="ws-stack">
      <WorkspaceHero
        compact
        kicker="Administration"
        title="JATA Team Free Access"
        subtitle="Start a trusted phone verification, or revoke a team entitlement. Grants are written only after the signed-in account submits the one-time code. No payment record is created and billing history is never altered."
        meta="Authorised numbers are held server-side only"
      />
      <WorkspacePanel title="Verification workflow">
        <ol className="ws-small list-decimal space-y-1 pl-5">
          <li>Look up the team member&apos;s account email.</li>
          <li>Start a verification and deliver the generated six-digit code to that person by phone or WhatsApp. Never send it by email or chat that is not end-to-end verified.</li>
          <li>Ask them to sign in and enter the code at <code>/dashboard/team-access</code>. The server checks the code, the allowlist and the account&apos;s current number.</li>
          <li>Use <strong>Revoke team access</strong> when a person leaves the team. Ordinary subscription rules then apply again.</li>
        </ol>
      </WorkspacePanel>
      <TeamAccessConsole />
      <WorkspacePanel title="Recent grants and revocations" meta="Append-only audit evidence">
        {events.length === 0 ? (
          <p className="ws-small ws-muted">No team grants or revocations have been recorded yet.</p>
        ) : (
          <ul className="ws-small space-y-1">
            {events.map((event, index) => (
              <li key={`${event.at}-${event.userId}-${index}`}>
                <strong>{event.action.endsWith("REVOKED") ? "Revoked" : "Granted"}</strong> · account {event.userId} · by {event.actorId || "system"} · {event.at}
              </li>
            ))}
          </ul>
        )}
      </WorkspacePanel>
    </div>
  );
}
