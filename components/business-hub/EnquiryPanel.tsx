"use client";

/**
 * A general customer enquiry for the classic Business Page (Smart Customer Hub, feature B).
 *
 * Kept deliberately short — two fields and a message — because the page already carries contact
 * buttons. This exists so an enquiry is RECORDED in the owner's hub rather than only sent to a
 * phone the owner may not be watching.
 */

import { useState } from "react";
import { CheckCircle2, Loader2, MessageSquare } from "lucide-react";

export function EnquiryPanel({ slug, businessName }: { slug: string; businessName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<"WHATSAPP" | "PHONE" | "EMAIL" | "IN_PERSON">("WHATSAPP");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot: a field no person ever fills. A submission that carries it is dropped silently.
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const requestKey = useState(() =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )[0];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/public/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, requestKey, website, customerName: name, contactMethod: method, contactValue: contact, message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't send your message. Please try again.");
        return;
      }
      setReference(data.reference);
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return (
      <section id="enquiry" className="st-section st-hub-panel" aria-labelledby="enquiry-title">
        <h2 id="enquiry-title" className="st-sectionTitle st-hub-panel__title flex items-center gap-2">
          <CheckCircle2 size={18} aria-hidden="true" className="text-emerald-600" />
          Message sent
        </h2>
        <p className="mt-2 text-sm" role="status">
          {businessName} has your message and will reply directly. Your reference is{" "}
          <span className="font-bold">{reference}</span>.
        </p>
        <p className="jata-hint mt-2">Nothing has been booked or paid for — this is an enquiry, not a booking.</p>
        <button
          type="button"
          className="jata-btn jata-btn-secondary mt-3"
          onClick={() => {
            setReference(null);
            setMessage("");
          }}
        >
          Send another message
        </button>
      </section>
    );
  }

  return (
    <section id="enquiry" className="st-section st-hub-panel" aria-labelledby="enquiry-title">
      <h2 id="enquiry-title" className="st-sectionTitle st-hub-panel__title flex items-center gap-2">
        <MessageSquare size={18} aria-hidden="true" />
        Ask {businessName} a question
      </h2>
      {!open ? (
        <>
          <p className="jata-hint mt-1">
            Send a question and it lands in the business&apos;s customer hub, so nothing gets lost in a busy inbox.
          </p>
          <button type="button" className="jata-btn jata-btn-secondary mt-3" onClick={() => setOpen(true)}>
            Write a message
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="jata-field">
            <label className="jata-label" htmlFor="enquiry-name">
              Your name
            </label>
            <input
              id="enquiry-name"
              className="jata-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoComplete="name"
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="enquiry-method">
                Reply by
              </label>
              <select
                id="enquiry-method"
                className="jata-input"
                value={method}
                onChange={(event) => setMethod(event.target.value as typeof method)}
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="PHONE">Phone call</option>
                <option value="EMAIL">Email</option>
                <option value="IN_PERSON">In person</option>
              </select>
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="enquiry-contact">
                {method === "EMAIL" ? "Your email" : method === "IN_PERSON" ? "Where to find you" : "Your phone number"}
              </label>
              <input
                id="enquiry-contact"
                className="jata-input"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                maxLength={60}
                inputMode={method === "EMAIL" ? "email" : method === "IN_PERSON" ? "text" : "tel"}
                required
              />
            </div>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="enquiry-message">
              Your message
            </label>
            <textarea
              id="enquiry-message"
              className="jata-input min-h-24"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={1000}
              required
              placeholder="What would you like to know?"
            />
          </div>
          <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
            <label htmlFor="enquiry-website">Website</label>
            <input id="enquiry-website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
          </div>
          {error ? (
            <p className="jata-error text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="jata-btn jata-btn-primary" disabled={busy}>
              {busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : null}
              {busy ? "Sending…" : "Send message"}
            </button>
            <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default EnquiryPanel;
