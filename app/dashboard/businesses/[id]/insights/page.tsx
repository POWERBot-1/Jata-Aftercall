import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { businessSummary, emptySummary } from "@/lib/experience/insights";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { formatKES, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  if (!workspace.experience) redirect(`/dashboard/businesses/${id}`);

  let summary = emptySummary();
  try {
    summary = await businessSummary(id);
  } catch {
    summary = emptySummary();
  }

  const commerce = workspace.profile.capabilities.includes("commerce");
  const booking = workspace.profile.capabilities.includes("booking");

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Insights</h1>
        <p className="text-sm text-zinc-600">What customers looked at, what they bought, and what needs your attention.</p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />

      <section>
        <h2 className="text-sm font-bold">Today</h2>
        <dl className="jata-stat-grid mt-2">
          <div className="jata-stat"><dt>Visitors</dt><dd>{summary.today.visitors}</dd></div>
          {commerce ? (
            <>
              <div className="jata-stat"><dt>Orders</dt><dd>{summary.today.orders}</dd></div>
              <div className="jata-stat"><dt>Sales</dt><dd>{formatKES(summary.today.sales)}</dd></div>
              <div className="jata-stat"><dt>Conversion</dt><dd>{formatPercent(summary.today.paidOrders, summary.today.visitors)}</dd></div>
            </>
          ) : (
            <div className="jata-stat"><dt>Bookings</dt><dd>{summary.today.bookings}</dd></div>
          )}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-bold">Last 7 days</h2>
        <dl className="jata-stat-grid mt-2">
          <div className="jata-stat"><dt>Visitors</dt><dd>{summary.week.visitors}</dd></div>
          <div className="jata-stat"><dt>Item views</dt><dd>{summary.week.productViews + summary.week.serviceViews}</dd></div>
          <div className="jata-stat"><dt>Searches</dt><dd>{summary.week.searches}</dd></div>
          {commerce ? <div className="jata-stat"><dt>Added to cart</dt><dd>{summary.week.addToCart}</dd></div> : null}
          {booking ? <div className="jata-stat"><dt>Bookings</dt><dd>{summary.week.bookings}</dd></div> : null}
        </dl>
      </section>

      {commerce ? (
        <section>
          <h2 className="text-sm font-bold">All time</h2>
          <dl className="jata-stat-grid mt-2">
            <div className="jata-stat"><dt>Sales</dt><dd>{formatKES(summary.totals.sales)}</dd></div>
            <div className="jata-stat"><dt>Orders</dt><dd>{summary.totals.orders}</dd></div>
            <div className="jata-stat"><dt>Customers</dt><dd>{summary.totals.customers}</dd></div>
            <div className="jata-stat"><dt>Returning</dt><dd>{summary.totals.returningCustomers}</dd></div>
          </dl>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="jata-card">
          <h2 className="text-sm font-bold">Most viewed</h2>
          {summary.topProducts.length === 0 && summary.topServices.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Nothing viewed yet. Share your link to start learning.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {summary.topProducts.map((product) => (
                <li key={product.id} className="flex justify-between gap-2">
                  <span className="truncate">{product.name}</span>
                  <span className="shrink-0 text-zinc-600">{product.views} views</span>
                </li>
              ))}
              {summary.topServices.map((service) => (
                <li key={service.id} className="flex justify-between gap-2">
                  <span className="truncate">{service.name}</span>
                  <span className="shrink-0 text-zinc-600">{service.views} views</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="jata-card">
          <h2 className="text-sm font-bold">Needs attention</h2>
          {summary.attention.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Nothing needs fixing right now.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {summary.attention.map((item) => (
                <li key={item.id} className="flex justify-between gap-2">
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 font-semibold text-amber-700">
                    {item.stockStatus === "OUT_OF_STOCK" ? "Out of stock" : "Low stock"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
