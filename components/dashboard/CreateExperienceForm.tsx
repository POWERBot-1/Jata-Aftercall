"use client";

/**
 * Category choice (§5, §13)
 *
 * Picking a category configures everything downstream — sections, fields, terminology,
 * capabilities and theme defaults — without forking the app per category.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_KEYS, getExperienceProfile } from "@/lib/experience/categories";

export function CreateExperienceForm({ businessId, currentCategory }: { businessId: string; currentCategory?: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(
    CATEGORY_KEYS.includes(currentCategory as never) ? String(currentCategory) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!selected) return setError("Choose the type of business you run.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/experience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, categoryKey: selected }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn’t start your website. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("We couldn’t reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="jata-card">
      <h2 className="text-sm font-bold">What kind of business is this?</h2>
      <p className="mt-1 text-sm text-zinc-600">
        Your choice sets up the right sections, fields and words for your trade. You can change it later.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {CATEGORY_KEYS.map((key) => {
          const profile = getExperienceProfile(key);
          return (
            <label
              key={key}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${
                selected === key ? "border-zinc-900 bg-zinc-50" : "bg-white"
              }`}
            >
              <input
                type="radio"
                name="category"
                value={key}
                checked={selected === key}
                onChange={() => setSelected(key)}
                className="mt-1"
              />
              <span>
                <span className="block font-semibold">{profile.label}</span>
                <span className="block text-zinc-600">{profile.blurb}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? <p className="jata-error mt-3 text-sm" role="alert">{error}</p> : null}
      <button type="button" className="jata-btn jata-btn-primary mt-4" disabled={busy} onClick={create}>
        {busy ? "Setting up…" : "Start my website"}
      </button>
    </section>
  );
}
