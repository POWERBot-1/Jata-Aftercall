"use client";
import { useState } from "react";
import Link from "next/link";

export default function CheckoutForm({ businessId, planId, businessName, planName, priceKES }: {
  businessId: string; planId: string; businessName: string; planName: string; priceKES: number;
}) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [amountKes, setAmountKes] = useState<number | null>(null);

  async function checkout() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, planId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || "Checkout could not be started. Please try again."); return; }
      if (typeof data.payment?.amount === "number") setAmountKes(data.payment.amount / 100);
      if (typeof data.authorization_url !== "string") { setMessage("Checkout did not return a payment link. Please try again."); return; }
      window.location.assign(data.authorization_url);
    } catch {
      setMessage("We couldn’t reach checkout. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="mx-auto max-w-md px-4 py-10">
    <h1 className="text-xl font-bold">Review your checkout</h1>
    <p className="mt-2 text-sm text-zinc-600">The selected business and plan are checked again on the server before a payment is initialized.</p>
    <div className="mt-5 rounded-xl border bg-white p-4 text-sm">
      <p><span className="text-zinc-500">Business:</span> <strong>{businessName}</strong></p>
      <p className="mt-1"><span className="text-zinc-500">Plan:</span> <strong>{planName}</strong></p>
      <p className="mt-3 font-bold">Plan price: KES {priceKES.toLocaleString()}</p>
      <p className="mt-1 text-xs text-zinc-500">The final charge is recalculated from the active plan on the server.</p>
      {amountKes !== null && <p className="mt-3 font-bold">Checkout amount: KES {amountKes.toLocaleString()}</p>}
    </div>
    <button disabled={loading} onClick={checkout} className="mt-5 w-full rounded-full bg-zinc-900 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
      {loading ? "Starting secure checkout…" : "Pay with Paystack"}
    </button>
    {message && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    <p className="mt-4 text-xs text-zinc-500">After payment, our server verifies the transaction before changing subscription status. A redirect alone does not activate your subscription.</p>
    <Link href={`/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`} className="mt-5 inline-flex text-sm font-semibold underline">Back to subscription</Link>
  </main>;
}
