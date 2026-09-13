"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";

function CallbackInner() {
  const sp = useSearchParams();
  const ref = sp.get("reference") || sp.get("trxref") || "";
  const [state, setState] = useState<"loading" | "paid" | "failed" | "error">("loading");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!ref) { setState("error"); setDetail("Missing reference"); return; }
    fetch(`/api/paystack/verify?reference=${ref}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setState("failed"); setDetail(d.error || "Verification failed"); return; }
        if (d.status === "PAID" || d.payment?.status === "PAID") { setState("paid"); }
        else { setState("failed"); setDetail(JSON.stringify(d).slice(0, 300)); }
      })
      .catch((e) => { setState("error"); setDetail(String(e)); });
  }, [ref]);

  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      {state === "loading" && <p>Verifying payment…</p>}
      {state === "paid" && (
        <div>
          <h1 className="text-xl font-bold">Payment successful ✓</h1>
          <p className="mt-2 text-sm text-zinc-600">Reference: {ref}</p>
          <p className="mt-2 text-sm">Your subscription is active. You can now publish your page.</p>
          <Link href="/dashboard" className="mt-6 inline-flex rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white">Go to dashboard</Link>
        </div>
      )}
      {state === "failed" && (
        <div>
          <h1 className="text-xl font-bold">Payment unsuccessful</h1>
          <p className="mt-2 text-sm text-zinc-600">Your business page has not been activated.</p>
          <p className="mt-2 text-xs text-zinc-500">{detail}</p>
          <Link href="/dashboard/subscription" className="mt-6 inline-flex rounded-full bg-zinc-900 px-6 py-2 text-sm font-semibold text-white">Try payment again</Link>
        </div>
      )}
      {state === "error" && <p className="text-sm text-red-600">{detail}</p>}
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  );
}
