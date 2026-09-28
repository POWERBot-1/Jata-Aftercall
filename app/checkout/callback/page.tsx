"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type State = "loading" | "paid" | "pending" | "failed" | "error";
function CallbackInner() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || "";
  const testMock = searchParams.get("mock") === "success";
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("");

  const verify = useCallback(async () => {
    if (!reference) { setState("error"); setMessage("No payment reference was returned. Check your payment history or contact support."); return; }
    setState("loading");
    try {
      const query = new URLSearchParams({ reference });
      if (testMock) query.set("mock", "success");
      const response = await fetch(`/api/paystack/verify?${query.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) { setState("error"); setMessage(data.error || "Sign in to check this payment."); return; }
      if (data.status === "PAID" && data.subscriptionStatus === "ACTIVE") { setState("paid"); setMessage(""); return; }
      if (data.status === "PENDING") { setState("pending"); setMessage("We’re still waiting for confirmation from Paystack. Your subscription is not active yet."); return; }
      if (data.status === "CANCELLED") { setState("failed"); setMessage("Payment was cancelled. Your subscription has not been activated."); return; }
      if (!response.ok) { setState("error"); setMessage(data.error || "We couldn’t verify this payment yet. Please check again."); return; }
      setState("failed"); setMessage("Payment was not completed. Your subscription has not been activated.");
    } catch {
      setState("error"); setMessage("We couldn’t reach payment verification. Please try again.");
    }
  }, [reference, testMock]);

  useEffect(() => { void verify(); }, [verify]);

  return <main className="mx-auto max-w-md px-4 py-10 text-center">
    {state === "loading" && <p role="status">Verifying payment with the server…</p>}
    {state === "paid" && <>
      <h1 className="text-xl font-bold">Payment confirmed ✓</h1>
      <p className="mt-2 text-sm text-zinc-600">Paystack confirmed the payment and your subscription is active.</p>
      <p className="mt-2 break-all font-mono text-xs text-zinc-500">Reference: {reference}</p>
      <Link href="/dashboard" className="mt-6 inline-flex rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white">Go to dashboard</Link>
    </>}
    {(state === "pending" || state === "failed" || state === "error") && <>
      <h1 className="text-xl font-bold">{state === "pending" ? "Payment processing" : state === "failed" ? "Payment not completed" : "Payment status unavailable"}</h1>
      <p role="status" className="mt-2 text-sm text-zinc-600">{message}</p>
      {reference && <p className="mt-2 break-all font-mono text-xs text-zinc-500">Reference: {reference}</p>}
      <button onClick={() => void verify()}  className="mt-5 rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">Check payment status</button>
      <div><Link href="/dashboard/subscription" className="mt-4 inline-flex text-sm font-semibold underline">Back to subscription</Link></div>
    </>}
  </main>;
}
export default function CallbackPage() {
  return <Suspense fallback={<p className="p-8 text-center">Checking payment…</p>}><CallbackInner /></Suspense>;
}
