"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The merchant payment screen (§40, §41, §53, §71, §72).
 *
 * Four jobs, one screen: see money arrive, say where it should arrive, know the system is healthy,
 * and put right anything that did not line up. Everything here is server state — the browser asks,
 * JATA answers, and a payment only reads PAID once the provider has confirmed it (§41, §112).
 *
 * The component never renders a provider payload, a credential or another tenant's row: it only
 * renders what the payment APIs handed it (§5, §56, §120).
 */

type Destination = {
  id: string;
  kindLabel: string;
  providerLabel: string;
  label: string;
  isPrimary: boolean;
  isActive: boolean;
  status: string;
  statusLabel: string;
  statusTone: "success" | "warn" | "danger" | "neutral";
  statusDetail: string;
  verificationLabel: string;
  capabilityClaims: { label: string; available: boolean }[];
  automaticConfirmation: boolean;
  actionRequired: { label: string; kind: string } | null;
};

type Payment = {
  id: string;
  jataPaymentId: string;
  providerLabel: string;
  status: string;
  statusLabel: string;
  tone: "neutral" | "warn" | "success" | "danger";
  amountKES: number;
  paidKES: number;
  refundedKES: number;
  destinationLabel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  saleId: string | null;
  receiptNumber: string | null;
  failureReason: string | null;
  createdAt: string;
  awaitingCustomer: boolean;
};

type Exception = {
  id: string;
  result: string;
  provider: string;
  providerReference: string | null;
  expectedAmountMinor: number | null;
  receivedAmountMinor: number | null;
  differenceMinor: number;
  notes: string | null;
  transactionId: string | null;
  jataPaymentId: string | null;
  createdAt: string;
};

const EXCEPTION_LABELS: Record<string, string> = {
  AMOUNT_MISMATCH: "Amount did not match",
  UNKNOWN_PAYMENT: "Money arrived we could not place",
  DUPLICATE: "A provider sent the same payment twice",
  UNCONFIRMED: "Not confirmed by the provider",
  MANUAL_MATCHED: "Matched by hand",
  MATCHED: "Matched",
};

/** "Reconciled" means every wallet payment matched a sale with matching amounts (§43). */
function reconciliationStatusLabel(daily: any): string {
  if (!daily) return "Not yet";
  const mismatches = Number(daily.mismatches ?? 0);
  const exceptions = Number(daily.exceptions ?? 0);
  if (daily.status === "NO_WALLET_PAYMENTS") return "None yet";
  if (daily.status === "MATCHED") return "Yes";
  if (mismatches > 0) return `${mismatches} need review`;
  if (exceptions > 0) return "Review exceptions";
  return "Not yet";
}

