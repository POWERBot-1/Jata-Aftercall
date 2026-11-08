"use client";

/**
 * Customer-visible loyalty progress (Business Hub D).
 *
 * The customer types the code printed on their card; the server answers with progress only.
 * Nothing here can add a stamp: stamps are awarded by the business after it verifies a purchase,
 * and the panel says so plainly rather than implying automatic tracking.
 */

import { useState } from "react";
import { Gift, Loader2, Search } from "lucide-react";

type Progress = {
  businessName: string;
  customerName: string;
  displayCode: string;
  status: string;
  stamps: number;
  goal: number;
  remaining: number;
  percent: number;
  rewardsAvailable: number;
  rewardsRedeemed: number;
  rewardDescription: string;
  lastStampAt: string | null;
};

export function LoyaltyCardPanel({ businessName }: { businessName: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/loyalty/${encodeURIComponent(code.trim().replace(/\s+/g, ""))}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProgress(null);
        setError(data.error || "We couldn't read that card code. Please check it and try again.");
        return;
      }
      setProgress(data as Progress);
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="loyalty" className="jata-card" aria-labelledby="loyalty-title">
      <h2 id="loyalty-title" className="jata-section-title flex items-center gap-2">
        <Gift size={18} aria-hidden="true" />
        Loyalty card
      </h2>

      {progress ? (
        <div className="mt-3">
          <p className="text-sm">
            <span className="font-semibold">{progress.customerName}</span> · card {progress.displayCode}
          </p>
          <p className="jata-hint mt-1">
            {progress.rewardsAvailable > 0
              ? `You have ${progress.rewardsAvailable} reward${progress.rewardsAvailable === 1 ? "" : "s"} ready to collect.`
              : `${progress.remaining} more stamp${progress.remaining === 1 ? "" : "s"} to go.`}
          </p>

          <div
            className="mt-3 flex flex-wrap gap-1.5"
            role="img"
            aria-label={`${progress.stamps} of ${progress.goal} stamps towards ${progress.rewardDescription}`}
          >
            {Array.from({ length: progress.goal }, (_, index) => {
              const filled = index < progress.stamps;
              return (
                <span
                  key={index}
                  aria-hidden="true"
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold ${
                    filled ? "border-emerald-600 bg-emerald-600 text-white" : "border-dashed border-zinc-300 text-zinc-400"
                  }`}
                >
                  {filled ? "★" : index + 1}
                </span>
              );
            })}
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-emerald-600 transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
            />
          </div>

          <dl className="jata-stat-grid mt-3">
            <div className="jata-stat">
              <dt>Stamps</dt>
              <dd>
                {progress.stamps} / {progress.goal}
              </dd>
            </div>
            <div className="jata-stat">
              <dt>Rewards taken</dt>
              <dd>{progress.rewardsRedeemed}</dd>
            </div>
          </dl>

          <p className="jata-hint mt-3">
            Reward: {progress.rewardDescription}. Stamps are added by {businessName} after they verify your purchase —
            this card does not track visits automatically.
          </p>

          <button
            type="button"
            className="jata-btn jata-btn-secondary mt-3"
            onClick={() => {
              setProgress(null);
              setCode("");
            }}
          >
            Check another card
          </button>
        </div>
      ) : (
        <form onSubmit={lookup} className="mt-3 space-y-3">
          <p className="jata-hint">
            Collect a stamp each time you buy, and earn a reward when your card is full. Enter the code on your card to
            see your progress. Stamps are added by {businessName} after they verify your purchase — nothing is tracked
            automatically.
          </p>
          <div className="jata-field">
            <label className="jata-label" htmlFor="loyalty-code">
              Card code
            </label>
            <input
              id="loyalty-code"
              className="jata-input font-mono uppercase tracking-wider"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="JATA-4F9K-2Q7M"
              maxLength={20}
              autoComplete="off"
              required
            />
          </div>
          {error ? (
            <p className="jata-error text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="jata-btn jata-btn-primary" disabled={busy || code.trim().length < 4}>
            {busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Search size={16} aria-hidden="true" />}
            {busy ? "Checking…" : "Check my card"}
          </button>
        </form>
      )}
    </section>
  );
}

export default LoyaltyCardPanel;
