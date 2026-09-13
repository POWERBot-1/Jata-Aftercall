"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function CheckoutInner() {
  const sp = useSearchParams();
  const businessId = sp.get("businessId") || "";
  const planId = sp.get("planId") || "";
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function checkout() {
    if (!businessId) { setMsg("Missing businessId"); return; }
    setLoading(true);
    setMsg("");
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, planId: planId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setMsg(data.error || "Checkout failed"); return; }
    if (data.mock) {
      const v = await fetch(`/api/paystack/verify?reference=${data.reference}&mock=success`);
      const vd = await v.json().catch(() => ({}));
      if (!v.ok) setMsg(vd.error || "Verify failed");
      else setMsg("Mock payment verified ✓ — subscription active. Go to dashboard.");
      return;
    }
    if (data.authorization_url) window.location.href = data.authorization_url;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">Checkout</h1>
      <p className="text-sm text-zinc-600">Business: {businessId || "—"} • Plan: {planId || "default"}</p>
      <button disabled={loading} onClick={checkout} className="mt-6 w-full rounded-full bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {loading ? "Redirecting to Paystack…" : "Pay with Paystack"}
      </button>
      {msg && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm">{msg}</p>}
      <p className="mt-4 text-xs text-zinc-500">JATA ATLAS merchant 2006074 • Server-verified • Webhook idempotent</p>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense>
      <CheckoutInner />
    </Suspense>
  );
}
