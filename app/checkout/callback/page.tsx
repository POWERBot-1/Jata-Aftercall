"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CHECKOUT_POLL_INTERVALS_MS, interpretVerifyResponse, type CheckoutView } from "@/lib/checkoutStatus";

const LOADING: CheckoutView = { state: "error", title: "Checking payment", message: "Verifying payment with the server…", poll: false };

function CallbackInner() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || "";
  const testMock = searchParams.get("mock") === "success";
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CheckoutView>(LOADING);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const verify = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!reference) {
      setLoading(false);
      setView({ state: "error", title: "Payment status unavailable", message: "No payment reference was returned. Check your payment history or contact support.", poll: false });
      return;
    }
    setLoading(true);
    try {
      const query = new URLSearchParams({ reference });
      if (testMock) query.set("mock", "success");
      const response = await fetch(`/api/paystack/verify?${query.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setView(interpretVerifyResponse(response.status, data));
    } catch {
      setView({ state: "error", title: "Payment status unavailable", message: "We couldn’t reach payment verification. Check your connection — we’ll keep trying.", poll: true });
    } finally {
      setLoading(false);
    }
  }, [reference, testMock]);

  useEffect(() => { void verify(); }, [verify]);

  // Automatic re-checks with backoff while the payment is still processing.
  useEffect(() => {
    if (loading || !view.poll) return;
    if (attempt >= CHECKOUT_POLL_INTERVALS_MS.length) return;
    timer.current = setTimeout(() => { setAttempt((n) => n + 1); void verify(); }, CHECKOUT_POLL_INTERVALS_MS[attempt]);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [loading, view, attempt, verify]);

  const stoppedPolling = view.poll && attempt >= CHECKOUT_POLL_INTERVALS_MS.length;
  const tone = view.state === "paid" ? "alert-success" : view.state === "processing" || view.state === "activating" ? "alert-warning" : view.state === "error" || view.state === "signin" ? "alert-warning" : "alert-error";

  return <main id="main" className="mx-auto max-w-md px-4 py-10 text-center">
    <div aria-live="polite" aria-busy={loading}>
      {loading && view === LOADING ? (
        <p role="status" className="text-sm">Verifying payment with the server…</p>
      ) : (
        <>
          <h1 className="text-xl font-bold">{view.title}{view.state === "paid" ? " ✓" : ""}</h1>
          <p role="status" className={`mt-3 rounded-xl border p-3 text-sm ${tone}`}>{view.message}</p>
          {view.state === "processing" && <p className="mt-2 text-xs text-zinc-600">Paying by M-Pesa? Approve the prompt on your phone. Confirmation can take a minute.</p>}
          {stoppedPolling && <p className="mt-2 text-xs text-zinc-600">We’ve stopped checking automatically. Use “Check payment status” to try again — you won’t be charged twice.</p>}
          {reference && <p className="mt-2 break-all font-mono text-xs text-zinc-600">Reference: {reference}</p>}
        </>
      )}
    </div>
    {view.state === "paid" ? (
      <Link href="/dashboard" className="jata-btn jata-btn-primary mt-6">Go to dashboard</Link>
    ) : view !== LOADING && (
      <>
        {view.state === "signin" ? (
          <Link href="/login" className="jata-btn jata-btn-primary mt-5">Sign in</Link>
        ) : view.state === "cancelled" || view.state === "expired" || view.state === "failed" ? (
          <Link href="/dashboard/subscription" className="jata-btn jata-btn-primary mt-5">Try again</Link>
        ) : (
          <button type="button" onClick={() => { setAttempt(0); void verify(); }} disabled={loading} className="jata-btn jata-btn-primary mt-5">
            {loading ? "Checking…" : "Check payment status"}
          </button>
        )}
        <div><Link href="/dashboard/subscription" className="jata-btn jata-btn-ghost mt-3 underline">Back to subscription</Link></div>
      </>
    )}
  </main>;
}

export default function CallbackPage() {
  return <Suspense fallback={<p className="p-8 text-center">Checking payment…</p>}><CallbackInner /></Suspense>;
}
