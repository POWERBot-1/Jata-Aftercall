import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadAccounting, loadInvoices, loadMessagingOverview } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { Badge, EmptyState, Kpi, Notice, StatusTone, humanise } from "@/components/erp/ErpBits";
import { formatDate, formatNumber, nairobiHour } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Home.
 *
 * Answers one question — "what needs me today?" — with a checklist derived from stored facts, six
 * action cards and a small number of figures that came from the ledger and from provider reports.
 * A brand-new workspace sees setup, not a wall of zeros.
 */
export default async function ErpHomePage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const workspace = await loadErpWorkspace(businessId);
  const [accounting, invoices, messaging] = await Promise.all([
    loadAccounting(businessId),
    loadInvoices(businessId),
    loadMessagingOverview(businessId),
  ]);

  const base = workspace.basePath;
  const nextStep = workspace.onboarding.nextStep;
  const revenue = invoices.invoices
    .filter((invoice: any) => invoice.status !== "DRAFT" && invoice.status !== "VOIDED")
    .reduce((total: number, invoice: any) => total + Number(invoice.totalCents ?? 0), 0);
  const recentCampaigns = messaging.campaigns.slice(0, 3);

  return (
    <>
      <section className="erp-hero">
        <span className="erp-hero-chip">{workspace.pack.label} · {workspace.pack.status.toLowerCase().replace(/_/g, " ")}</span>
        <h1>{greeting()}, {workspace.business.name.split(" ")[0]}.</h1>
        <p>{workspace.onboarding.headline}</p>
        <div className="erp-progress" style={{ marginTop: 16, maxWidth: 420 }} aria-hidden="true">
          <span style={{ width: `${workspace.onboarding.percent}%` }} />
        </div>
        <p style={{ marginTop: 8, fontSize: "0.8rem", color: "#c8cfbc" }}>
          {workspace.onboarding.completed} of {workspace.onboarding.total} setup steps done
        </p>
        <div className="erp-actions">
          {nextStep ? (
            <Link href={`${base}${nextStep.path}`} className="erp-btn erp-btn-primary">{nextStep.label} →</Link>
          ) : null}
          <Link href={`${base}/onboarding`} className="erp-btn erp-btn-secondary">Guided setup</Link>
          <Link href={`${base}/settings`} className="erp-btn erp-btn-ghost">Manage business</Link>
        </div>
      </section>

      {workspace.notice ? (
        <Notice tone={workspace.notice.tone} action={workspace.notice.href ? { href: workspace.notice.href, label: "Open" } : null}>
          {workspace.notice.text}
        </Notice>
      ) : null}

      <section aria-labelledby="checklist-heading" className="erp-card">
        <div className="erp-page-head">
          <div>
            <h2 id="checklist-heading" style={{ marginBottom: 2 }}>Your setup checklist</h2>
            <p className="erp-card-sub" style={{ marginBottom: 0 }}>
              Each step completes when the record behind it exists. Nothing here is ticked by visiting a screen.
            </p>
          </div>
          <div className="erp-actions" style={{ flexWrap: "nowrap" }}>
            <span className="erp-badge">{workspace.onboarding.percent}%</span>
            <Link href={`${base}/onboarding`} className="erp-btn erp-btn-ghost erp-btn-sm">Open guided setup</Link>
          </div>
        </div>
        <ul className="erp-checklist" style={{ marginTop: 14 }}>
          {workspace.onboarding.steps.map((step) => (
            <li key={step.key} data-status={step.status}>
              <span className="erp-check-dot" aria-hidden="true">
                {step.status === "DONE" ? "✓" : step.status === "WAITING" ? "…" : step.index + 1}
              </span>
              <div className="erp-check-body">
                <strong>{step.label}</strong>
                <span>{step.note ?? step.description}</span>
                {step.status === "NEXT" && step.meanwhile ? <span className="erp-hint">While you wait: {step.meanwhile}</span> : null}
              </div>
              {step.status === "DONE" ? (
                <span className="erp-badge" data-tone="good">Done</span>
              ) : step.status === "WAITING" ? (
                <span className="erp-badge" data-tone="warn">Waiting</span>
              ) : (
                <Link href={`${base}${step.path}`} className="erp-btn erp-btn-sm erp-btn-secondary">
                  {step.status === "NEXT" ? "Continue" : "Open"}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" style={{ fontSize: "1rem", margin: "0 0 10px" }}>What would you like to do?</h2>
        <div className="erp-card-grid">
          {workspace.cards.map((card) => (
            <Link key={card.key} href={card.href} className="erp-action-card">
              <strong>{card.title}</strong>
              <span>{card.description}</span>
              <div className="erp-card-foot">
                <span className="erp-badge" data-tone={card.status === "done" ? "good" : card.status === "waiting" ? "warn" : card.status === "blocked" ? "bad" : "neutral"}>
                  {card.statusLabel}
                </span>
                <span className="erp-small erp-strong">{card.nextAction} · {card.effort}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="erp-grid erp-grid-2" aria-label="At a glance">
        <div className="erp-card">
          <h2>Money</h2>
          <p className="erp-card-sub">From issued invoices and the ledger. Drafts are excluded.</p>
          <dl className="erp-grid erp-grid-2" style={{ gap: 10 }}>
            <Kpi label="Invoiced" value={formatCentsShort(revenue)} hint={`${invoices.invoices.length} invoices`} />
            <Kpi label="Outstanding" value={formatCentsShort(invoices.ageing.totalCents)} hint={`${workspace.counts.overdueInvoices} overdue`} />
            <Kpi label="Book balance" value={accounting.trialBalance.balanced ? "Balanced" : "Check books"} hint={`${accounting.trialBalance.rows.length} accounts with movement`} />
            <Kpi label="Net profit (YTD)" value={formatCentsShort(accounting.profitAndLoss.netProfitCents)} hint="Income less expenses" />
          </dl>
          <div className="erp-actions" style={{ marginTop: 14 }}>
            <Link href={`${base}/invoices`} className="erp-btn erp-btn-sm erp-btn-secondary">Invoices</Link>
            <Link href={`${base}/accounting`} className="erp-btn erp-btn-sm erp-btn-secondary">Books</Link>
            <Link href={`${base}/expenses`} className="erp-btn erp-btn-sm erp-btn-secondary">Expenses</Link>
          </div>
        </div>

        <div className="erp-card">
          <h2>Messaging</h2>
          <p className="erp-card-sub">Provider-reported delivery. A delivered message is not a read message or a purchase.</p>
          <dl className="erp-grid erp-grid-2" style={{ gap: 10 }}>
            <Kpi label="Eligible contacts" value={String(workspace.counts.contactsWithMarketingConsent)} hint={`${workspace.counts.contacts} contacts in total`} />
            <Kpi label="Wallet available" value={formatCentsShort(messaging.wallet.availableCents)} hint="Reserved credit is excluded" />
            <Kpi label="Delivered" value={String(messaging.stats.delivered)} hint={`${messaging.stats.failed} failed · ${messaging.stats.unknown} unknown`} />
            <Kpi label="Spent" value={formatCentsShort(messaging.stats.spentCents)} hint={`${messaging.stats.segments} segments`} />
          </dl>
          <div className="erp-actions" style={{ marginTop: 14 }}>
            <Link href={`${base}/messaging/new`} className="erp-btn erp-btn-sm erp-btn-primary">New campaign</Link>
            <Link href={`${base}/customers`} className="erp-btn erp-btn-sm erp-btn-secondary">Customers</Link>
            <Link href={`${base}/sender-identity`} className="erp-btn erp-btn-sm erp-btn-secondary">Sender ID</Link>
          </div>
        </div>
      </section>

      <section className="erp-card" aria-labelledby="campaigns-heading">
        <div className="erp-page-head">
          <div>
            <h2 id="campaigns-heading" style={{ marginBottom: 2 }}>Recent campaigns</h2>
            <p className="erp-card-sub" style={{ marginBottom: 0 }}>Statuses come from the queue and the provider&apos;s callbacks.</p>
          </div>
          <Link href={`${base}/messaging`} className="erp-btn erp-btn-sm erp-btn-secondary">All campaigns</Link>
        </div>
        {recentCampaigns.length === 0 ? (
          <div style={{ marginTop: 12 }}>
            <EmptyState glyph="✉" title="No campaigns yet" action={{ href: `${base}/messaging/new`, label: "Draft your first campaign" }}>
              Drafting is free. You will see the exact recipient count and estimated cost before anything is approved.
            </EmptyState>
          </div>
        ) : (
          <div className="erp-table-wrap" style={{ marginTop: 12 }}>
            <table className="erp-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th className="num">Recipients</th>
                  <th className="num">Estimated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recentCampaigns.map((campaign: any) => (
                  <tr key={campaign.id}>
                    <td>{campaign.name}</td>
                    <td>{humanise(campaign.channel)}</td>
                    <td><Badge tone={StatusTone(campaign.status)}>{humanise(campaign.status)}</Badge></td>
                    <td className="num">{Number(campaign.eligibleRecipients ?? 0)}</td>
                    <td className="num">{formatCentsShort(campaign.estimatedCostCents)}</td>
                    <td className="num"><Link href={`${base}/messaging/${campaign.id}`} className="erp-small erp-strong">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="erp-grid erp-grid-3" aria-label="Plan and pack">
        <div className="erp-card">
          <h2>Your plan</h2>
          <p className="erp-card-sub">KES {formatNumber(workspace.plan.priceKES)} per month, billed to the business.</p>
          <p className="erp-small">
            <strong>Status:</strong> {humanise(workspace.entitlement.status)}
            {workspace.entitlement.expiresAt ? ` · renews ${formatDate(workspace.entitlement.expiresAt)}` : ""}
          </p>
          <ul className="erp-list">
            {workspace.plan.inclusions.slice(0, 4).map((item) => (
              <li key={item}><span className="erp-small">{item}</span></li>
            ))}
          </ul>
          <Link href={`${base}/settings#plan`} className="erp-btn erp-btn-sm erp-btn-secondary" style={{ marginTop: 10 }}>Plan and billing</Link>
        </div>
        <div className="erp-card">
          <h2>{workspace.pack.label}</h2>
          <p className="erp-card-sub">{workspace.pack.blurb}</p>
          <p className="erp-small"><Badge tone={workspace.pack.status === "TESTED" ? "good" : workspace.pack.status === "BLOCKED" ? "bad" : "warn"}>{humanise(workspace.pack.status)}</Badge></p>
          <ul className="erp-list">
            {workspace.pack.modules.slice(0, 5).map((module: string) => (
              <li key={module}><span className="erp-small">{humanise(module)}</span></li>
            ))}
          </ul>
          <Link href={`${base}/settings#industry`} className="erp-btn erp-btn-sm erp-btn-secondary" style={{ marginTop: 10 }}>Change industry pack</Link>
        </div>
        <div className="erp-card">
          <h2>Compliance</h2>
          <p className="erp-card-sub">Readiness for Kenyan tax obligations. Not a certification.</p>
          <p className="erp-small">
            eTIMS invoice submission is <strong>not enabled</strong>. The workspace prepares records; it does not claim KRA acceptance.
          </p>
          <Link href={`${base}/compliance`} className="erp-btn erp-btn-sm erp-btn-secondary" style={{ marginTop: 10 }}>Open Compliance Centre</Link>
        </div>
      </section>
    </>
  );
}

function greeting(): string {
  const hour = nairobiHour();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
