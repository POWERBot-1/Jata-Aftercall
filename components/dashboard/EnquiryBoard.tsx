"use client";

import { useCallback, useEffect, useState } from "react";
import type { OwnerEnquiry } from "@/lib/experience/enquiries";

/** Private owner ledger. Receiving a request is not confirming an appointment/payment or sending marketing. */
export function EnquiryBoard({ businessId }: { businessId: string }) {
  const [enquiries, setEnquiries] = useState<OwnerEnquiry[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/storefront/enquiry?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.enquiries)) { setError(data.error || "We couldn't load your enquiries."); return; }
      setEnquiries(data.enquiries);
    } catch { setError("We couldn't reach the server. Please try again."); }
    finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);
  return <section className="jata-card" aria-labelledby="professional-enquiries" data-enquiry-board="professional">
    <div className="jata-toolbar"><h2 id="professional-enquiries" className="text-sm font-bold">Professional enquiries</h2>
      <button type="button" className="jata-btn jata-btn-secondary" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh enquiries"}</button></div>
    <p className="jata-hint">Requests for a reply only. No appointment or payment is confirmed, and customers are not added to marketing lists.</p>
    {error ? <p role="alert" className="jata-error">{error}</p> : loading ? <p role="status">Loading enquiries…</p> : enquiries.length === 0 ? <p>No enquiries received yet.</p> :
      <ul className="mt-3 space-y-3">{enquiries.map((enquiry) => <li key={enquiry.id} className="rounded-xl border p-3" data-enquiry-id={enquiry.id}>
        <h3 className="font-semibold">{enquiry.serviceName}</h3><p>{enquiry.customerName} · received</p>
        <p>{enquiry.customerPhone ? <a className="underline" href={`tel:${enquiry.customerPhone.replace(/[^+0-9]/g, "")}`}>{enquiry.customerPhone}</a> : null}
          {enquiry.customerEmail ? <> · <a className="underline" href={`mailto:${encodeURIComponent(enquiry.customerEmail)}`}>{enquiry.customerEmail}</a></> : null}</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{enquiry.summary}</p>
      </li>)}</ul>}
  </section>;
}
