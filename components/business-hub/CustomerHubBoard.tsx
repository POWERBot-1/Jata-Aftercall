"use client";

/**
 * Smart Customer Hub board (Business Hub B).
 *
 * One screen for everything a customer sends: order requests and enquiries, with search, status
 * filters, internal notes, contact actions and the shared activity history. No external CRM —
 * every row is a JATA record read through the tenant-scoped hub API.
 *
 * Contact actions open an ordinary phone call or a `wa.me` conversation with the number the
 * customer gave. No WhatsApp Business API, no messaging integration, nothing sent on the owner's
 * behalf.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, MessageSquare, Phone, Search, ShoppingBasket, Star } from "lucide-react";
import { formatDateTime, formatKES, maskPhone } from "@/lib/format";
import { normalizeKePhone, getWhatsAppUrl } from "@/lib/phone";

type RequestItem = { id: string; name: string; quantity: number; unitPriceKES: number; lineTotalKES: number };

export type HubOrderRequest = {
  id: string;
  reference: string;
  customerName: string;
  contactMethod: string;
  contactValue: string;
  message: string | null;
  status: string;
  estimatedTotalKES: number;
  ownerNotes: string | null;
  createdAt: string;
  updatedAt: string;
  items: RequestItem[];
};

export type HubEnquiry = {
  id: string;
  reference: string;
  customerName: string;
  contactMethod: string;
  contactValue: string;
  subject: string | null;
  message: string;
  status: string;
  ownerNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HubActivity = {
  id: string;
  subjectType: string;
  kind: string;
  summary: string;
  note: string | null;
  actorLabel: string | null;
  createdAt: string;
};

export type HubStats = {
  total: number;
  byStatus: Record<string, number>;
  confirmedOrCompleted: number;
  conversionRate: number;
  openRequests: number;
  estimatedValueKES: number;
};

const REQUEST_STATUSES = ["NEW", "REVIEWING", "CONFIRMED", "DECLINED", "COMPLETED", "CANCELLED"] as const;
const ENQUIRY_STATUSES = ["NEW", "REVIEWING", "CONTACTED", "CLOSED", "DECLINED"] as const;

const TONE: Record<string, string> = {
  NEW: "info",
  REVIEWING: "warning",
  CONFIRMED: "success",
  COMPLETED: "success",
  CONTACTED: "success",
  DECLINED: "danger",
  CANCELLED: "neutral",
  CLOSED: "neutral",
};

function StatusSelect({
  value,
  statuses,
  disabled,
  onChange,
  label,
}: {
  value: string;
  statuses: readonly string[];
  disabled: boolean;
  onChange: (next: string) => void;
  label: string;
}) {
  return (
    <div className="jata-field">
      <label className="jata-label" htmlFor={label}>
        Status
      </label>
      <select
        id={label}
        className="jata-input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {statuses.map((status) => (
          <option key={status} value={status}>
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
    </div>
  );
}

function contactActions(entry: { contactMethod: string; contactValue: string; customerName: string; reference: string }) {
  if (entry.contactMethod === "EMAIL") {
    return (
      <a className="jata-btn jata-btn-secondary" href={`mailto:${entry.contactValue}?subject=${encodeURIComponent(`Your request ${entry.reference}`)}`}>
        Email {entry.customerName}
      </a>
    );
  }
  if (entry.contactMethod === "IN_PERSON") return null;
  const digits = normalizeKePhone(entry.contactValue);
  if (!digits) return null;
  const text = `Hi ${entry.customerName}, this is the business replying about your request ${entry.reference}.`;
  return (
    <div className="flex flex-wrap gap-2">
      <a className="jata-btn jata-btn-secondary" href={getWhatsAppUrl(digits, text)} target="_blank" rel="noopener noreferrer">
        <MessageSquare size={15} aria-hidden="true" /> WhatsApp
      </a>
      <a className="jata-btn jata-btn-secondary" href={`tel:+${digits}`}>
        <Phone size={15} aria-hidden="true" /> Call
      </a>
    </div>
  );
}

export function CustomerHubBoard({
  businessId,
  requests: initialRequests,
  enquiries: initialEnquiries,
  activity,
  stats,
  loyaltySummary,
}: {
  businessId: string;
  requests: HubOrderRequest[];
  enquiries: HubEnquiry[];
  activity: HubActivity[];
  stats: HubStats;
  loyaltySummary: { cards: number; stampsAwarded: number; rewardsRedeemed: number };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"requests" | "enquiries" | "activity">("requests");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLowerCase();
    return initialRequests.filter((entry) => {
      if (statusFilter !== "ALL" && entry.status !== statusFilter) return false;
      if (!term) return true;
      return [entry.reference, entry.customerName, entry.contactValue, entry.message ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [initialRequests, search, statusFilter]);

  const filteredEnquiries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return initialEnquiries.filter((entry) => {
      if (statusFilter !== "ALL" && entry.status !== statusFilter) return false;
      if (!term) return true;
      return [entry.reference, entry.customerName, entry.contactValue, entry.subject ?? "", entry.message]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [initialEnquiries, search, statusFilter]);

  async function patchRequest(entry: HubOrderRequest, body: Record<string, unknown>) {
    setBusyId(entry.id);
    setError(null);
    try {
      const response = await fetch(`/api/business/${businessId}/order-requests/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't save that update.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("We couldn't reach the server. Please try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function patchEnquiry(entry: HubEnquiry, body: Record<string, unknown>) {
    setBusyId(entry.id);
    setError(null);
    try {
      const response = await fetch(`/api/business/${businessId}/enquiries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't save that update.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("We couldn't reach the server. Please try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <dl className="jata-stat-grid">
        <div className="jata-stat">
          <dt>Requests</dt>
          <dd>{stats.total}</dd>
        </div>
        <div className="jata-stat">
          <dt>Open</dt>
          <dd>{stats.openRequests}</dd>
        </div>
        <div className="jata-stat">
          <dt>Confirmed or completed</dt>
          <dd>{stats.confirmedOrCompleted}</dd>
        </div>
        <div className="jata-stat">
          <dt>Conversion</dt>
          <dd>{stats.conversionRate}%</dd>
        </div>
        <div className="jata-stat">
          <dt>Requested value</dt>
          <dd>{formatKES(stats.estimatedValueKES)}</dd>
        </div>
        <div className="jata-stat">
          <dt>Loyalty cards</dt>
          <dd>
            {loyaltySummary.cards} · {loyaltySummary.stampsAwarded} stamps
          </dd>
        </div>
      </dl>
      <p className="jata-hint">
        “Confirmed” is the business saying yes — it is not a payment. Conversion is measured from the statuses you set.
      </p>

      <div className="jata-toolbar">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Customer hub sections">
          <button type="button" className={`jata-btn ${tab === "requests" ? "jata-btn-primary" : "jata-btn-secondary"}`} aria-pressed={tab === "requests"} onClick={() => setTab("requests")}>
            <ShoppingBasket size={15} aria-hidden="true" /> Order requests ({initialRequests.length})
          </button>
          <button type="button" className={`jata-btn ${tab === "enquiries" ? "jata-btn-primary" : "jata-btn-secondary"}`} aria-pressed={tab === "enquiries"} onClick={() => setTab("enquiries")}>
            <MessageSquare size={15} aria-hidden="true" /> Enquiries ({initialEnquiries.length})
          </button>
          <button type="button" className={`jata-btn ${tab === "activity" ? "jata-btn-primary" : "jata-btn-secondary"}`} aria-pressed={tab === "activity"} onClick={() => setTab("activity")}>
            <History size={15} aria-hidden="true" /> Activity
          </button>
        </div>
      </div>

      {tab !== "activity" ? (
        <div className="jata-toolbar">
          <div className="jata-field flex-1">
            <label className="jata-label" htmlFor="hub-search">
              Search
            </label>
            <div className="relative">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                id="hub-search"
                className="jata-input pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, reference, phone or message"
              />
            </div>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="hub-status">
              Status
            </label>
            <select id="hub-status" className="jata-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ALL">All</option>
              {(tab === "requests" ? REQUEST_STATUSES : ENQUIRY_STATUSES).map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0) + status.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="jata-error text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {tab === "requests" ? (
        filteredRequests.length === 0 ? (
          <div className="jata-empty">
            <p className="text-sm font-semibold">No order requests yet</p>
            <p className="mt-1 text-sm text-zinc-600">
              Customers can send requests from your published page as soon as you have products in your catalogue.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredRequests.map((entry) => (
              <li key={entry.id} className="jata-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{entry.reference}</p>
                    <p className="text-xs text-zinc-600">{formatDateTime(entry.createdAt)}</p>
                  </div>
                  <span className="jata-pill" data-tone={TONE[entry.status] ?? "neutral"}>
                    {entry.status}
                  </span>
                </div>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-widest text-zinc-500">Customer</dt>
                    <dd>
                      {entry.customerName} · {entry.contactMethod.toLowerCase()}
                      {entry.contactValue ? ` · ${entry.contactMethod === "EMAIL" ? entry.contactValue : maskPhone(entry.contactValue)}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-widest text-zinc-500">Estimated total</dt>
                    <dd className="font-semibold">{formatKES(entry.estimatedTotalKES)}</dd>
                  </div>
                </dl>

                <ul className="mt-3 space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  {entry.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {item.name} × {item.quantity}
                      </span>
                      <span className="shrink-0 font-semibold">{formatKES(item.lineTotalKES)}</span>
                    </li>
                  ))}
                </ul>

                {entry.message ? (
                  <p className="mt-3 rounded-xl border border-zinc-200 p-3 text-sm">
                    <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Customer message</span>
                    <br />
                    {entry.message}
                  </p>
                ) : null}

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <StatusSelect
                    label={`status-${entry.id}`}
                    value={entry.status}
                    statuses={REQUEST_STATUSES}
                    disabled={busyId === entry.id}
                    onChange={(next) => patchRequest(entry, { status: next })}
                  />
                  <div className="jata-field">
                    <label className="jata-label" htmlFor={`notes-${entry.id}`}>
                      Internal note (never shown to the customer)
                    </label>
                    <textarea
                      id={`notes-${entry.id}`}
                      className="jata-input min-h-20"
                      defaultValue={entry.ownerNotes ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [entry.id]: event.target.value }))}
                      maxLength={2000}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="jata-btn jata-btn-primary"
                    disabled={busyId === entry.id}
                    onClick={() => patchRequest(entry, { notes: notes[entry.id] ?? entry.ownerNotes ?? "" })}
                  >
                    {busyId === entry.id ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
                    Save note
                  </button>
                  {contactActions(entry)}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "enquiries" ? (
        filteredEnquiries.length === 0 ? (
          <div className="jata-empty">
            <p className="text-sm font-semibold">No enquiries yet</p>
            <p className="mt-1 text-sm text-zinc-600">Messages sent from your business page arrive here.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredEnquiries.map((entry) => (
              <li key={entry.id} className="jata-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{entry.reference}</p>
                    <p className="text-xs text-zinc-600">{formatDateTime(entry.createdAt)}</p>
                  </div>
                  <span className="jata-pill" data-tone={TONE[entry.status] ?? "neutral"}>
                    {entry.status}
                  </span>
                </div>
                <p className="mt-2 text-sm">
                  <span className="font-semibold">{entry.customerName}</span> · {entry.contactMethod.toLowerCase()}
                  {entry.contactValue ? ` · ${entry.contactMethod === "EMAIL" ? entry.contactValue : maskPhone(entry.contactValue)}` : ""}
                </p>
                {entry.subject ? <p className="mt-2 text-sm font-semibold">{entry.subject}</p> : null}
                <p className="mt-1 rounded-xl border border-zinc-200 p-3 text-sm">{entry.message}</p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <StatusSelect
                    label={`enquiry-status-${entry.id}`}
                    value={entry.status}
                    statuses={ENQUIRY_STATUSES}
                    disabled={busyId === entry.id}
                    onChange={(next) => patchEnquiry(entry, { status: next })}
                  />
                  <div className="jata-field">
                    <label className="jata-label" htmlFor={`enquiry-notes-${entry.id}`}>
                      Internal note
                    </label>
                    <textarea
                      id={`enquiry-notes-${entry.id}`}
                      className="jata-input min-h-20"
                      defaultValue={entry.ownerNotes ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [entry.id]: event.target.value }))}
                      maxLength={2000}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="jata-btn jata-btn-primary"
                    disabled={busyId === entry.id}
                    onClick={() => patchEnquiry(entry, { notes: notes[entry.id] ?? entry.ownerNotes ?? "" })}
                  >
                    {busyId === entry.id ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
                    Save note
                  </button>
                  {contactActions(entry)}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "activity" ? (
        activity.length === 0 ? (
          <div className="jata-empty">
            <p className="text-sm font-semibold">Nothing has happened yet</p>
            <p className="mt-1 text-sm text-zinc-600">Every request, enquiry, status change, stamp and reward is recorded here.</p>
          </div>
        ) : (
          <ol className="space-y-2">
            {activity.map((entry) => (
              <li key={entry.id} className="flex gap-3 rounded-xl border border-zinc-200 p-3 text-sm">
                <Star size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-zinc-400" />
                <div className="min-w-0">
                  <p className="font-medium">{entry.summary}</p>
                  <p className="text-xs text-zinc-600">
                    {formatDateTime(entry.createdAt)}
                    {entry.actorLabel ? ` · ${entry.actorLabel}` : " · customer"}
                  </p>
                  {entry.note ? <p className="mt-1 text-xs text-zinc-600">{entry.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}

export default CustomerHubBoard;
