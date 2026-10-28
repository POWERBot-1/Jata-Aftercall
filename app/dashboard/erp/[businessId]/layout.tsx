import Link from "next/link";
import type { ReactNode } from "react";
import { loadErpPage } from "@/lib/erp/workspace";
import { ErpSidebarGroup, ErpMobileBar } from "@/components/erp/ErpNavLink";
import { Badge } from "@/components/erp/ErpBits";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The POS / ERP - PRO shell.
 *
 * One authorisation and one workspace read per request, shared by the sidebar, the header and the
 * page. The tenant comes from the session and the URL segment only. A business that does not exist
 * and a business this person may not open look the same from here, so the shell cannot be used to
 * probe for other tenants.
 */

type Props = { children: ReactNode; params: Promise<{ businessId: string }> };

export default async function ErpLayout({ children, params }: Props) {
  const { businessId } = await params;
  const gate = await loadErpPage(businessId);

  if (!gate.workspace) {
    return (
      <div className="erp">
        <main className="erp-content" style={{ paddingTop: 48 }}>
          <section className="erp-card" style={{ maxWidth: 560 }}>
            <p className="erp-badge" data-tone={gate.refusal.status >= 500 ? "warn" : "bad"}>POS / ERP - PRO</p>
            <h1 style={{ fontSize: "1.4rem", margin: "12px 0 6px" }}>We can&apos;t open this workspace</h1>
            <p className="erp-muted" style={{ fontSize: "0.9rem" }}>{gate.refusal.message}</p>
            <div className="erp-actions" style={{ marginTop: 18 }}>
              <Link href="/dashboard/erp" className="erp-btn erp-btn-dark">Choose a business</Link>
              <Link href="/dashboard" className="erp-btn erp-btn-secondary">Back to dashboard</Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const workspace = gate.workspace;
  const entitled = workspace.entitlement.entitled;
  const planLabel = entitled ? "PRO active" : workspace.entitlement.lifecycle === "AWAITING_PAYMENT" ? "Payment due" : "Setup";

  return (
    <div className="erp">
      <div className="erp-layout">
        <aside className="erp-sidebar" aria-label="POS ERP PRO">
          <div className="erp-brand">
            <span className="erp-brand-mark" aria-hidden="true">P</span>
            <div>
              <div className="erp-brand-name">POS / ERP - PRO</div>
              <div className="erp-brand-sub">Premium workspace</div>
            </div>
          </div>

          <div className="erp-side-business">
            <strong>{workspace.business.name}</strong>
            <span>{workspace.pack.label}</span>
          </div>

          <ErpSidebarGroup heading="Overview" items={[workspace.nav.primary[0], ...workspace.nav.primary.slice(1)].filter(Boolean)} />
          {workspace.nav.groups.map((group) => (
            <ErpSidebarGroup key={group.key} heading={group.label} items={group.items} />
          ))}

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="erp-nav-heading">Workspace</span>
            <Link href={`${workspace.basePath}/settings`} className="erp-nav-link">
              <span className="erp-nav-glyph" aria-hidden="true">☷</span>
              <span>Settings and plan</span>
            </Link>
            <Link href="/dashboard/erp" className="erp-nav-link">
              <span className="erp-nav-glyph" aria-hidden="true">⇆</span>
              <span>Switch business</span>
            </Link>
          </div>

          <div className="erp-side-foot">
            <div style={{ marginBottom: 6 }}>
              <span className="erp-badge" data-tone={entitled ? "lime" : "warn"}>{planLabel}</span>
            </div>
            <div>KES {formatNumber(workspace.plan.priceKES)} / month for the ERP workspace.</div>
            <div style={{ marginTop: 4 }}>Provider and network fees are separate.</div>
          </div>
        </aside>

        <div className="erp-main">
          <header className="erp-topbar">
            <div>
              <div className="erp-crumbs">{workspace.business.name}</div>
              <div className="erp-topbar-title">POS / ERP - PRO</div>
            </div>
            <div className="erp-topbar-actions">
              <Badge tone={entitled ? "good" : "warn"}>{entitled ? "Plan active" : workspace.entitlement.status.toLowerCase().replace(/_/g, " ")}</Badge>
              <Link href={`${workspace.basePath}/messaging/new`} className="erp-btn erp-btn-primary erp-btn-sm">New campaign</Link>
              <Link href={`/dashboard/pos/${workspace.business.id}`} className="erp-btn erp-btn-secondary erp-btn-sm">Business POS</Link>
            </div>
          </header>

          {!entitled ? (
            <div style={{ padding: "14px 22px 0" }}>
              <div className="erp-notice" data-tone="warn">
                <div>
                  <strong>Setup mode.</strong> {workspace.entitlement.reason} You can explore the workspace and prepare data; sending, posting and storefront orders stay switched off until the plan is active.
                </div>
                <Link href={`${workspace.basePath}/settings#plan`}>See the plan</Link>
              </div>
            </div>
          ) : null}

          <main className="erp-content">{children}</main>

          <footer className="erp-footer">
            <p style={{ margin: 0 }}>
              POS / ERP - PRO · every figure on these screens came from your records. Delivery results are provider-reported, and tax notes are not statutory advice.
            </p>
          </footer>
        </div>
      </div>

      <ErpMobileBar items={workspace.nav.bottom} />
    </div>
  );
}
