import Link from "next/link";
import prisma from "@/lib/db";
import { maskDestination, minorToKes } from "@/lib/payments/money";
import { PROVIDER_LABELS } from "@/lib/payments/types";

/**
 * Receipt verification (§38, §83).
 *
 * A customer — or anyone they send the link to — can check that a receipt is real without an
 * account. The link carries an unguessable token; the page shows only what a receipt shows:
 * who was paid, how much, when, and that the provider confirmed it. No internal ids, no provider
 * payload, no credentials, and nothing about any other payment (§56, §120).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verify a receipt",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function ReceiptVerificationPage({ params }: Props) {
  const { token } = await params;
  const clean = typeof token === "string" ? token.trim() : "";

  const transaction =
    clean.length >= 16 && clean.length <= 128
      ? await prisma.paymentTransaction
          .findFirst({
            where: { receiptToken: clean },
            select: {
              jataPaymentId: true,
              receiptNumber: true,
              status: true,
              provider: true,
              method: true,
              amountMinor: true,
              amountPaidMinor: true,
              amountRefundedMinor: true,
              currency: true,
              paidAt: true,
              providerConfirmedAt: true,
              businessId: true,
            },
          })
          .catch(() => null)
      : null;

  const business = transaction ? await prisma.business.findUnique({ where: { id: transaction.businessId }, select: { name: true } }).catch(() => null) : null;
  const destination = transaction
    ? await prisma.paymentDestination
        .findFirst({ where: { businessId: transaction.businessId, isPrimary: true }, select: { kind: true, providerDestinationId: true, bankName: true } })
        .catch(() => null)
    : null;

  if (!transaction || !["PAID", "CONFIRMED", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED"].includes(String(transaction.status))) {
    return (
      <main className="jata-page jata-narrow">
        <div className="jata-card p-6 space-y-2">
          <p className="jata-kicker">JATA receipt</p>
          <h1 className="text-lg font-bold">We couldn&apos;t verify this receipt</h1>
          <p className="pos-note">
            The link may be incomplete or the payment may not have been confirmed. Ask the business to send the receipt
            again.
          </p>
          <Link href="/" className="jata-btn jata-btn-secondary">Go to JATA</Link>
        </div>
      </main>
    );
  }

  const amountKES = minorToKes(Number(transaction.amountPaidMinor ?? transaction.amountMinor ?? 0));
  const refundedKES = minorToKes(Number(transaction.amountRefundedMinor ?? 0));
  const providerLabel = PROVIDER_LABELS[transaction.provider as keyof typeof PROVIDER_LABELS] ?? String(transaction.provider);
  const confirmedAt = transaction.providerConfirmedAt ?? transaction.paidAt;

  return (
    <main className="jata-page jata-narrow">
      <div className="jata-card p-6 space-y-3" data-receipt-verified="true">
        <div className="pos-toolbar">
          <div>
            <p className="jata-kicker">JATA receipt</p>
            <h1 className="text-lg font-bold">{business?.name ?? "A JATA business"}</h1>
            <p className="pos-note">{transaction.receiptNumber ?? transaction.jataPaymentId}</p>
          </div>
          <span className="pos-pill" data-tone="success">Confirmed</span>
        </div>

        <dl className="jata-stat-grid">
          <div className="jata-stat"><dt>Amount</dt><dd>KES {amountKES.toLocaleString("en-KE")}</dd></div>
          <div className="jata-stat"><dt>Paid on</dt><dd>{new Date(confirmedAt ?? Date.now()).toLocaleString("en-KE")}</dd></div>
          <div className="jata-stat"><dt>Method</dt><dd>{providerLabel}</dd></div>
          <div className="jata-stat"><dt>Reference</dt><dd>{transaction.jataPaymentId}</dd></div>
        </dl>

        {destination ? (
          <p className="pos-note">
            Paid to {maskDestination(destination.providerDestinationId, destination.bankName ?? "")}
            {destination.kind === "MPESA_TILL" ? " (M-PESA till)" : destination.kind === "MPESA_PAYBILL" ? " (M-PESA PayBill)" : ""}
          </p>
        ) : null}
        {refundedKES > 0 ? <p className="pos-note">Refunded: KES {refundedKES.toLocaleString("en-KE")}</p> : null}

        <p className="pos-note" data-receipt-statement="true">
          This payment was confirmed by {providerLabel} and recorded by JATA. Only a confirmation from the provider can
          mark a payment as paid.
        </p>
        <p className="pos-note">
          Keep this link: anyone opening it sees this receipt and nothing else.
        </p>
      </div>
    </main>
  );
}
