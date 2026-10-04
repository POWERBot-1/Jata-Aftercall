"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Paying into the JATA Payment Wallet from the till (§21, §25, §41, §112).
 *
 * The cashier picks where the customer is paying — an M-PESA till, a PayBill, a bank account — and
 * JATA asks the provider. What comes back is instructions to show the customer, and then the till
 * simply waits: the payment becomes PAID when a verified provider confirmation arrives, never
 * because somebody clicked, refreshed or timed out (§41, §120).
 *
 * The panel knows nothing about providers: no endpoint, no payload, no key. It calls JATA and
 * renders what JATA tells it to (§1, §6).
 */

export type WalletDestinationTile = {
  id: string;
  label: string;
  kindLabel: string;
  statusLabel: string;
  tone: "neutral" | "warn" | "success" | "danger";
  available: boolean;
  automatic: boolean;
  detail: string;
};

export type WalletInstructions = {
  mode?: string;
  headline: string;
  body: string;
  steps: string[];
  automaticConfirmation: boolean;
  fallback?: string | null;
};

type Settled = { transactionId: string; jataPaymentId: string; saleId: string | null; receiptNumber: string | null; amountKES: number };

export function WalletPaymentPanel({
  businessId,
  basePath,
  totalKES,
  destinations,
  buildRequest,
  disabled,
  onSettled,
}: {
  businessId: string;
  basePath: string;
  totalKES: number;
  destinations: WalletDestinationTile[];
  /** Builds the server-priced cart payload at the moment the cashier asks for a payment. */
  buildRequest: () => Record<string, unknown>;
  disabled?: boolean;
  onSettled: (settled: Settled) => void;
}) {
  const [destinationId, setDestinationId] = useState("");
  const [request, setRequest] = useState<{
    id: string;
    jataPaymentId: string;
    status: string;
    amountKES: number;
    automaticConfirmation: boolean;
    instructions: WalletInstructions;
    expiresAt: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const requestKeyRef = useRef<string | null>(null);

  const available = destinations.filter((destination) => destination.available);

  /* Live updates: the SSE stream when the browser has it, a poll as the honest fallback (§112). */
  useEffect(() => {
    if (!request) return;
    if (["PAID", "CONFIRMED", "FAILED", "EXPIRED", "CANCELLED", "REVERSED", "FULLY_REFUNDED"].includes(request.status)) return;

    let stopped = false;
    let source: EventSource | null = null;
    const poll = setInterval(() => void refresh(true), 4000);

    const settle = (payment: any) => {
      if (!payment) return;
      if (["PAID", "CONFIRMED"].includes(String(payment.status))) {
        onSettled({
          transactionId: String(payment.id),
          jataPaymentId: String(payment.jataPaymentId ?? ""),
          saleId: payment.saleId ?? null,
          receiptNumber: payment.receiptNumber ?? null,
          amountKES: Number(payment.amountKES ?? 0) || totalKES,
        });
        return;
      }
      if (["FAILED", "EXPIRED", "CANCELLED"].includes(String(payment.status))) {
        setNote(
          payment.status === "EXPIRED"
            ? "We stopped waiting for this payment. Ask the customer to try again when they are ready."
            : payment.failureReason ?? "That payment did not go through. You can try again.",
        );
        setRequest((current) => (current ? { ...current, status: String(payment.status) } : current));
        return;
      }
      setRequest((current) =>
        current ? { ...current, status: String(payment.status), amountKES: Number(payment.amountKES ?? current.amountKES) } : current,
      );
    };

    async function refresh(quiet = false) {
      try {
        const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/payments/${encodeURIComponent(request!.id)}`);
        const data = await response.json();
        if (stopped) return;
        if (!response.ok) {
          if (!quiet) setError(data?.error ?? "We couldn't check that payment.");
          return;
        }
        settle(data?.payment);
      } catch {
        if (!quiet) setError("We couldn't reach JATA. The payment is not marked paid until we can verify it.");
      }
    }

    try {
      source = new EventSource(`/api/pos/${encodeURIComponent(businessId)}/payments/updates`);
      source.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          if (payload?.type === "payment" && payload.transactionId === request.id) void refresh(true);
        } catch {
          // A malformed frame never breaks the till.
        }
      };
    } catch {
      source = null;
    }

    return () => {
      stopped = true;
      clearInterval(poll);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id, request?.status, businessId]);

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const requestKey = requestKeyRef.current ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      requestKeyRef.current = requestKey;
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestKey,
          method: "wallet",
          destinationId: destinationId || undefined,
          sale: { request: buildRequest() },
        }),
      });
      const data = await response.json();
      if (!response.ok || data?.ok === false) {
        setError(data?.error ?? "We couldn't start that payment.");
        setBusy(false);
        return;
      }
      setRequest({
        id: data.transactionId,
        jataPaymentId: data.jataPaymentId,
        status: data.status,
        amountKES: data.amountKES,
        automaticConfirmation: Boolean(data.automaticConfirmation),
        instructions: data.instructions,
        expiresAt: data.expiresAt ?? null,
      });
      setBusy(false);
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
    }
  }, [businessId, destinationId, buildRequest]);

  async function checkStatus() {
    if (!request) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/payments/${encodeURIComponent(request.id)}/status`, { method: "POST" });
      const data = await response.json();
      if (response.ok && data?.payment) {
        setRequest((current) => (current ? { ...current, status: data.payment.status } : current));
        if (["PAID", "CONFIRMED"].includes(String(data.payment.status))) {
          onSettled({
            transactionId: data.payment.id,
            jataPaymentId: data.payment.jataPaymentId,
            saleId: data.payment.saleId ?? null,
            receiptNumber: data.payment.receiptNumber ?? null,
            amountKES: data.payment.amountKES ?? totalKES,
          });
        } else {
          setNote("The provider has not confirmed this payment yet. Nothing is marked paid until it does.");
        }
      }
    } catch {
      setError("We couldn't check with the provider. Try again in a moment.");
    }
    setBusy(false);
  }

  async function cancel() {
    if (!request) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/payments/${encodeURIComponent(request.id)}/cancel`, { method: "POST" });
      const data = await response.json();
      if (response.ok) {
        setRequest(null);
        requestKeyRef.current = null;
        setNote("Payment request cancelled. Nothing was taken.");
      } else {
        setError(data?.error ?? "We couldn't cancel that request.");
      }
    } catch {
      setError("We couldn't cancel that request. Check the payments screen before taking money another way.");
    }
    setBusy(false);
  }

  if (!available.length) return null;

  if (request) {
    return (
      <section className="jata-card p-4 space-y-3" data-pos-wallet="pending">
        <div className="pos-toolbar">
          <div>
            <p className="jata-kicker">Payment</p>
            <h3 className="text-base font-semibold">{request.instructions?.headline ?? "Waiting for payment"}</h3>
          </div>
          <span className="pos-pill" data-tone={request.automaticConfirmation ? "info" : "warn"}>
            {request.automaticConfirmation ? "Confirms automatically" : "Confirmation by hand"}
          </span>
        </div>

        <p className="pos-note">{request.instructions?.body}</p>
        {request.instructions?.steps?.length ? (
          <ol className="pos-note" style={{ paddingLeft: "1.1rem", listStyle: "decimal" }}>
            {request.instructions.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
        {request.instructions?.mode === "MANUAL" || !request.automaticConfirmation ? (
          <p className="pos-note" data-pos-wallet-fallback="true">
            {request.instructions?.fallback ??
              "When the customer has paid, use “Check with the provider” before taking any other payment."}
          </p>
        ) : (
          <p className="pos-note" data-pos-wallet-waiting="true">
            Waiting for the provider to confirm. This screen updates by itself — do not take another payment for this sale.
          </p>
        )}

        <p className="pos-note">
          {request.jataPaymentId} · KES {Number(request.amountKES ?? totalKES).toLocaleString("en-KE")}
          {request.status ? ` · ${request.status.replace(/_/g, " ").toLowerCase()}` : ""}
        </p>

        {note ? <p className="pos-note" role="status">{note}</p> : null}
        {error ? <p className="jata-error" role="alert">{error}</p> : null}

        <div className="pos-form-actions">
          <button type="button" className="jata-btn jata-btn-secondary" onClick={checkStatus} disabled={busy}>
            Check with the provider
          </button>
          <button type="button" className="jata-btn jata-btn-ghost" onClick={cancel} disabled={busy}>
            Cancel request
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="jata-card p-4 space-y-3" data-pos-wallet="choose">
      <div>
        <p className="jata-kicker">JATA Payment Wallet</p>
        <h3 className="text-base font-semibold">Take the payment into your own account</h3>
        <p className="pos-note">
          The customer pays into the account you added. JATA confirms it and records the sale — no codes to type in, and
          nothing is marked paid until the provider confirms it.
        </p>
      </div>

      <div className="jata-field">
        <label className="jata-label" htmlFor="till-wallet-destination">Where is the customer paying?</label>
        <select
          id="till-wallet-destination"
          className="jata-input"
          value={destinationId}
          onChange={(event) => setDestinationId(event.target.value)}
        >
          <option value="">My main payment account</option>
          {available.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.label} · {destination.statusLabel}
            </option>
          ))}
        </select>
        <p className="jata-hint">Change where you get paid in Payments. Only the owner can change it.</p>
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}
      {note ? <p className="pos-note" role="status">{note}</p> : null}

      <button type="button" className="jata-btn jata-btn-primary" onClick={ask} disabled={busy || disabled}>
        {busy ? "Starting…" : `Request payment · KES ${totalKES.toLocaleString("en-KE")}`}
      </button>
    </section>
  );
}
