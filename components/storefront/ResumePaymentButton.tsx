"use client";

import { useState } from "react";

/**
 * "Continue to payment" for an unpaid order. The server decides: it checks the last payment attempt with Paystack and
 * either sends the customer to a payment page, reports that the payment is still being processed, or reports that the
 * order is already paid. The stored payment link is never reused by the browser.
 */
export function ResumePaymentButton({ slug, reference }: { slug: string; reference: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function resume() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/storefront/orders/resume-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, reference }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
        return;
      }
      if (data.paid) {
        window.location.reload();
        return;
      }
      setMessage(data.error || "We couldn’t start your payment. Please try again.");
    } catch {
      setMessage("We couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="eb-btn" onClick={resume} disabled={busy}>
        {busy ? "Preparing payment…" : "Continue to payment"}
      </button>
      {message ? <p role="status" style={{ marginTop: "0.5rem" }}>{message}</p> : null}
    </div>
  );
}
