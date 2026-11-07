"use client";

/**
 * Customer points wallet (Loyalty 2.0).
 *
 * Shown only after a customer has looked up their loyalty card code, and only when that business
 * has switched points on — so the public Business Page gains nothing when points are unused.
 *
 * The wallet is separate from the stamp card by design: stamp progress and the points balance are
 * two different cards on this screen, and neither is converted into the other.
 *
 * Points are not money and cannot be cashed out. Redeeming records that the business owes the
 * customer a reward; no payment, refund or transfer happens anywhere in this flow.
 */

import { useCallback, useEffect, useState } from "react";
import { Coins, Gift, Loader2, Sparkles } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/format";

type Wallet = {
  active: true;
  businessName: string;
  businessSlug: string;
  customerName: string;
  availablePoints: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  lifetimeExpired: number;
  pointsPending: number;
  status: string;
  earning: {
    kesPerPoint: number | null;
    pointsPerUnit: number | null;
    minPurchaseKES: number;
    expiryMonths: number | null;
    description: string | null;
    terms: string | null;
    redemptionRules: string | null;
    minRedeemPoints: number;
    pointValueKES: number | null;
  };
  nextExpiryAt: string | null;
  rewards: {
    id: string;
    title: string;
    description: string | null;
    kind: string;
    pointsCost: number;
    discountKES: number | null;
    affordable: boolean;
  }[];
  transactions: {
    type: string;
    direction: string;
    points: number;
    explanation: string | null;
    reference: string;
    source: string;
    expiresAt: string | null;
    createdAt: string;
  }[];
  redemptions: {
    reference: string;
    rewardTitle: string;
    pointsSpent: number;
    status: string;
    createdAt: string;
  }[];
  message?: string;
};

/** One key per redemption attempt, generated outside the component so React stays pure. */
function newRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const money = (value: number) => `KES ${formatNumber(Math.round(value))}`;
const pointsLabel = (value: number) => `${formatNumber(value)} ${value === 1 ? "point" : "points"}`;

