import Link from "next/link";
import { notFound } from "next/navigation";
import { formatKES, formatDateTime } from "@/lib/format";
import { buildStatement, RECEIVABLE, toCreditEntries } from "@/lib/pos/credit";
import { findCustomer, listCreditEntries, listCustomerAssets, listSales } from "@/lib/pos/store";
import { assetFields } from "@/lib/pos/forms";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { RepaymentPanel } from "@/components/pos/RepaymentPanel";

/**
 * One customer (§14, §30, §46).
 *
 * Their history, what they owe, the statements the configuration offers, and the things they own
 * that this trade tracks — a vehicle, a unit, a pet. All of it inside this tenant only.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string; customerId: string }> };

export default async function PosCustomerDetailPage({ params }: Props) {
  const { businessId, customerId } = await params;
  const workspace = await loadPosWorkspaceCached(businessId);
  const customer = await findCustomer(businessId, customerId);
  if (!customer) notFound();

  const configuration = workspace.configuration;
  const [entries, sales, assets] = await Promise.all([
    configuration.credit.enabled ? listCreditEntries(businessId, { partyType: RECEIVABLE, partyId: customerId, take: 200 }) : Promise.resolve([]),
    listSales(businessId, { customerId, take: 50 }),
    listCustomerAssets(businessId, customerId),
  ]);

  const statement = buildStatement(toCreditEntries(entries, RECEIVABLE), RECEIVABLE);

  const lifetimeKES = (sales as any[]).reduce((total, sale) => total + Number(sale.totalKES ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{workspace.terminology.customer}</p>
          <h2 className="text-xl font-bold">{customer.name}</h2>
          <p className="pos-note">
            {[customer.phone, customer.location, customer.customerNumber].filter(Boolean).join(" · ") || "No contact details yet"}
          </p>
        </div>
        <Link href={`${workspace.basePath}/customers`} className="jata-btn jata-btn-ghost">← All {workspace.terminology.customers.toLowerCase()}</Link>
      </div>

      <dl className="jata-stat-grid">
        <div className="jata-stat"><dt>{workspace.terminology.sales}</dt><dd>{(sales as any[]).length}</dd></div>
        <div className="jata-stat"><dt>Lifetime</dt><dd>{formatKES(lifetimeKES)}</dd></div>
        <div className="jata-stat"><dt>Owes</dt><dd>{formatKES(Number(customer.balanceKES ?? 0))}</dd></div>
        <div className="jata-stat"><dt>Limit</dt><dd>{customer.creditLimitKES ? formatKES(Number(customer.creditLimitKES)) : "—"}</dd></div>
      </dl>

      {configuration.credit.enabled && workspace.permissions.includes("RECORD_REPAYMENT") ? (
        <RepaymentPanel
          businessId={businessId}
          basePath={workspace.basePath}
          customerId={customerId}
          customerName={customer.name}
          balanceKES={Number(customer.balanceKES ?? 0)}
          entitled={workspace.entitlement.entitled}
          words={{ customer: workspace.terminology.customer }}
        />
      ) : null}

      {(sales as any[]).length ? (
        <section className="jata-card p-4">
          <p className="jata-kicker">Recent {workspace.terminology.sales.toLowerCase()}</p>
          <div className="pos-rows mt-2">
            {(sales as any[]).slice(0, 12).map((sale) => (
              <Link className="pos-row" key={sale.id} href={`${workspace.basePath}/sales/${sale.id}`}>
                <div className="pos-row-main">
                  <strong>{sale.receiptNumber}</strong>
                  <small>{formatDateTime(sale.createdAt)}</small>
                </div>
                <div className="pos-row-values">
                  <span>{formatKES(Number(sale.totalKES))}</span>
                  {Number(sale.balanceKES) > 0 ? <span className="pos-pill" data-tone="warn">Owes {formatKES(Number(sale.balanceKES))}</span> : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {configuration.credit.statements && statement.lines.length ? (
        <section className="jata-card p-4">
          <p className="jata-kicker">Statement</p>
          <div className="pos-scroll mt-2">
            <table className="pos-table">
              <thead><tr><th>When</th><th>What</th><th>Owed</th><th>Paid</th><th>Balance</th></tr></thead>
              <tbody>
                {statement.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.date}</td>
                    <td>{line.description}</td>
                    <td>{line.debitKES ? formatKES(line.debitKES) : "—"}</td>
                    <td>{line.creditKES ? formatKES(line.creditKES) : "—"}</td>
                    <td>{formatKES(line.balanceKES)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pos-note mt-2">Closing balance {formatKES(statement.closingBalanceKES)}.</p>
        </section>
      ) : null}

      <section className="jata-card p-4">
        <div className="pos-toolbar">
          <p className="jata-kicker">{assetFields(configuration)[1].label}s</p>
          <Link href={`${workspace.basePath}/customers`} className="jata-btn jata-btn-ghost">Edit details</Link>
        </div>
        {assets.length ? (
          <div className="pos-rows mt-2">
            {(assets as any[]).map((asset) => (
              <div className="pos-row" key={asset.id}>
                <div className="pos-row-main">
                  <strong>{asset.name}</strong>
                  <small>{[asset.label, asset.identifier].filter(Boolean).join(" · ")}</small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="pos-note mt-2">Nothing recorded against this {workspace.terminology.customer.toLowerCase()} yet.</p>
        )}
      </section>
    </div>
  );
}
