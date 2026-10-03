"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Choosing the plan (§4 step 6, §43, §45, §67).
 *
 * The price shown here was resolved on the server from PlanConfig; selecting it only asks the
 * server to start a checkout. Payment *initiation* is never treated as success — the POS goes
 * live when Paystack confirms the charge and the server provisions it (§44).
 */
export function PlanClient({
  businessId,
  checkoutUrl,
  priceKES,
  lifecycleLabel,
  entitled,
  expiresAt,
}: {
  businessId: string;
  checkoutUrl: string | null;
  priceKES: number;
  lifecycleLabel: string;
  entitled: boolean;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/plan`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "We couldn't start your payment. Please try again.");
        setBusy(false);
        return;
      }
      if (checkoutUrl) {
        router.push(checkoutUrl);
        return;
      }
      router.refresh();
      setBusy(false);
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="jata-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="jata-kicker">JATA AFTERCALL — Business POS</p>
          <p className="text-2xl font-extrabold">KES {priceKES.toLocaleString("en-KE")}<span className="text-sm font-semibold text-zinc-500"> / month</span></p>
          <p className="pos-note">Per business. Cancel any time — your records stay yours.</p>
        </div>
        <span className="jata-status">{lifecycleLabel}</span>
      </div>

      {error ? <p className="jata-error mt-3" role="alert">{error}</p> : null}

      {entitled ? (
        <div className="mt-4">
          <p className="text-sm font-semibold">Your POS is active.</p>
          <p className="pos-note">
            {expiresAt ? `Renews by ${new Date(expiresAt).toLocaleDateString("en-KE")}.` : "Payment confirmed."}
          </p>
        </div>
      ) : (
        <div className="pos-form-actions mt-4">
          <button type="button" className="jata-btn jata-btn-primary" onClick={choose} disabled={busy || !checkoutUrl}>
            {busy ? "Opening payment…" : `Choose plan and pay KES ${priceKES.toLocaleString("en-KE")}`}
          </button>
          <span className="pos-note">Pay with M-Pesa or card through Paystack. Your POS switches on the moment the payment is confirmed.</span>
        </div>
      )}
    </div>
  );
}
