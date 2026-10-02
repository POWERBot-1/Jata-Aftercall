"use client";

/**
 * Booking & enquiry flow (§9, §11, §12, §29)
 *
 * Service businesses book time; property and quote businesses collect a request. The same
 * component serves both. Slots are always fetched from the server, so two customers can
 * never take the same appointment.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { trackEvent } from "./Track";
import { formatDuration, formatKES } from "@/lib/format";

type Bookable = {
  id: string;
  name: string;
  kind: "product" | "service";
  durationMinutes: number | null;
  depositKES: number | null;
  price: number | null;
  pricingType: string;
  imageUrl: string | null;
  description: string | null;
};

export function BookingClient({
  slug,
  businessId,
  bookables,
  preselectedId,
  enquiryItemId,
  enquiryItemName,
  ctaLabel,
  confirmationLabel,
  requireDate,
}: {
  slug: string;
  businessId: string;
  bookables: Bookable[];
  preselectedId?: string;
  enquiryItemId?: string;
  enquiryItemName?: string;
  ctaLabel: string;
  confirmationLabel: string;
  /** Property enquiries and quote requests still ask when the customer is free. */
  requireDate: boolean;
}) {
  const selected = bookables.find((entry) => entry.id === preselectedId) || bookables[0] || null;
  const [serviceId, setServiceId] = useState<string>(selected?.id || "");
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [staffName, setStaffName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; serviceName: string; startAt: string; message: string } | null>(null);

  const isEnquiry = !preselectedId && Boolean(enquiryItemId);

  useEffect(() => {
    if (!serviceId || !requireDate) return;
    let cancelled = false;
    async function load() {
      setLoadingSlots(true);
      try {
        const response = await fetch(`/api/storefront/booking?slug=${encodeURIComponent(slug)}&serviceId=${encodeURIComponent(serviceId)}&date=${date}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!cancelled) setSlots(Array.isArray(data.slots) ? data.slots : []);
      } catch {
        if (!cancelled) setSlots([]);
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    }
    if (date) void load();
    return () => {
      cancelled = true;
    };
  }, [serviceId, date, slug, requireDate]);

  const openDays = useMemo(() => {
    // Next 14 days; the server still validates the final choice.
    const days: string[] = [];
    const today = new Date();
    for (let offset = 0; offset < 21 && days.length < 14; offset += 1) {
      const candidate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      days.push(candidate.toISOString().slice(0, 10));
    }
    return days;
  }, []);

  async function submit() {
    setError(null);
    if (name.trim().length < 2) return setError("Enter your name so the business knows who to expect.");
    if (phone.replace(/\D/g, "").length < 9) return setError("Enter a valid phone number.");
    if (requireDate && !time) return setError("Choose a time for your booking.");
    setBusy(true);
    try {
      const response = await fetch("/api/storefront/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          serviceId: isEnquiry ? undefined : serviceId,
          itemId: enquiryItemId,
          date,
          time,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          customerEmail: email.trim() || undefined,
          notes: notes.trim() || undefined,
          staffName: staffName.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn’t send that request. Please try again.");
        return;
      }
      trackEvent(businessId, "BOOKING_CREATED", isEnquiry ? enquiryItemId : serviceId);
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
        return;
      }
      setDone({ id: data.booking?.id, serviceName: data.booking?.serviceName, startAt: data.booking?.startAt, message: data.message });
    } catch {
      setError("We couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="eb-card" style={{ padding: "clamp(1.25rem, 4vw, 2rem)", maxWidth: "34rem" }}>
        <span aria-hidden="true" style={{ fontSize: "1.75rem" }}>✅</span>
        <h1 className="eb-h2" style={{ marginTop: "0.5rem" }}>{confirmationLabel}</h1>
        <p className="eb-muted">{done.message} The business will confirm with you directly.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href={`/b/${slug}/booking/${done.id}`} className="eb-btn">View your booking</Link>
        </p>
      </div>
    );
  }

  const chosen = bookables.find((entry) => entry.id === serviceId) || null;

  return (
    <div className="eb-grid" style={{ gridTemplateColumns: "1fr", gap: "2rem" }}>
      <div style={{ display: "grid", gap: "1.5rem", maxWidth: "34rem" }}>
        {isEnquiry ? (
          <div>
            <h1 className="eb-h2">{ctaLabel}</h1>
            <p className="eb-muted">About {enquiryItemName}. Tell us when you are free and we will get back to you.</p>
          </div>
        ) : (
          <div className="eb-field">
            <label className="eb-label" htmlFor="bk-service">What do you need?</label>
            <select id="bk-service" className="eb-select" value={serviceId} onChange={(event) => { setServiceId(event.target.value); setTime(""); setSlots([]); }}>
              {bookables.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {entry.durationMinutes ? ` · ${formatDuration(entry.durationMinutes)}` : ""}
                  {entry.pricingType === "QUOTE" ? " · quote" : entry.price ? ` · ${formatKES(entry.price)}` : ""}
                </option>
              ))}
            </select>
            {chosen?.description ? <p className="eb-muted">{chosen.description}</p> : null}
          </div>
        )}

        {requireDate ? (
          <>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="eb-label">Choose a date</legend>
              <div className="eb-chip-row">
                {openDays.slice(0, 10).map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={`eb-chip ${date === day ? "eb-chip--active" : ""}`}
                    aria-pressed={date === day}
                    onClick={() => { setDate(day); setTime(""); }}
                  >
                    {new Date(`${day}T00:00:00`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
                  </button>
                ))}
              </div>
            </fieldset>

            {date ? (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="eb-label">Choose a time</legend>
                {loadingSlots ? (
                  <p className="eb-muted">Checking availability…</p>
                ) : slots.length === 0 ? (
                  <p className="eb-muted">No times left on this day. Try another date.</p>
                ) : (
                  <div className="eb-chip-row">
                    {slots.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        className={`eb-chip ${time === slot ? "eb-chip--active" : ""}`}
                        aria-pressed={time === slot}
                        onClick={() => setTime(slot)}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                )}
              </fieldset>
            ) : null}
          </>
        ) : null}

        <div className="eb-field">
          <label className="eb-label" htmlFor="bk-name">Your name</label>
          <input id="bk-name" className="eb-input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
        </div>
        <div className="eb-field">
          <label className="eb-label" htmlFor="bk-phone">Phone</label>
          <input id="bk-phone" className="eb-input" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" required />
        </div>
        <div className="eb-field">
          <label className="eb-label" htmlFor="bk-email">Email (optional)</label>
          <input id="bk-email" className="eb-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </div>
        <div className="eb-field">
          <label className="eb-label" htmlFor="bk-notes">Anything we should know?</label>
          <textarea id="bk-notes" className="eb-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        {error ? <p className="eb-error" role="alert">{error}</p> : null}

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="eb-btn" disabled={busy} onClick={submit}>
            {busy ? "Sending…" : chosen?.pricingType === "QUOTE" || isEnquiry ? ctaLabel : ctaLabel}
          </button>
          <Link href={`/b/${slug}`} className="eb-btn eb-btn--outline">Cancel</Link>
        </div>

        {chosen?.depositKES ? (
          <p className="eb-muted">A deposit of {formatKES(chosen.depositKES)} is taken when you book, and comes off the final price.</p>
        ) : null}
      </div>
    </div>
  );
}
