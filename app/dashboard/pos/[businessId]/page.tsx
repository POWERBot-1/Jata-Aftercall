import Link from "next/link";
import { formatKES } from "@/lib/format";
import { buildDashboardCards, loadCardSources } from "@/lib/pos/dashboard";
import { emptyStateFor } from "@/lib/pos/presentation";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";

/**
 * The dashboard (§34, §60, §61).
 *
 * Generated from the configuration: which cards appear, which quick actions lead, and what the
 * empty state teaches. A business that has not sold yet is told the one next action, not shown a
 * wall of zeros.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string }> };

export default async function PosDashboardPage({ params }: Props) {
  const { businessId } = await params;
  const workspace = await loadPosWorkspaceCached(businessId);
  const sources = await loadCardSources(businessId, workspace.configuration, workspace.dashboardCards);
  const cards = buildDashboardCards(workspace.configuration, workspace.basePath, workspace.dashboardCards, sources);
  const emptyState = emptyStateFor(workspace.configuration, "dashboard", workspace.basePath);
  const terminology = workspace.terminology;

  return (
    <div className="space-y-5">
      <section className="pos-quick">
        {workspace.quickActions.map((action) => (
          <Link
            key={action.key}
            href={action.href}
            className={action.primary ? "jata-btn jata-btn-primary pos-action pos-action-primary" : "jata-btn jata-btn-secondary pos-action"}
          >
            <span aria-hidden="true">{action.icon}</span> {action.label}
          </Link>
        ))}
      </section>

      {cards.length > 0 ? (
        <section aria-label="Today at a glance">
          <dl className="pos-cards">
            {cards.map((card) => (
              <Link key={card.key} href={card.href} className="pos-card" data-tone={card.tone}>
                <dt>{card.label}</dt>
                <dd className="pos-card-value">{card.value}</dd>
                <dd className="pos-card-hint">{card.hint}</dd>
              </Link>
            ))}
          </dl>
        </section>
      ) : null}

      {workspace.counts.sales === 0 ? (
        <section className="jata-card p-5">
          <p className="jata-kicker">Start here</p>
          <h2 className="text-lg font-bold">{emptyState.title}</h2>
          <p className="mt-1 text-sm text-zinc-600">{emptyState.body}</p>
          <Link href={emptyState.action.href} className="jata-btn jata-btn-primary mt-4">{emptyState.action.label}</Link>
        </section>
      ) : null}

      {!workspace.ready || workspace.steps.some((step) => !step.done) ? (
        <section className="jata-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="jata-kicker">Getting set up</p>
              <h2 className="text-lg font-semibold">You can trade before this is finished</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Tick these off when you have a moment. None of them stops you recording a {terminology.sale.toLowerCase()}.
              </p>
            </div>
            <span className="jata-status">
              {workspace.steps.filter((step) => step.done).length}/{workspace.steps.length}
            </span>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {workspace.steps.map((step) => (
              <li key={step.key}>
                <Link href={step.href} className="pos-step" data-done={step.done ? "true" : undefined}>
                  <span aria-hidden="true">{step.done ? "✓" : "○"}</span>
                  <span>
                    <strong>{step.label}</strong>
                    <small>{step.body}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="jata-card p-5">
        <p className="jata-kicker">Today</p>
        <div className="jata-stat-grid mt-3">
          <div className="jata-stat">
            <dt>{terminology.sales}</dt>
            <dd>{workspace.today.count}</dd>
          </div>
          <div className="jata-stat">
            <dt>Taken</dt>
            <dd>{formatKES(workspace.today.totalKES)}</dd>
          </div>
          <div className="jata-stat">
            <dt>Still owed</dt>
            <dd>{formatKES(workspace.today.balanceKES)}</dd>
          </div>
          <div className="jata-stat">
            <dt>Needs stock</dt>
            <dd>{workspace.alerts.lowStock}</dd>
          </div>
        </div>
      </section>
    </div>
  );
}
