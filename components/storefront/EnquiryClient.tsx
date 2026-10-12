"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatKES } from "@/lib/format";
import { isBookableConsultation } from "@/lib/experience/professionalWorkflow";

export type EnquiryService = { id: string; name: string; description: string | null; kind: "service";
  price: number | null; pricingType: "FIXED" | "QUOTE"; bookingEnabled: boolean };
export function EnquiryClient({ slug, services, preselectedId, preview = false }: {
  slug: string; services: EnquiryService[]; preselectedId?: string; preview?: boolean;
}) {
  const [serviceId, setServiceId] = useState(preselectedId || services[0]?.id || "");
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(""); const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const replay = useRef<{ signature: string; key: string } | null>(null);
  const selected = services.find((service) => service.id === serviceId);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || preview) return;
    setError(null);
    if (!selected) return setError("Choose a service from this business.");
    if (name.trim().length < 2) return setError("Enter your name so the business knows who to contact.");
    if (phone.replace(/\D/g, "").length < 9) return setError("Enter a valid phone number.");
    const fields = { slug, serviceId, customerName: name.trim(), customerPhone: phone.trim(), customerEmail: email.trim() || null, notes: notes.trim() };
    const signature = JSON.stringify(fields);
    if (replay.current?.signature !== signature) {
      const key = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      replay.current = { signature, key };
    }
    setBusy(true);
    try {
      const response = await fetch("/api/storefront/enquiry", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, idempotencyKey: replay.current.key }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.received !== true || typeof data.enquiry?.id !== "string") { setError(data.error || "We couldn't save your enquiry. Please try again."); return; }
      setDone(data.enquiry?.serviceName || selected.name);
      // No contact information is placed in localStorage, analytics or a public receipt URL.
      setName(""); setPhone(""); setEmail(""); setNotes("");
    } catch { setError("We couldn't reach the server. Your details are still here; retry to send the same request safely."); }
    finally { setBusy(false); }
  }
  if (done) return <div className="eb-card" style={{ padding: "1.25rem" }} role="status" data-enquiry-received="true">
    <h2 className="eb-h2">Enquiry received</h2><p>About {done}. The business will reply directly.</p>
    <p className="eb-muted">No appointment or payment has been confirmed.</p>
    <Link className="eb-btn eb-btn--outline" href={`/b/${slug}`}>Back to the business</Link>
  </div>;
  if (services.length === 0) return <div className="eb-empty"><h2 className="eb-h3">No services listed yet</h2><p>Please use the business&apos;s contact links to ask about your request.</p></div>;
  return <form onSubmit={submit} style={{ display: "grid", gap: "1rem", maxWidth: "36rem", minWidth: 0 }} data-enquiry-form="professional">
    <p className="eb-muted">Send your requirements without choosing an appointment or making a payment. This is a request for a reply, not a confirmed booking.</p>
    {preview ? <p className="eb-preview-banner" role="status">Draft preview — enquiries cannot be submitted until this website is published.</p> : null}
    <fieldset disabled={busy || preview} style={{ display: "grid", gap: "1rem", border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="eb-sr">Your service enquiry</legend>
      <div className="eb-field"><label className="eb-label" htmlFor="eq-service">What do you need?</label>
        <select id="eq-service" className="eb-select" value={serviceId} onChange={(event) => setServiceId(event.target.value)} required>
          {services.map((service) => <option key={service.id} value={service.id}>{service.name}{service.pricingType === "QUOTE" || service.price === null ? " · request a quote" : ` · ${formatKES(service.price)}`}</option>)}
        </select>
        {selected?.description ? <p className="eb-muted">{selected.description}</p> : null}
      </div>
      <div className="eb-field"><label className="eb-label" htmlFor="eq-name">Your name</label><input id="eq-name" className="eb-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" required /></div>
      <div className="eb-field"><label className="eb-label" htmlFor="eq-phone">Phone</label><input id="eq-phone" className="eb-input" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} autoComplete="tel" required /></div>
      <div className="eb-field"><label className="eb-label" htmlFor="eq-email">Email (optional)</label><input id="eq-email" className="eb-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={160} autoComplete="email" /></div>
      <div className="eb-field"><label className="eb-label" htmlFor="eq-notes">Tell us what you need</label><textarea id="eq-notes" className="eb-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={5} /></div>
      {error ? <p className="eb-error" role="alert">{error}</p> : null}
      <button className="eb-btn" type="submit" disabled={busy || preview}>{busy ? "Sending…" : "Send enquiry"}</button>
    </fieldset>
    <noscript><p>JavaScript is needed to send this form. Your service details are above; please use Call or WhatsApp below to contact the business directly.</p></noscript>
    {selected && isBookableConsultation(selected) ? <p><Link className="eb-btn eb-btn--outline" href={`/b/${slug}/book?service=${encodeURIComponent(selected.id)}`}>Book this consultation instead</Link></p> : null}
  </form>;
}