export function PaymentsClient({
  businessId,
  basePath,
  wallet,
  health,
  payments,
  exceptions,
  daily,
  history,
  permissions,
  testMode,
}: {
  businessId: string;
  basePath: string;
  wallet: { destinations: Destination[]; tiles: { kind: string; title: string; subtitle: string; available: boolean; comingSoon: boolean }[]; headline: string; ready: boolean; providers: any[] };
  health: any;
  payments: Payment[];
  exceptions: Exception[];
  daily: any;
  history: { action: string; summary: string; at: string; actorName: string | null }[];
  permissions: { canManageDestinations: boolean; canRefund: boolean; canReconcile: boolean };
  testMode: boolean;
}) {
  const [tab, setTab] = useState<"live" | "destinations" | "health" | "reconciliation">("live");
  const [rows, setRows] = useState<Payment[]>(payments);
  const [openPayment, setOpenPayment] = useState<Payment | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>(wallet.destinations);
  const [exceptionRows, setExceptionRows] = useState<Exception[]>(exceptions);
  const [dailyTotals, setDailyTotals] = useState<any>(daily);
  const walletRef = useRef(wallet);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/payments?take=40`);
      const data = await response.json();
      if (!response.ok) return;
      setRows(data.payments ?? []);
      setDestinations(data.wallet?.destinations ?? []);
      walletRef.current = data.wallet ?? walletRef.current;
    } catch {
      // A failed refresh keeps the last known truth on screen; it never invents a state.
    }
  }, [businessId]);

  /* Live board: SSE when available, otherwise a poll. Both read server state only (§112). */
  useEffect(() => {
    if (tab !== "live") return;
    let source: EventSource | null = null;
    const poll = setInterval(() => void refresh(), 6000);
    try {
      source = new EventSource(`/api/pos/${encodeURIComponent(businessId)}/payments/updates`);
      source.onmessage = () => void refresh();
    } catch {
      source = null;
    }
    return () => {
      clearInterval(poll);
      source?.close();
    };
  }, [businessId, refresh, tab]);

  const awaiting = useMemo(() => rows.filter((row) => row.awaitingCustomer).length, [rows]);

  async function act(path: string, body?: Record<string, unknown>, method = "POST") {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "That did not work. Try again.");
        setBusy(false);
        return null;
      }
      setBusy(false);
      return data;
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
      return null;
    }
  }

  async function openDetail(payment: Payment) {
    setOpenPayment(payment);
    setDetail(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/payments/${encodeURIComponent(payment.id)}`);
      const data = await response.json();
      if (response.ok) setDetail(data);
    } catch {
      setDetail(null);
    }
  }

  async function reloadDetail() {
    if (!openPayment) return;
    await openDetail(openPayment);
  }

  return (
    <div className="space-y-4">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">Payments</p>
          <h2 className="text-xl font-bold">JATA Payment Wallet</h2>
          <p className="pos-note">{walletRef.current.headline}</p>
        </div>
        <div className="pos-row-values">
          {testMode ? <span className="pos-pill" data-tone="warn">Practice records — not counted as real money</span> : null}
          {awaiting ? <span className="pos-pill" data-tone="info">{awaiting} waiting for the customer</span> : null}
          <button type="button" className="jata-btn jata-btn-ghost" onClick={() => void refresh()} disabled={busy}>Refresh</button>
        </div>
      </div>

      <div className="pos-tabs">
        <button type="button" className="pos-tab" data-selected={tab === "live"} onClick={() => setTab("live")}>Live payments</button>
        <button type="button" className="pos-tab" data-selected={tab === "destinations"} onClick={() => setTab("destinations")}>Where you get paid</button>
        <button type="button" className="pos-tab" data-selected={tab === "health"} onClick={() => setTab("health")}>Health</button>
        <button type="button" className="pos-tab" data-selected={tab === "reconciliation"} onClick={() => setTab("reconciliation")}>Books</button>
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}
      {note ? <p className="pos-note" role="status">{note}</p> : null}

      {tab === "live" ? (
        <section className="space-y-3">
          {rows.length === 0 ? (
            <div className="pos-empty">
              <strong>No payments yet</strong>
              <p>
                When a customer pays into your account, the payment appears here — confirmed by the provider, not by a
                person.
              </p>
              <button type="button" className="jata-btn jata-btn-secondary" onClick={() => setTab("destinations")}>See where you get paid</button>
            </div>
          ) : (
            <div className="pos-rows">
              {rows.map((row) => (
                <div className="pos-row" key={row.id}>
                  <button type="button" className="pos-row-main" onClick={() => void openDetail(row)} style={{ textAlign: "left", background: "none", border: 0, padding: 0 }}>
                    <strong>{row.jataPaymentId}</strong>
                    <small>
                      {new Date(row.createdAt).toLocaleString("en-KE")} · {row.providerLabel}
                      {row.destinationLabel ? ` · ${row.destinationLabel}` : ""}
                      {row.customerName ? ` · ${row.customerName}` : ""}
                    </small>
                  </button>
                  <div className="pos-row-values">
                    <span>KES {row.amountKES.toLocaleString("en-KE")}</span>
                    <span className="pos-pill" data-tone={row.tone}>{row.statusLabel}</span>
                    {row.receiptNumber ? <span className="pos-note">{row.receiptNumber}</span> : null}
                  </div>
                  <div className="pos-row-actions">
                    {row.awaitingCustomer ? (
                      <>
                        <button
                          type="button"
                          className="jata-btn jata-btn-ghost"
                          disabled={busy}
                          onClick={async () => {
                            const data = await act(`/payments/${encodeURIComponent(row.id)}/status`);
                            if (data?.payment?.status) {
                              setNote(
                                ["PAID", "CONFIRMED"].includes(data.payment.status)
                                  ? "The provider confirmed this payment."
                                  : "Still waiting for the provider to confirm. Nothing is marked paid until it does.",
                              );
                              void refresh();
                            }
                          }}
                        >
                          Check
                        </button>
                        <button
                          type="button"
                          className="jata-btn jata-btn-ghost"
                          disabled={busy}
                          onClick={async () => {
                            const data = await act(`/payments/${encodeURIComponent(row.id)}/cancel`);
                            if (data) {
                              setNote("Request cancelled. Nothing was taken.");
                              void refresh();
                            }
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : null}
                    {permissions.canRefund && row.paidKES > row.refundedKES && ["PAID", "CONFIRMED", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"].includes(row.status) ? (
                      <button type="button" className="jata-btn jata-btn-ghost" onClick={() => void openDetail(row)}>Refund</button>
                    ) : null}
                    {row.saleId ? (
                      <a className="jata-btn jata-btn-ghost" href={`${basePath}/sales/${row.saleId}`}>Sale</a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "destinations" ? (
        <DestinationsTab
          businessId={businessId}
          wallet={{ ...walletRef.current, destinations } as never}
          destinations={destinations}
          history={history}
          canManage={permissions.canManageDestinations}
          busy={busy}
          act={act}
          onChanged={async () => {
            await refresh();
          }}
        />
      ) : null}

      {tab === "health" ? <HealthTab health={health} /> : null}

      {tab === "reconciliation" ? (
        <ReconciliationTab
          businessId={businessId}
          daily={dailyTotals}
          exceptions={exceptionRows}
          canReconcile={permissions.canReconcile}
          busy={busy}
          act={act}
          onChanged={(data) => {
            if (data?.exceptions) setExceptionRows(data.exceptions);
            void fetch(`/api/pos/${encodeURIComponent(businessId)}/payments/reconciliation`)
              .then((response) => response.json())
              .then((payload) => {
                if (payload?.daily) setDailyTotals(payload.daily);
                if (payload?.exceptions) setExceptionRows(payload.exceptions);
              })
              .catch(() => undefined);
          }}
        />
      ) : null}

      {openPayment ? (
        <PaymentDrawer
          businessId={businessId}
          payment={openPayment}
          detail={detail}
          canRefund={permissions.canRefund}
          busy={busy}
          act={act}
          onClose={() => {
            setOpenPayment(null);
            setDetail(null);
          }}
          onChanged={async () => {
            await reloadDetail();
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Where you get paid (§10–§13, §62, §88) ──────────────────────────────────────────────── */

function DestinationsTab({
  businessId,
  wallet,
  destinations,
  history,
  canManage,
  busy,
  act,
  onChanged,
}: {
  businessId: string;
  wallet: { tiles: any[]; providers: any[] };
  destinations: Destination[];
  history: { action: string; summary: string; at: string; actorName: string | null }[];
  canManage: boolean;
  busy: boolean;
  act: (path: string, body?: Record<string, unknown>, method?: string) => Promise<any>;
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState("MPESA_TILL");
  const [number, setNumber] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [bankName, setBankName] = useState("");
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const needsBank = kind === "BANK_ACCOUNT";
  const needsAccount = kind === "MPESA_PAYBILL";

  async function add() {
    setLocalError(null);
    setLocalNote(null);
    const body: Record<string, unknown> = {
      kind,
      providerDestinationId: number,
      providerAccountRef: needsAccount ? accountRef : "",
      bankName: needsBank ? bankName : null,
      accountName: needsBank ? accountRef : null,
    };
    if (destinations.length > 0) {
      if (!confirming) {
        setLocalError("Tick the confirmation box — changing where money lands is an owner decision.");
        return;
      }
      body.confirm = true;
      if (password) body.password = password;
    }
    const data = await act("/payments/destinations", body);
    if (!data) return;
    setNumber("");
    setAccountRef("");
    setBankName("");
    setPassword("");
    setConfirming(false);
    setLocalNote("Saved. JATA will confirm this account with the provider where that is possible.");
    await onChanged();
  }

  return (
    <section className="space-y-4">
      <div className="pos-cards">
        {destinations.map((destination) => (
          <article className="pos-card" key={destination.id}>
            <div className="pos-toolbar">
              <div>
                <p className="jata-kicker">{destination.kindLabel}</p>
                <h3 className="text-base font-semibold">{destination.label}</h3>
              </div>
              <span className="pos-pill" data-tone={destination.statusTone}>{destination.statusLabel}</span>
            </div>
            <p className="pos-note">{destination.statusDetail}</p>
            <p className="pos-note">{destination.verificationLabel}{destination.isPrimary ? " · Main account" : ""}</p>

            <ul className="pos-note grid gap-1">
              {destination.capabilityClaims.map((claim) => (
                <li key={claim.label}>
                  {claim.available ? "✓" : "—"} {claim.label}
                  {claim.available ? "" : " (not available for this account yet)"}
                </li>
              ))}
            </ul>

            {canManage && destination.isActive ? (
              <div className="pos-form-actions">
                {!destination.isPrimary ? (
                  <button
                    type="button"
                    className="jata-btn jata-btn-secondary"
                    disabled={busy}
                    onClick={async () => {
                      const data = await act(`/payments/destinations/${encodeURIComponent(destination.id)}`, { action: "primary", confirm: true });
                      if (data) {
                        setLocalNote("This is now the account new payments go to.");
                        await onChanged();
                      }
                    }}
                  >
                    Make main account
                  </button>
                ) : null}
                <button
                  type="button"
                  className="jata-btn jata-btn-ghost"
                  disabled={busy}
                  onClick={async () => {
                    const data = await act(`/payments/destinations/${encodeURIComponent(destination.id)}`, { action: "disconnect", confirm: true, reason: "Disconnected from the wallet screen" });
                    if (data) {
                      setLocalNote("Disconnected. Past payments are kept exactly as they were.");
                      await onChanged();
                    }
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : null}
          </article>
        ))}

        {destinations.length === 0 ? (
          <div className="pos-empty">
            <strong>Tell JATA where you get paid</strong>
            <p>
              Enter your M-PESA till, PayBill, bank account or Paystack account. That is the whole setup — JATA handles
              the rest.
            </p>
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="jata-card p-4 space-y-3">
          <div>
            <p className="jata-kicker">Add</p>
            <h3 className="text-base font-semibold">Where should your customers pay?</h3>
          </div>

          <div className="pos-form">
            <div className="jata-field">
              <label className="jata-label" htmlFor="wallet-kind">Type</label>
              <select id="wallet-kind" className="jata-input" value={kind} onChange={(event) => setKind(event.target.value)}>
                {(wallet.tiles ?? [])
                  .filter((tile) => tile.available)
                  .map((tile) => (
                    <option key={tile.kind} value={tile.kind}>{tile.title} · {tile.subtitle}</option>
                  ))}
              </select>
            </div>

            <div className="jata-field">
              <label className="jata-label" htmlFor="wallet-number">
                {needsBank ? "Account number" : kind === "PAYSTACK" ? "Paystack account reference" : "Till or PayBill number"}
              </label>
              <input id="wallet-number" className="jata-input" value={number} onChange={(event) => setNumber(event.target.value)} inputMode="numeric" />
              <p className="jata-hint">JATA checks the format before saving, and asks the provider to confirm it.</p>
            </div>

            {needsAccount ? (
              <div className="jata-field">
                <label className="jata-label" htmlFor="wallet-account">PayBill account number</label>
                <input id="wallet-account" className="jata-input" value={accountRef} onChange={(event) => setAccountRef(event.target.value)} />
              </div>
            ) : null}

            {needsBank ? (
              <>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="wallet-bank">Bank</label>
                  <input id="wallet-bank" className="jata-input" value={bankName} onChange={(event) => setBankName(event.target.value)} />
                </div>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="wallet-name">Account name</label>
                  <input id="wallet-name" className="jata-input" value={accountRef} onChange={(event) => setAccountRef(event.target.value)} />
                </div>
              </>
            ) : null}

            {destinations.length > 0 ? (
              <>
                <label className="pos-option">
                  <input type="checkbox" checked={confirming} onChange={(event) => setConfirming(event.target.checked)} />
                  I am the owner and I am changing where this business gets paid.
                </label>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="wallet-password">Your password (optional)</label>
                  <input id="wallet-password" className="jata-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                </div>
              </>
            ) : null}
          </div>

          {localError ? <p className="jata-error" role="alert">{localError}</p> : null}
          {localNote ? <p className="pos-note" role="status">{localNote}</p> : null}

          <div className="pos-form-actions">
            <button type="button" className="jata-btn jata-btn-primary" onClick={add} disabled={busy || !number.trim()}>
              {busy ? "Saving…" : "Save payment account"}
            </button>
          </div>
          <p className="pos-note">
            No API keys, no webhooks, no endpoints. JATA owns the provider connection; you own the account the money
            lands in.
          </p>
        </div>
      ) : (
        <p className="pos-note">Only the owner can change where the business gets paid.</p>
      )}

      <div className="jata-card p-4 space-y-3">
        <div>
          <p className="jata-kicker">Provider connections</p>
          <h3 className="text-base font-semibold">JATA&apos;s connections to your payment providers</h3>
          <p className="pos-note">
            Authorizing here tells JATA it may receive your payments from that provider. It is a one-tap decision — you
            never paste a key or configure anything.
          </p>
        </div>
        {(wallet.providers ?? []).map((provider: any) => (
          <div className="pos-row" key={provider.key}>
            <div className="pos-row-main">
              <strong>{provider.label}</strong>
              <small>{provider.summary}</small>
            </div>
            <div className="pos-row-values">
              <span className="pos-pill" data-tone={provider.connectorReady ? "success" : "warn"}>
                {provider.connectorReady ? "JATA connector ready" : provider.comingSoon ? "Coming soon" : "Not configured in this environment"}
              </span>
              {canManage && provider.available && provider.connectorReady ? (
                <button
                  type="button"
                  className="jata-btn jata-btn-secondary"
                  disabled={busy}
                  onClick={async () => {
                    const data = await act(`/payments/connections/${encodeURIComponent(provider.key)}`, { confirm: true });
                    if (data) {
                      setLocalNote(`${provider.label} is authorized for this business.`);
                      await onChanged();
                    }
                  }}
                >
                  Authorize
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {history?.length ? (
        <div className="jata-card p-4 space-y-2">
          <p className="jata-kicker">Recent changes</p>
          {history.map((entry, index) => (
            <p className="pos-note" key={`${entry.at}-${index}`}>
              {new Date(entry.at).toLocaleString("en-KE")} · {entry.summary}
              {entry.actorName ? ` — ${entry.actorName}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ── Health (§72) ───────────────────────────────────────────────────────────────────────── */

function HealthTab({ health }: { health: any }) {
  const rows: { label: string; value: string; tone?: string; detail?: string }[] = Array.isArray(health?.rows)
    ? health.rows
    : [];
  if (!rows.length) return <p className="pos-note">We couldn&apos;t load payment health.</p>;
  return (
    <section className="jata-card p-4 space-y-2">
      <div>
        <p className="jata-kicker">Health</p>
        <h3 className="text-base font-semibold">How payments are doing</h3>
        <p className="pos-note">Plain language only — if something needs attention, it says what to do about it.</p>
      </div>
      {rows.map((row) => (
        <div className="pos-row" key={row.label}>
          <div className="pos-row-main">
            <strong>{row.label}</strong>
            {row.detail ? <small>{row.detail}</small> : null}
          </div>
          <div className="pos-row-values">
            <span className="pos-pill" data-tone={row.tone ?? "neutral"}>{row.value || "—"}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

/* ── Books (§43, §44) ───────────────────────────────────────────────────────────────────── */

function ReconciliationTab({
  businessId,
  daily,
  exceptions,
  canReconcile,
  busy,
  act,
  onChanged,
}: {
  businessId: string;
  daily: any;
  exceptions: Exception[];
  canReconcile: boolean;
  busy: boolean;
  act: (path: string, body?: Record<string, unknown>, method?: string) => Promise<any>;
  onChanged: (data: any) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <section className="space-y-4">
      <dl className="jata-stat-grid">
        <div className="jata-stat"><dt>Confirmed wallet payments today</dt><dd>KES {Number(daily?.confirmedPaymentsKES ?? 0).toLocaleString("en-KE")}</dd></div>
        <div className="jata-stat"><dt>Wallet sales today (net of refunds)</dt><dd>KES {Number(daily?.posSalesKES ?? 0).toLocaleString("en-KE")}</dd></div>
        <div className="jata-stat"><dt>Refunded today</dt><dd>KES {Number(daily?.refundedKES ?? 0).toLocaleString("en-KE")}</dd></div>
        <div className="jata-stat"><dt>Payments matched to a sale</dt><dd>{Number(daily?.settled ?? 0)} of {Number(daily?.transactions ?? 0)}</dd></div>
        <div className="jata-stat"><dt>Every payment matched?</dt><dd>{reconciliationStatusLabel(daily)}</dd></div>
        <div className="jata-stat"><dt>Waiting for an explanation</dt><dd>{Number(daily?.exceptions ?? 0)}</dd></div>
      </dl>

      {exceptions.length === 0 && !(daily && Number(daily.mismatches ?? 0) > 0) ? (
        <div className="pos-empty">
          <strong>Everything lines up</strong>
          <p>Every confirmed wallet payment is matched to the sale it settled. Nothing needs your attention today.</p>
        </div>
      ) : (
        <div className="pos-rows">
          {exceptions.map((exception) => (
            <div className="pos-row" key={exception.id}>
              <div className="pos-row-main">
                <strong>{EXCEPTION_LABELS[exception.result] ?? exception.result}</strong>
                <small>
                  {new Date(exception.createdAt).toLocaleString("en-KE")} · {exception.provider}
                  {exception.providerReference ? ` · ${exception.providerReference}` : ""}
                  {exception.jataPaymentId ? ` · ${exception.jataPaymentId}` : ""}
                </small>
                {exception.notes ? <small>{exception.notes}</small> : null}
              </div>
              <div className="pos-row-values">
                {exception.receivedAmountMinor != null ? (
                  <span>KES {(Number(exception.receivedAmountMinor) / 100).toLocaleString("en-KE")}</span>
                ) : null}
                {exception.differenceMinor ? (
                  <span className="pos-pill" data-tone="warn">Difference KES {(Number(exception.differenceMinor) / 100).toLocaleString("en-KE")}</span>
                ) : null}
              </div>
              {canReconcile && exception.transactionId ? (
                <div className="pos-row-actions">
                  <input
                    className="jata-input"
                    placeholder="Why does this match?"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    aria-label="Reason for matching this payment"
                  />
                  <button
                    type="button"
                    className="jata-btn jata-btn-secondary"
                    disabled={busy || reason.trim().length < 5}
                    onClick={async () => {
                      const data = await act("/payments/reconciliation", { reconciliationId: exception.id, transactionId: exception.transactionId, reason });
                      if (data) {
                        setReason("");
                        onChanged(data);
                      }
                    }}
                  >
                    Match by hand
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <p className="pos-note">
        Matching by hand records your decision and who made it. It never invents a provider confirmation — the payment
        keeps whatever the provider said.
      </p>
      <p className="pos-note">Business {businessId}</p>
    </section>
  );
}

/* ── One payment (§32, §47, §69) ────────────────────────────────────────────────────────── */

function PaymentDrawer({
  businessId,
  payment,
  detail,
  canRefund,
  busy,
  act,
  onClose,
  onChanged,
}: {
  businessId: string;
  payment: Payment;
  detail: any;
  canRefund: boolean;
  busy: boolean;
  act: (path: string, body?: Record<string, unknown>, method?: string) => Promise<any>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [amountKES, setAmountKES] = useState(Math.max(0, payment.paidKES - payment.refundedKES));
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNote, setLocalNote] = useState<string | null>(null);

  const refundable = Math.max(0, payment.paidKES - payment.refundedKES);

  return (
    <section className="jata-sheet" data-payment-drawer="true">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{payment.providerLabel}</p>
          <h3 className="text-base font-semibold">{payment.jataPaymentId}</h3>
        </div>
        <button type="button" className="jata-btn jata-btn-ghost" onClick={onClose}>Close</button>
      </div>

      <div className="pos-row-values">
        <span className="pos-pill" data-tone={payment.tone}>{payment.statusLabel}</span>
        <span>KES {payment.amountKES.toLocaleString("en-KE")}</span>
        {payment.receiptNumber ? <span className="pos-note">{payment.receiptNumber}</span> : null}
      </div>

      {detail?.timeline?.length ? (
        <div className="space-y-1">
          <p className="jata-kicker">What happened</p>
          {(detail.timeline as any[]).map((entry, index) => (
            <p className="pos-note" key={`${entry.at}-${index}`}>
              {new Date(entry.at).toLocaleString("en-KE")} · {entry.label}
              {entry.summary ? ` — ${entry.summary}` : ""}
            </p>
          ))}
        </div>
      ) : null}

      {detail?.refunds?.length ? (
        <div className="space-y-1">
          <p className="jata-kicker">Money returned</p>
          {(detail.refunds as any[]).map((refund) => (
            <p className="pos-note" key={refund.id}>
              KES {Number(refund.amountKES).toLocaleString("en-KE")} · {refund.status} · {refund.reason}
              {refund.initiatedByName ? ` — ${refund.initiatedByName}` : ""}
            </p>
          ))}
        </div>
      ) : null}

      {canRefund && refundable > 0 ? (
        <div className="jata-card p-4 space-y-3">
          <div>
            <p className="jata-kicker">Refund</p>
            <h4 className="text-sm font-semibold">Send money back through the provider</h4>
            <p className="pos-note">KES {refundable.toLocaleString("en-KE")} is left to refund on this payment.</p>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="refund-amount">Amount (KES)</label>
            <input id="refund-amount" className="jata-input" type="number" min={0} max={refundable} value={amountKES || ""} onChange={(event) => setAmountKES(Math.max(0, Number(event.target.value)))} />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="refund-reason">Why is this going back?</label>
            <input id="refund-reason" className="jata-input" value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <label className="pos-option">
            <input type="checkbox" checked={confirming} onChange={(event) => setConfirming(event.target.checked)} />
            I have confirmed this refund with the customer or the owner.
          </label>
          <div className="jata-field">
            <label className="jata-label" htmlFor="refund-password">Your password (optional)</label>
            <input id="refund-password" className="jata-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </div>
          {localError ? <p className="jata-error" role="alert">{localError}</p> : null}
          {localNote ? <p className="pos-note" role="status">{localNote}</p> : null}
          <button
            type="button"
            className="jata-btn jata-btn-secondary"
            disabled={busy || !confirming || amountKES <= 0 || reason.trim().length < 4}
            onClick={async () => {
              setLocalError(null);
              setLocalNote(null);
              const data = await act(`/payments/${encodeURIComponent(payment.id)}/refund`, {
                amountKES,
                reason,
                confirm: true,
                password: password || undefined,
              });
              if (!data) {
                setLocalError("We couldn't send that refund.");
                return;
              }
              const refundStatus = String(data.status ?? "");
              // Only a COMPLETED refund is described as done. A pending one is not complete until the
              // provider's own confirmation arrives, and its amount stays reserved until then.
              setLocalNote(
                refundStatus === "COMPLETED"
                  ? "Refund completed through the provider."
                  : refundStatus === "PENDING_PROVIDER"
                    ? "Refund sent. It is not complete until the provider confirms it — the amount stays reserved until then."
                    : `Refund ${refundStatus.toLowerCase().replace(/_/g, " ")}.`,
              );
              await onChanged();
            }}
          >
            {busy ? "Sending…" : "Send refund"}
          </button>
          <p className="pos-note">
            The original payment is never edited. A refund is its own record, with your name on it. Business {businessId}
          </p>
        </div>
      ) : null}
    </section>
  );
}
