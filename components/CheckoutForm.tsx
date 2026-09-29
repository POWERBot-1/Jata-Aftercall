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
    if (loading) return;
    setLoading(true);
    setMessage("");
    let redirecting = false;
    try {
      const response = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, planId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || "Checkout could not be started. Please try again."); return; }
      if (typeof data.payment?.amount === "number") setAmountKes(data.payment.amount / 100);
      if (typeof data.authorization_url !== "string") { setMessage("Checkout did not return a payment link. Please try again."); return; }
      // Keep the button disabled while the browser leaves for Paystack so a second tap
      // cannot start a second payment.
      redirecting = true;
      window.location.assign(data.authorization_url);
    } catch {
      setMessage("We couldn’t reach checkout. Check your connection and try again.");
    } finally {
      if (!redirecting) setLoading(false);
    }
  }

  return <main id="main" className="mx-auto max-w-md px-4 py-10">
    <h1 className="text-xl font-bold">Review your checkout</h1>
    <p className="mt-2 text-sm text-zinc-600">Check the details below, then continue to Paystack to pay by M-Pesa or card.</p>
    <div className="mt-5 rounded-xl border bg-white p-4 text-sm">
      <p><span className="text-zinc-500">Business:</span> <strong>{businessName}</strong></p>
      <p className="mt-1"><span className="text-zinc-500">Plan:</span> <strong>{planName}</strong></p>
      <p className="mt-3 font-bold">Plan price: KES {priceKES.toLocaleString()}</p>
      <p className="mt-1 text-xs text-zinc-600">The amount you pay is set by our server from the current plan price, not by this page.</p>
      {amountKes !== null && <p className="mt-3 font-bold">Amount to pay: KES {amountKes.toLocaleString()}</p>}
    </div>
    <button type="button" disabled={loading} aria-busy={loading} onClick={checkout} className="jata-btn jata-btn-primary mt-5 w-full">
      {loading ? "Opening secure checkout…" : `Pay KES ${(amountKes ?? priceKES).toLocaleString()} with Paystack`}
    </button>
    {message && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    <p className="mt-4 text-xs text-zinc-600">Your subscription is activated only after Paystack confirms the payment to our server. If the payment is still processing, you’ll see that status — never a false “success”.</p>
    <Link href={`/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`} className="jata-btn jata-btn-ghost mt-3 underline">Back to subscription</Link>
  </main>;
}
