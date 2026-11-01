import Link from "next/link";
import { WorkspaceSetupShell } from "@/components/workspace/WorkspaceAuthShell";
import { CONTROL_POLICY_BOUNDARIES, CONTROL_ROLE_POLICY, CONTROL_ROLE_POLICY_COLUMNS } from "@/lib/control/role-policy";

export const metadata = { title: "Control authorization policy | JATA AFTERCALL", robots: { index: false, follow: false } };

export default function ControlPolicyPage() {
  return (
    <WorkspaceSetupShell
      title="Control role and permission matrix"
      subtitle="Proposed responsibilities are descriptive only. This is not an approved grant policy or a provisioning instruction."
      backHref="/control/sign-in"
      backLabel="Control sign in"
      width="xwide"
      meta={<span className="ws-pill" data-tone="draft">OWNER APPROVAL PENDING · NO ROLE GRANTS</span>}
    >
      <div className="ws-stack">
        <section className="ws-panel" aria-labelledby="matrix-title">
          <p className="ws-kicker">Six canonical roles · deny by default</p>
          <h2 id="matrix-title" className="ws-panel__title">Role / action review matrix</h2>
          <p className="ws-muted">Descriptions below are tentative role labels, not assigned responsibilities. No permission is derived from the role name. The database currently has no seeded role grants, and this page cannot create, change or approve a grant.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CONTROL_ROLE_POLICY.map(({ role, responsibility }) => (
              <article key={role} className="rounded-xl border border-[color:var(--ws-border)] p-4">
                <h3 className="text-base font-bold">{role.replaceAll("_", " ")}</h3>
                <p className="ws-tiny mt-2"><strong>Proposed responsibility:</strong> {responsibility}</p>
                <dl className="mt-3 space-y-3">
                  {CONTROL_ROLE_POLICY_COLUMNS.map(({ label, value }) => (
                    <div key={label}>
                      <dt className="text-xs font-bold uppercase tracking-wide">{label}</dt>
                      <dd className="ws-tiny mt-1">{value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>
        {CONTROL_POLICY_BOUNDARIES.map(({ title, status, items }) => (
          <section key={title} className="ws-panel" aria-labelledby={`boundary-${title.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
            <p className="ws-kicker">{status}</p>
            <h2 id={`boundary-${title.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}`} className="ws-panel__title">{title}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
              {items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
        <section className="ws-panel" aria-labelledby="capabilities-title">
          <p className="ws-kicker">Exact capability vocabulary</p>
          <h2 id="capabilities-title" className="ws-panel__title">Available capability keys are not role assignments</h2>
          <p className="ws-muted">The repository currently recognizes these explicit keys: <code>businesses.read</code>, <code>businesses.suspend</code>, <code>businesses.reinstate</code>, <code>subscriptions.read</code>, <code>payments.read</code>, <code>agents.read</code>, <code>agents.manage</code>, <code>commissions.read</code>, <code>communications.read</code>, <code>communications.recover</code>, <code>providers.read</code>, <code>providers.configure</code>, <code>audit.read</code>, <code>exceptions.read</code>, and <code>system.health.read</code>. None is assigned by this matrix.</p>
          <p className="ws-tiny mt-3">Owner decision record: <code>docs/agents/OWNER_DECISIONS_AND_ACCEPTANCE.md</code>. No production account, grant, or provisioning action has been performed.</p>
        </section>
        <p className="ws-tiny"><Link className="underline" href="/control">Return to Control</Link></p>
      </div>
    </WorkspaceSetupShell>
  );
}
