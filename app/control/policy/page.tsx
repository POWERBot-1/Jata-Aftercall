import Link from "next/link";
import { WorkspaceSetupShell } from "@/components/workspace/WorkspaceAuthShell";
import { CONTROL_POLICY_BOUNDARIES, CONTROL_ROLE_CAPABILITY_POLICY, CONTROL_ROLE_POLICY, CONTROL_ROLE_POLICY_COLUMNS } from "@/lib/control/role-policy";
import { CONTROL_PERMISSIONS, CONTROL_ROLE_NAMES } from "@/lib/control/permissions";

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
          <p className="ws-kicker">Exact capability vocabulary · 90 effective decisions</p>
          <h2 id="capabilities-title" className="ws-panel__title">Every role/capability cell is denied</h2>
          <p className="ws-muted">Role names alone grant nothing. All 15 recognized capabilities are explicitly DENY for all six roles. The global approval gate remains false; this display does not create grants or enable any route.</p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--ws-border)]" tabIndex={0} aria-label="Scrollable six-role capability denial matrix">
            <table className="w-full min-w-[900px] border-collapse text-left text-xs">
              <caption className="sr-only">All 90 role by capability policy decisions are deny.</caption>
              <thead>
                <tr className="border-b border-[color:var(--ws-border)]">
                  <th scope="col" className="p-3">Capability</th>
                  {CONTROL_ROLE_NAMES.map((role) => <th key={role} scope="col" className="p-3">{role.replaceAll("_", " ")}</th>)}
                </tr>
              </thead>
              <tbody>
                {CONTROL_PERMISSIONS.map((permission) => (
                  <tr key={permission} className="border-b border-[color:var(--ws-border)] last:border-0">
                    <th scope="row" className="p-3 font-mono"><code>{permission}</code></th>
                    {CONTROL_ROLE_NAMES.map((role) => (
                      <td key={role} className="p-3"><span className="ws-pill" data-tone="draft">{CONTROL_ROLE_CAPABILITY_POLICY[role][permission]}</span></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ws-tiny mt-3">Owner decision record: <code>docs/agents/CONTROL_OWNER_DECISION_PACKAGE.md</code>. No production account, grant, or provisioning action has been performed.</p>
        </section>
        <p className="ws-tiny"><Link className="underline" href="/control">Return to Control</Link></p>
      </div>
    </WorkspaceSetupShell>
  );
}
