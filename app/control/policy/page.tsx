import Link from "next/link";
import { WorkspaceSetupShell } from "@/components/workspace/WorkspaceAuthShell";
import { CONTROL_POLICY_BOUNDARIES, CONTROL_ROLE_CAPABILITY_POLICY, CONTROL_ROLE_POLICY, CONTROL_ROLE_POLICY_COLUMNS } from "@/lib/control/role-policy";
import { CONTROL_PERMISSIONS, CONTROL_ROLE_NAMES } from "@/lib/control/permissions";

export const metadata = { title: "Control authorization policy | JATA AFTERCALL", robots: { index: false, follow: false } };

export default function ControlPolicyPage() {
  return (
    <WorkspaceSetupShell
      title="Control role and permission matrix"
      subtitle="The owner authorized a least-privilege read-only matrix. All 90 decisions are explicit; write, approval and high-impact actions remain denied."
      backHref="/control/sign-in"
      backLabel="Control sign in"
      width="xwide"
      meta={<span className="ws-pill" data-tone="draft">READ-ONLY GRANTS · MFA REQUIRED</span>}
    >
      <div className="ws-stack">
        <section className="ws-panel" aria-labelledby="matrix-title">
          <p className="ws-kicker">Six canonical roles · explicit least privilege</p>
          <h2 id="matrix-title" className="ws-panel__title">Role / action review matrix</h2>
          <p className="ws-muted">Role capabilities are explicit in the server-side matrix. A role assignment alone is insufficient: each request requires an active database grant, exact tenant scope and verified MFA. This page cannot create or change grants.</p>
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
          <h2 id="capabilities-title" className="ws-panel__title">Explicit role/capability decisions</h2>
          <p className="ws-muted">The owner authorized the platform-owner-selected least-privilege matrix. The 90 cells remain explicit ALLOW/DENY decisions. ALLOW is limited to listed read operations; no database grant or identity is created by this page.</p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--ws-border)]" tabIndex={0} aria-label="Scrollable six-role capability authorization matrix">
            <table className="w-full min-w-[900px] border-collapse text-left text-xs">
              <caption className="sr-only">All 90 role by capability policy decisions are explicit; only least-privilege reads are allowed.</caption>
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
                      <td key={role} className="p-3"><span className="ws-pill" data-tone={CONTROL_ROLE_CAPABILITY_POLICY[role][permission] === "ALLOW" ? "success" : "draft"}>{CONTROL_ROLE_CAPABILITY_POLICY[role][permission]}</span></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ws-tiny mt-3">Owner decision record: <code>docs/agents/CONTROL_OWNER_DECISION_PACKAGE.md</code>. No account or database grant has been provisioned. Access remains contingent on an explicit active grant and MFA.</p>
        </section>
        <p className="ws-tiny"><Link className="underline" href="/control">Return to Control</Link></p>
      </div>
    </WorkspaceSetupShell>
  );
}