export function PointsWallet({ code, businessName }: { code: string; businessName: string }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyReward, setBusyReward] = useState<string | null>(null);
  // One key per redemption attempt. It is kept until the attempt succeeds, so a retry after a lost
  // response returns the SAME redemption instead of spending the points twice.
  const [pendingKey, setPendingKey] = useState<{ rewardId: string; key: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/loyalty-points/${encodeURIComponent(code)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setWallet(null);
        return;
      }
      setWallet(data.active ? (data as Wallet) : null);
    } catch {
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeem(rewardId: string) {
    setNotice(null);
    setError(null);
    setBusyReward(rewardId);
    const key = pendingKey?.rewardId === rewardId ? pendingKey.key : newRequestKey();
    setPendingKey({ rewardId, key });
    try {
      const response = await fetch(`/api/public/loyalty-points/${encodeURIComponent(code)}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId, requestKey: key }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't redeem that reward. Please try again.");
        return;
      }
      setPendingKey(null);
      setNotice(
        `${data.message ?? "Redeemed."} Reference ${data.reference ?? ""}`.trim(),
      );
      await load();
    } catch {
      setError("We couldn't reach the server. Your points are safe — please try again.");
    } finally {
      setBusyReward(null);
    }
  }

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border border-zinc-200 p-4">
        <p className="jata-hint flex items-center gap-2">
          <Loader2 size={14} aria-hidden="true" className="animate-spin" /> Checking for points…
        </p>
      </div>
    );
  }
  if (!wallet) return null;

  const { earning } = wallet;
  const canRedeem = wallet.status === "ACTIVE" && wallet.availablePoints >= (earning.minRedeemPoints || 0);

  return (
    <section className="mt-4 rounded-2xl border border-[#16181d] bg-white p-4" aria-labelledby="points-wallet-title">
      <h3 id="points-wallet-title" className="flex items-center gap-2 text-sm font-bold text-[#16181d]">
        <Coins size={16} aria-hidden="true" className="text-[#16181d]" />
        Points wallet
      </h3>

      <div className="mt-3 rounded-xl bg-[#16181d] p-4 text-white">
        <p className="text-xs uppercase tracking-wide text-[#b6ff2e]">Available points</p>
        <p className="text-3xl font-black text-[#b6ff2e]">{formatNumber(wallet.availablePoints)}</p>
        {earning.pointValueKES ? (
          <p className="mt-1 text-xs text-zinc-300">
            About {money(wallet.availablePoints * earning.pointValueKES)} of value · points are not cash and cannot be
            withdrawn
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-300">Points are not cash and cannot be withdrawn.</p>
        )}
      </div>

      <dl className="jata-stat-grid mt-3">
        <div className="jata-stat">
          <dt>Total earned</dt>
          <dd>{formatNumber(wallet.lifetimeEarned)}</dd>
        </div>
        <div className="jata-stat">
          <dt>Redeemed</dt>
          <dd>{formatNumber(wallet.lifetimeRedeemed)}</dd>
        </div>
        <div className="jata-stat">
          <dt>Expired</dt>
          <dd>{formatNumber(wallet.lifetimeExpired)}</dd>
        </div>
        <div className="jata-stat">
          <dt>Pending</dt>
          <dd>{formatNumber(wallet.pointsPending)}</dd>
        </div>
      </dl>

      <p className="jata-hint mt-3">
        These points are separate from your stamps. Stamps fill your card; points build a balance you can spend on
        rewards.
      </p>

      <div className="mt-3 rounded-xl border border-zinc-200 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">How you earn</p>
        <p className="mt-1 text-sm">
          {earning.pointsPerUnit && earning.kesPerPoint
            ? `You earn ${pointsLabel(earning.pointsPerUnit)} for every ${money(earning.kesPerPoint)} you spend${
                earning.minPurchaseKES > 0 ? ` on purchases of ${money(earning.minPurchaseKES)} or more` : ""
              }.`
            : "This business has not published an earning rate yet."}
        </p>
        <p className="jata-hint mt-1">
          {businessName} adds your points after they verify your purchase. Asking for a quote or sending an order
          request does not earn points, because no payment is taken.
        </p>
        {earning.description ? <p className="mt-2 text-sm">{earning.description}</p> : null}
        {earning.expiryMonths ? (
          <p className="jata-hint mt-1">
            Points expire {earning.expiryMonths} month{earning.expiryMonths === 1 ? "" : "s"} after you earn them
            {wallet.nextExpiryAt ? ` · your next points expire on ${formatDateTime(wallet.nextExpiryAt)}` : ""}.
          </p>
        ) : (
          <p className="jata-hint mt-1">Your points do not expire.</p>
        )}
        {earning.terms ? (
          <p className="jata-hint mt-2 whitespace-pre-line">{earning.terms}</p>
        ) : null}
        {earning.redemptionRules ? (
          <p className="jata-hint mt-1 whitespace-pre-line">{earning.redemptionRules}</p>
        ) : null}
      </div>

      <div className="mt-4">
        <h4 className="flex items-center gap-2 text-sm font-bold">
          <Gift size={15} aria-hidden="true" /> Rewards
        </h4>
        {wallet.rewards.length === 0 ? (
          <p className="jata-hint mt-1">{businessName} has not published any rewards yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {wallet.rewards.map((reward) => {
              const affordable = canRedeem && reward.affordable;
              return (
                <li key={reward.id} className="rounded-xl border border-zinc-200 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{reward.title}</p>
                    <p className="text-sm font-bold">{pointsLabel(reward.pointsCost)}</p>
                  </div>
                  {reward.description ? <p className="jata-hint mt-1">{reward.description}</p> : null}
                  {reward.discountKES ? (
                    <p className="jata-hint mt-1">{money(reward.discountKES)} off your purchase.</p>
                  ) : null}
                  <button
                    type="button"
                    className="jata-btn jata-btn-primary mt-2 w-full justify-center sm:w-auto"
                    style={{ backgroundColor: "#b6ff2e", color: "#16181d" }}
                    // Exposed so the browser journey can assert the guard itself: a reward the
                    // balance cannot cover is disabled and says how many points are short.
                    data-reward-id={reward.id}
                    data-affordable={affordable ? "yes" : "no"}
                    disabled={!affordable || busyReward === reward.id}
                    onClick={() => redeem(reward.id)}
                  >
                    {busyReward === reward.id ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
                    {reward.affordable ? "Redeem" : `Need ${reward.pointsCost - wallet.availablePoints} more`}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {earning.minRedeemPoints > 0 ? (
          <p className="jata-hint mt-2">
            You can start redeeming once you hold {pointsLabel(earning.minRedeemPoints)}.
          </p>
        ) : null}
      </div>

      {wallet.redemptions.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-bold">Your redemptions</h4>
          <ul className="mt-2 divide-y divide-zinc-200">
            {wallet.redemptions.map((redemption) => (
              <li key={redemption.reference} className="py-2">
                <p className="text-sm font-medium">{redemption.rewardTitle}</p>
                <p className="jata-hint">
                  {pointsLabel(redemption.pointsSpent)} · {redemption.status.toLowerCase()} ·{" "}
                  {formatDateTime(redemption.createdAt)}
                </p>
                <p className="jata-hint">Reference {redemption.reference} — show this to collect.</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {wallet.transactions.length > 0 ? (
        <details className="mt-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold">
            <Sparkles size={15} aria-hidden="true" /> Points history
          </summary>
          <ul className="mt-2 divide-y divide-zinc-200">
            {wallet.transactions.map((entry) => (
              <li key={entry.reference} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium">
                    {entry.direction === "CREDIT" ? "+" : "−"}
                    {formatNumber(entry.points)} · {entry.type.toLowerCase().replace("_", " ")}
                  </p>
                  <p className="jata-hint">{entry.explanation ?? entry.reference}</p>
                </div>
                <p className="jata-hint">{formatDateTime(entry.createdAt)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {error ? (
        <p className="jata-error mt-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

export default PointsWallet;
