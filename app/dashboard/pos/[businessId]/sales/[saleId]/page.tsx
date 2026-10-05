import Link from "next/link";
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { formatKES, formatDateTime } from "@/lib/format";
import { buildReceipt, channelLabel, receiptToText } from "@/lib/pos/receipt";
import { branchRecordInScope, findSale } from "@/lib/pos/store";
import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { RefundPanel } from "@/components/pos/RefundPanel";
import { PosRefusal } from "@/components/pos/PosRefusal";

/**
 * One sale (§27, §32, §54).
 *
 * The receipt is rebuilt from the recorded lines and today's configuration wording, so the owner
 * always sees it the way their business talks. Refunds and voids are separate actions with their
 * own permissions — they never rewrite this record.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string; saleId: string }> };

export default async function PosSaleDetailPage({ params }: Props) {
  const { businessId, saleId } = await params;
  // A receipt is sales data (§32) — the module read is enforced before the sale row is read.
  const gate = await loadPosPageWorkspace(businessId, "VIEW_SALES");
  if (!gate.workspace) return <PosRefusal message={gate.refusal} basePath={gate.basePath} />;
  const workspace = gate.workspace;
  const sale = await findSale(businessId, saleId);
  if (!sale) notFound();
  // A branch-bound clerk reads receipts from its own location only, exactly as
  // `GET /api/pos/:id/sales/:saleId` answers (§16, §75). A guessed receipt id from another
  // branch is not found here rather than rendered, and a group-level receipt stays with
  // headquarters.
  if (!branchRecordInScope(workspace, sale.branchId)) notFound();

  const receipt = buildReceipt({
    config: workspace.configuration,
    business: {
      name: workspace.business.name,
      phone: workspace.business.phone,
      whatsapp: workspace.business.whatsapp,
      location: workspace.business.location,
      logoUrl: workspace.business.logoUrl,
    },
    sale: {
      receiptNumber: sale.receiptNumber,
      issuedAt: sale.createdAt,
      channel: sale.channel,
      cashierName: sale.staffName,
      customer: sale.customerName ? { name: sale.customerName } : null,
      lines: (sale.items ?? []).map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        unitKey: item.unitKey,
        unitPriceKES: item.unitPriceKES,
        discountKES: item.discountKES,
        taxKES: item.taxKES,
        totalKES: item.totalKES,
      })),
      subtotalKES: sale.subtotalKES,
      discountKES: sale.discountKES,
      taxKES: sale.taxKES,
      totalKES: sale.totalKES,
      payments: (sale.payments ?? []).map((payment: any) => ({
        method: payment.method,
        amountKES: payment.direction === "OUT" ? -Number(payment.amountKES) : Number(payment.amountKES),
        reference: payment.reference,
      })),
      balanceKES: sale.balanceKES,
    },
  });

  const refundable = Math.max(0, Number(sale.paidKES ?? 0) - Number(sale.refundedKES ?? 0));

  // The wallet keeps an unguessable receipt link for any payment that settled this sale (§38, §83):
  // a customer can verify the receipt without an account, and it shows nothing else.
  const walletPayment = await prisma.paymentTransaction
    .findFirst({ where: { businessId, posSaleId: saleId, receiptToken: { not: null } }, select: { receiptToken: true, jataPaymentId: true } })
    .catch(() => null);
  const receiptLink = walletPayment?.receiptToken ? `/receipt/${walletPayment.receiptToken}` : null;

  return (
    <div className="space-y-4">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{workspace.terminology.sale} {sale.receiptNumber}</p>
          <h2 className="text-xl font-bold">{formatKES(sale.totalKES)}</h2>
          <p className="pos-note">
            {formatDateTime(sale.createdAt)} · {channelLabel(sale.channel) || "Walk-in"}
            {sale.customerName ? ` · ${sale.customerName}` : ""}
            {sale.staffName ? ` · served by ${sale.staffName}` : ""}
          </p>
        </div>
        <span className="pos-pill" data-tone={sale.status === "COMPLETED" ? "success" : sale.status === "VOIDED" || sale.status === "REFUNDED" ? "danger" : "warn"}>
          {String(sale.status).replace(/_/g, " ").toLowerCase()}
        </span>
      </div>

      <div className="pos-scroll">
        <table className="pos-table">
          <thead>
            <tr><th>{workspace.terminology.product}</th><th>Qty</th><th>Price</th><th>Discount</th><th>Total</th></tr>
          </thead>
          <tbody>
            {(sale.items ?? []).map((item: any) => (
              <tr key={item.id}>
                <td>{item.name}{item.variantDesc ? <small className="pos-note"> · {item.variantDesc}</small> : null}</td>
                <td>{item.quantity}{item.unitKey ? ` ${item.unitKey}` : ""}</td>
                <td>{formatKES(item.unitPriceKES)}</td>
                <td>{item.discountKES ? formatKES(item.discountKES) : "—"}</td>
                <td>{formatKES(item.totalKES)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="jata-stat-grid">
        <div className="jata-stat"><dt>Items</dt><dd>{formatKES(sale.subtotalKES)}</dd></div>
        <div className="jata-stat"><dt>Discount</dt><dd>{formatKES(sale.discountKES)}</dd></div>
        <div className="jata-stat"><dt>Paid</dt><dd>{formatKES(sale.paidKES)}</dd></div>
        <div className="jata-stat"><dt>Balance</dt><dd>{formatKES(sale.balanceKES)}</dd></div>
      </dl>

      {(sale.payments ?? []).length ? (
        <section className="jata-card p-4">
          <p className="jata-kicker">Money</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {(sale.payments ?? []).map((payment: any) => (
              <li key={payment.id} className="flex justify-between gap-3">
                <span>
                  {payment.direction === "OUT" ? "Refunded" : "Paid"} by {payment.method}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                </span>
                <span>{formatKES(Number(payment.amountKES))}</span>
              </li>
            ))}
          </ul>
          {sale.notes ? <p className="pos-note mt-2">Note: {sale.notes}</p> : null}
        </section>
      ) : null}

      <section className="jata-card p-4">
        <div className="pos-toolbar">
          <p className="jata-kicker">Receipt</p>
          <button className="jata-btn jata-btn-ghost" onClick={() => window.print()} type="button">Print</button>
        </div>
        <pre className="pos-receipt mt-2">{receiptToText(receipt)}</pre>
        {receiptLink ? (
          <div className="mt-3 space-y-1">
            <p className="jata-kicker">Verified copy for the customer</p>
            <p className="pos-note">
              Send this link to the customer. It shows this receipt and nothing else, and anyone can open it without
              signing in.
            </p>
            <p className="pos-note">
              <Link href={receiptLink}>{receiptLink}</Link>
              {walletPayment?.jataPaymentId ? ` · ${walletPayment.jataPaymentId}` : ""}
            </p>
          </div>
        ) : null}
      </section>

      {workspace.permissions.includes("REFUND_SALE") || workspace.permissions.includes("VOID_SALE") ? (
        <RefundPanel
          businessId={businessId}
          basePath={workspace.basePath}
          saleId={sale.id}
          receiptNumber={sale.receiptNumber}
          refundableKES={refundable}
          refundedKES={Number(sale.refundedKES ?? 0)}
          status={sale.status}
          canRefund={workspace.permissions.includes("REFUND_SALE")}
          canVoid={workspace.permissions.includes("VOID_SALE")}
          refundsEnabled={workspace.configuration.sales.refunds}
          items={(sale.items ?? []).map((item: any) => ({
            id: item.id,
            name: item.name,
            quantity: Number(item.quantity ?? 0),
            unitKey: item.unitKey ?? "",
            totalKES: Number(item.totalKES ?? 0),
            productId: item.productId,
          }))}
          stockTracked={workspace.configuration.inventory.enabled}
        />
      ) : null}
    </div>
  );
}
