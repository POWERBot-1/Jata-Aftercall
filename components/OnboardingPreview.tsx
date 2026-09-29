"use client";
import { resolveTheme } from "@/lib/themes";
import type { DraftForm, DraftOffer, DraftService } from "@/lib/onboardingDraft";

/** Live, non-interactive preview of the customer page, rendered from the current draft. */
export function OnboardingPreview({ form, services, offer }: { form: DraftForm; services: DraftService[]; offer: DraftOffer }) {
  const t = resolveTheme(form.theme);
  const name = form.name.trim() || "Your business name";
  const hasWhatsApp = Boolean(form.whatsapp.trim() || form.phone.trim());
  const hasPhone = Boolean(form.phone.trim());
  const listed = services.filter((s) => s.title.trim().length >= 2).slice(0, 3);
  return (
    <div aria-label="Live preview of your customer page">
      <p className="mb-2 text-sm font-semibold">Live preview</p>
      <div className={`jata-light-island overflow-hidden rounded-2xl border ${t.colors.border} ${t.colors.bg} ${t.colors.text}`} aria-hidden="true">
        {form.aftercallMsg.trim() && <div className={`border-b ${t.colors.border} ${t.colors.card} px-3 py-1.5 text-center text-xs font-medium`}>{form.aftercallMsg.trim()}</div>}
        <div className="p-3">
          <div className={`rounded-xl border ${t.colors.border} ${t.colors.card} p-3`}>
            <div className="flex items-start gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${t.colors.primary} ${t.colors.primaryText} text-xs font-bold`}>{name.slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{name}</p>
                <p className={`text-xs font-semibold uppercase tracking-widest ${t.colors.muted}`}>{form.category}</p>
              </div>
            </div>
            {form.description.trim() && <p className={`mt-2 line-clamp-2 text-xs ${t.colors.muted}`}>{form.description.trim()}</p>}
            {(hasWhatsApp || hasPhone) ? (
              <div className={`mt-3 grid gap-2 ${hasWhatsApp && hasPhone ? "grid-cols-2" : "grid-cols-1"}`}>
                {hasWhatsApp && <span className="rounded-lg bg-emerald-700 py-2 text-center text-xs font-bold text-white">WhatsApp</span>}
                {hasPhone && <span className={`rounded-lg py-2 text-center text-xs font-bold ${t.colors.primary} ${t.colors.primaryText}`}>Call</span>}
              </div>
            ) : (
              <p className={`mt-3 text-xs ${t.colors.muted}`}>Add a phone or WhatsApp number to show contact buttons.</p>
            )}
            {(form.location.trim() || (form.lat && form.lng)) && <p className={`mt-2 rounded-lg border ${t.colors.border} py-1.5 text-center text-xs font-semibold`}>Get Directions</p>}
          </div>
          {offer.title.trim() && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-amber-950">
              <p className="text-xs font-bold tracking-widest text-amber-800">TODAY&apos;S OFFER</p>
              <p className="text-xs font-bold">{offer.title.trim()}</p>
            </div>
          )}
          {listed.length > 0 && (
            <ul className={`mt-2 space-y-1 rounded-xl border ${t.colors.border} ${t.colors.card} p-2`}>
              {listed.map((s, i) => (
                <li key={i} className="flex justify-between gap-2 text-xs"><span className="truncate font-semibold">{s.title.trim()}</span>{s.priceLabel.trim() && <span className={t.colors.muted}>{s.priceLabel.trim()}</span>}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
