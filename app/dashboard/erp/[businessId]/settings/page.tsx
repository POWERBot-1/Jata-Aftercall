import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadSettings } from "@/lib/erp/loaders";
import { Badge, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { ERP_PERMISSIONS, ERP_ROLES } from "@/lib/erp/access";
import { INDUSTRY_PACKS } from "@/lib/erp/industryPacks";
import { ERP_PLAN_COMMERCIALS } from "@/lib/erp/entitlement";
import { bootstrapWorkspaceAction, saveBusinessProfileAction, startErpPlanAction, updateTeamRoleAction } from "../actions";
import { ASSIGNABLE_ROLES, TEAM_ROLE_GUIDE, parseTeamRoles } from "@/lib/erp/team";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Settings.
 *
 * The workspace setup runs once and is idempotent; the business profile feeds every document; the
 * plan shows what a payment actually bought. No screen here can mark a subscription active.
 */
export default async function SettingsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadSettings(businessId);
  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const configuration = data.configuration;
  const entitled = workspace.entitlement.entitled;

  return (
    <>
      <PageHead
        title="Settings and plan"
        description="Workspace configuration, business details, the industry pack, your team's roles and what the subscription does and does not include."
        actions={<Badge tone={entitled ? "good" : "warn"}>{humanise(workspace.entitlement.status)}</Badge>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <section className="erp-card" id="workspace">
        <h2>Workspace</h2>
        <p className="erp-card-sub">
          {configuration
            ? "Your workspace exists. Running setup again only fills in anything missing; it never duplicates a chart of accounts, tax rule or template."
            : "Create the chart of accounts, dated tax rules, messaging wallet and starter templates for this business."}
        </p>
        <form action={bootstrapWorkspaceAction}>
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="industryPackKey" value={configuration?.industryPackKey ?? "retail"} />
          <button type="submit" className="erp-btn erp-btn-dark">
            {configuration ? "Run setup checks" : "Create my ERP workspace"}
          </button>
        </form>
        {configuration ? (
          <ul className="erp-list" style={{ marginTop: 12 }}>
            <li><span className="erp-muted erp-small">Storefront slug</span><span className="erp-mono">{configuration.storefrontSlug ?? "Not set"}</span></li>
            <li><span className="erp-muted erp-small">Created</span><span className="erp-small">{formatDate(configuration.createdAt)}</span></li>
            <li><span className="erp-muted erp-small">Messaging kill switch</span><span className="erp-small erp-strong">{killSwitch(configuration.featureFlagsJson)}</span></li>
          </ul>
        ) : null}
      </section>

      <section className="erp-card" id="business">
        <h2>Business details</h2>
        <p className="erp-card-sub">These appear on invoices and in the Sender ID application. The KRA PIN is used for validation only.</p>
        <form action={saveBusinessProfileAction}>
          <input type="hidden" name="businessId" value={businessId} />
          <div className="erp-row">
            <div className="erp-field" style={{ flex: "2 1 280px" }}>
              <label className="erp-label" htmlFor="legalName">Legal business name</label>
              <input id="legalName" name="legalName" className="erp-input" defaultValue={configuration?.legalName ?? data.business?.name ?? ""} required minLength={2} />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="kraPin">KRA PIN</label>
              <input id="kraPin" name="kraPin" className="erp-input" defaultValue={configuration?.kraPin ?? ""} placeholder="P051234567X" maxLength={11} />
              <p className="erp-hint">Format is checked locally. We do not claim to verify it with KRA.</p>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="county">County</label>
              <input id="county" name="county" className="erp-input" defaultValue={configuration?.county ?? ""} placeholder="Nairobi" />
            </div>
          </div>
          <div className="erp-row">
            <div className="erp-field">
              <label className="erp-label" htmlFor="industryPackKey">Industry pack</label>
              <select id="industryPackKey" name="industryPackKey" className="erp-select" defaultValue={configuration?.industryPackKey ?? "retail"}>
                {INDUSTRY_PACKS.map((pack) => (
                  <option key={pack.key} value={pack.key}>{pack.label} — {pack.status}</option>
                ))}
              </select>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="timeZone">Time zone</label>
              <select id="timeZone" name="timeZone" className="erp-select" defaultValue={configuration?.timeZone ?? "Africa/Nairobi"}>
                <option value="Africa/Nairobi">Africa/Nairobi (UTC+3)</option>
              </select>
              <p className="erp-hint">Only Nairobi is enabled in this release; it is what quiet hours and dates use.</p>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="currencyCode">Currency</label>
              <select id="currencyCode" name="currencyCode" className="erp-select" defaultValue={configuration?.currencyCode ?? "KES"}>
                <option value="KES">KES — Kenyan shilling</option>
              </select>
            </div>
          </div>
          <button type="submit" className="erp-btn erp-btn-primary">Save business details</button>
        </form>
      </section>

      <section className="erp-card" id="plan">
        <h2>Plan and billing</h2>
        <p className="erp-card-sub">POS / ERP - PRO is KES {formatNumber(workspace.plan.priceKES)} per month, billed per business.</p>
        <dl className="erp-grid erp-grid-3">
          <div className="erp-kpi"><dt>Status</dt><dd>{humanise(workspace.entitlement.status)}</dd><small>{workspace.entitlement.reason}</small></div>
          <div className="erp-kpi"><dt>Renews</dt><dd>{workspace.entitlement.expiresAt ? formatDate(workspace.entitlement.expiresAt) : "—"}</dd><small>{workspace.entitlement.inGrace ? "Inside the approved grace window" : "Monthly term"}</small></div>
          <div className="erp-kpi"><dt>Subscription</dt><dd>{data.subscription ? humanise(data.subscription.status) : "None"}</dd><small>{data.subscription?.paymentReference ?? "No payment reference"}</small></div>
        </dl>

        <div className="erp-grid erp-grid-2" style={{ marginTop: 14 }}>
          <div>
            <h3>Included</h3>
            <ul className="erp-list">
              {workspace.plan.inclusions.map((item) => <li key={item}><span className="erp-small">{item}</span></li>)}
            </ul>
          </div>
          <div>
            <h3>Not included, and not hidden</h3>
            <ul className="erp-list">
              {workspace.plan.exclusions.map((item) => <li key={item}><span className="erp-small">{item}</span></li>)}
            </ul>
            <p className="erp-hint">{ERP_PLAN_COMMERCIALS.taxes} {ERP_PLAN_COMMERCIALS.renewal}</p>
          </div>
        </div>

        {entitled ? (
          <p className="erp-hint">Your plan is active. Renewal happens when a verified payment is recorded; the workspace never charges you on its own.</p>
        ) : (
          <form action={startErpPlanAction} style={{ marginTop: 14 }}>
            <input type="hidden" name="businessId" value={businessId} />
            <button type="submit" className="erp-btn erp-btn-primary">Continue to payment</button>
            <p className="erp-hint">
              You will complete payment on the existing, verified checkout. Starting checkout does not activate the plan — only a confirmed payment does.
            </p>
          </form>
        )}
      </section>

      <section className="erp-card" id="industry">
        <h2>Industry pack: {workspace.pack.label}</h2>
        <p className="erp-card-sub">{workspace.pack.blurb}</p>
        <p className="erp-small"><Badge tone={workspace.pack.status === "TESTED" ? "good" : workspace.pack.status === "BLOCKED" ? "bad" : "warn"}>{workspace.pack.status}</Badge></p>
        <div className="erp-grid erp-grid-2">
          <div>
            <h3>Workflows in this pack</h3>
            <ul className="erp-list">{workspace.pack.workflows.map((workflow: string) => <li key={workflow}><span className="erp-small">{workflow}</span></li>)}</ul>
          </div>
          <div>
            <h3>Not supported by this pack yet</h3>
            <ul className="erp-list">{workspace.pack.unsupported.map((item: string) => <li key={item}><span className="erp-small">{item}</span></li>)}</ul>
          </div>
        </div>
      </section>

      <section className="erp-card" id="team">
        <h2>Team and roles</h2>
        <p className="erp-card-sub">Permissions are resolved on the server from your business membership. The owner always has full access; everyone else gets an explicit ERP role.</p>
        <div className="erp-table-wrap">
          <table className="erp-table">
            <thead><tr><th>Member</th><th>Business role</th><th>ERP role</th></tr></thead>
            <tbody>
              {data.members.length === 0 ? (
                <tr><td colSpan={3} className="erp-muted">No additional members. The owner has full access.</td></tr>
              ) : null}
              {data.members.map((member: any) => {
                const isOwner = member.userId === workspace.business.ownerId;
                const assigned = parseTeamRoles((data.configuration as any)?.teamRolesJson)[member.userId];
                const effective = isOwner ? "OWNER" : assigned ?? member.role;
                return (
                  <tr key={member.id}>
                    <td className="erp-mono">{member.userId.slice(0, 10)}…</td>
                    <td>{humanise(member.role)}</td>
                    <td>
                      {isOwner ? (
                        <Badge tone="lime">Owner</Badge>
                      ) : workspace.role === "OWNER" || workspace.role === "ADMIN" ? (
                        <form action={updateTeamRoleAction} className="erp-actions" style={{ flexWrap: "nowrap" }}>
                          <input type="hidden" name="businessId" value={businessId} />
                          <input type="hidden" name="userId" value={member.userId} />
                          <select name="role" className="erp-select" defaultValue={effective} aria-label={`ERP role for ${member.userId.slice(0, 8)}`} style={{ minWidth: 130 }}>
                            {ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>{humanise(role)}</option>
                            ))}
                          </select>
                          <button type="submit" className="erp-btn erp-btn-secondary erp-btn-sm">Save</button>
                        </form>
                      ) : (
                        <span>{humanise(effective)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="erp-small erp-strong" style={{ cursor: "pointer" }}>What each role can do ({ERP_PERMISSIONS.length} permissions)</summary>
          <ul className="erp-list" style={{ marginTop: 8 }}>
            {ERP_PERMISSIONS.map((permission) => (
              <li key={permission.key}>
                <span className="erp-small">{permission.label}</span>
                <span className={permission.risk === "high" ? "erp-badge" : "erp-muted erp-small"} data-tone={permission.risk === "high" ? "warn" : undefined}>{permission.risk}</span>
              </li>
            ))}
          </ul>
          <ul className="erp-list" style={{ marginTop: 8 }}>
            {TEAM_ROLE_GUIDE.map((entry) => (
              <li key={entry.role}>
                <span className="erp-small"><strong>{entry.label}</strong> — {entry.summary}</span>
              </li>
            ))}
          </ul>
          <p className="erp-hint">Roles: {ERP_ROLES.join(", ")}. Ownership is not a role you can grant here; it follows who owns the business. Nobody can change their own role, so a mistake cannot lock the last administrator out.</p>
        </details>
      </section>

      <section className="erp-card" id="audit">
        <h2>Audit trail</h2>
        <p className="erp-card-sub">Recent privileged actions. Secret-looking values are redacted before they are stored.</p>
        {data.auditEvents.length === 0 ? (
          <p className="erp-hint">Nothing recorded yet.</p>
        ) : (
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead><tr><th>When</th><th>Action</th><th>Target</th><th>Outcome</th><th>Actor</th></tr></thead>
              <tbody>
                {data.auditEvents.map((event: any) => (
                  <tr key={event.id}>
                    <td className="erp-small">{formatDateTime(event.createdAt)}</td>
                    <td className="erp-small erp-strong">{humanise(event.action)}</td>
                    <td className="erp-small">{humanise(event.targetType)}{event.targetId ? ` · ${String(event.targetId).slice(0, 10)}…` : ""}</td>
                    <td><Badge tone={StatusTone(event.outcome)}>{humanise(event.outcome)}</Badge></td>
                    <td className="erp-small">{event.actorName ?? (event.actorId ? `${String(event.actorId).slice(0, 8)}…` : "System")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="erp-hint">This trail is append-only from the application. It is not a substitute for database-level audit logging, which is on the hardening list.</p>
      </section>

      <section className="erp-card">
        <h2>Your data</h2>
        <p className="erp-card-sub">Export what you have entered. Exports are yours; they contain personal data and are not emailed anywhere automatically.</p>
        <div className="erp-actions">
          <a href={`/api/erp/${businessId}/export`} className="erp-btn erp-btn-secondary erp-btn-sm">Download JSON export</a>
          <a href="/erp/contacts-template.csv" className="erp-btn erp-btn-ghost erp-btn-sm" download>Contact import template</a>
        </div>
        <p className="erp-hint">
          Exporting does not delete anything. Retention follows your tax obligations; ask your accountant before deleting business records.
        </p>
      </section>
    </>
  );
}

function killSwitch(json: string | null | undefined): string {
  try {
    const flags = JSON.parse(json || "{}");
    return flags.messagingKillSwitch ? "On — nothing sends" : "Off";
  } catch {
    return "Unknown (invalid flag JSON)";
  }
}
