import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { PosRefusal } from "@/components/pos/PosRefusal";
import { PaymentsClient } from "@/components/pos/PaymentsClient";
import { destinationHistory, loadWallet, paymentHealth, paymentHealthRows } from "@/lib/payments/wallet";
import { listRecentPayments } from "@/lib/payments/store";
import { dailyReconciliation, listReconciliationExceptions } from "@/lib/payments/reconciliation";
import { readTestMode } from "@/lib/payments/config";

/**
 * Payments (§40, §41, §53, §71, §72).
 *
 * The screen a merchant opens to answer three questions: did the money arrive, where does it land,
 * and is anything wrong. It is gated by `VIEW_PAYMENTS` — the same permission its API reads
 * require (§11, §36) — and every figure on it comes from JATA's own records, never from the
 * browser.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Payments" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosPaymentsPage({ params }: Props) {
  const { businessId } = await params;
  const gate = await loadPosPageWorkspace(businessId, "VIEW_PAYMENTS");
  if (!gate.workspace) return <PosRefusal message={gate.refusal} basePath={gate.basePath} />;
  const workspace = gate.workspace;

  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [wallet, health, payments, exceptions, daily, history] = await Promise.all([
    loadWallet(businessId),
    paymentHealth(businessId),
    listRecentPayments(businessId, { take: 40 }),
    listReconciliationExceptions(businessId, { limit: 50 }),
    dailyReconciliation(businessId, { from: startOfDay, to: today }),
    destinationHistory(businessId, 12),
  ]);

  return (
    <PaymentsClient
      businessId={businessId}
      basePath={workspace.basePath}
      wallet={wallet as never}
      health={{ ...health, rows: paymentHealthRows(health) }}
      payments={payments}
      exceptions={exceptions as never}
      daily={daily}
      history={history as never}
      permissions={{
        canManageDestinations: workspace.permissions.includes("MANAGE_PAYMENT_DESTINATIONS"),
        canRefund: workspace.permissions.includes("REFUND_PAYMENT"),
        canReconcile: workspace.permissions.includes("MANAGE_RECONCILIATION"),
      }}
      testMode={readTestMode().enabled}
    />
  );
}
