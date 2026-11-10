"use client";

/**
 * Points and rewards management — Loyalty 2.0 (Business Hub D).
 *
 * A SECOND loyalty mechanism, sitting beside the stamp card. Nothing on this screen changes a
 * stamp: the two balances live in separate tables and are shown separately to customers.
 *
 * Three things are deliberately hard to get wrong here:
 *   1. EARNING IS OFF UNTIL THE OWNER ACTS. The programme arrives with no rate and refuses to
 *      switch on without one — no universal earning rate, redemption rate, expiry period or reward
 *      value is invented on the owner's behalf.
 *   2. A PURCHASE IS OWNER-VERIFIED. The "Record a purchase" form says so in as many words; it is
 *      not payment-provider verification, and an order request is not a purchase.
 *   3. EVERY ADJUSTMENT NEEDS A REASON. Adjustments and reversals are refused without one, because
 *      they are the two actions that can leave a customer worse off.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Gift, Loader2, Plus, ShieldAlert, Sparkles } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/format";

export type PointsProgrammeView = {
  id: string;
  isActive: boolean;
  kesPerPoint: number | null;
  pointsPerUnit: number | null;
  minPurchaseKES: number;
  maxPointsPerTransaction: number | null;
  minRedeemPoints: number;
  pointValueKES: number | null;
  expiryMonths: number | null;
  allowNegativeBalanceOnReversal: boolean;
  description: string | null;
  terms: string | null;
  redemptionRules: string | null;
  eligibleItems: { itemKind: string; itemId: string }[];
};

export type PointsAccountView = {
  id: string;
  cardId: string;
  customerName: string;
  cardCode: string;
  availablePoints: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  lifetimeExpired: number;
  pointsPending: number;
  status: string;
  lastActivityAt: string | null;
};

export type PointsRewardView = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  pointsCost: number;
  discountKES: number | null;
  itemKind: string | null;
  itemId: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type PointsLedgerEntryView = {
  id: string;
  type: string;
  direction: string;
  points: number;
  balanceAfter: number;
  reference: string;
  source: string;
  sourceReference: string | null;
  explanation: string | null;
  actorLabel: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type PointsRedemptionView = {
  id: string;
  reference: string;
  rewardTitle: string;
  rewardKind: string;
  pointsSpent: number;
  status: string;
  channel: string;
  customerName: string;
  customerNote: string | null;
  cancelReason: string | null;
  createdAt: string;
};

export type PointsCatalogueOption = { id: string; kind: string; name: string };

const money = (value: number) => `KES ${formatNumber(Math.round(value))}`;
const pointsLabel = (value: number) => `${formatNumber(value)} ${value === 1 ? "point" : "points"}`;

export function PointsBoard({
  businessId,
  programme,
  accounts,
  rewards,
  ledger,
  redemptions,
  stats,
  catalogue,
  cards,
}: {
  businessId: string;
  programme: PointsProgrammeView;
  accounts: PointsAccountView[];
  rewards: PointsRewardView[];
  ledger: PointsLedgerEntryView[];
  redemptions: PointsRedemptionView[];
  stats: {
    wallets: number;
    pointsIssued: number;
    pointsRedeemed: number;
    pointsExpired: number;
    pointsReversed: number;
    adjustments: number;
    availablePoints: number;
  };
  catalogue: PointsCatalogueOption[];
  cards: { id: string; customerName: string; code: string }[];
}) {
  const router = useRouter();

  const [isActive, setIsActive] = useState(programme.isActive);
  const [pointsPerUnit, setPointsPerUnit] = useState(programme.pointsPerUnit ? String(programme.pointsPerUnit) : "");
  const [kesPerPoint, setKesPerPoint] = useState(programme.kesPerPoint ? String(programme.kesPerPoint) : "");
  const [minPurchaseKES, setMinPurchaseKES] = useState(String(programme.minPurchaseKES ?? 0));
  const [maxPointsPerTransaction, setMaxPointsPerTransaction] = useState(
    programme.maxPointsPerTransaction ? String(programme.maxPointsPerTransaction) : "",
  );
  const [minRedeemPoints, setMinRedeemPoints] = useState(String(programme.minRedeemPoints ?? 0));
  const [pointValueKES, setPointValueKES] = useState(programme.pointValueKES ? String(programme.pointValueKES) : "");
  const [expiryEnabled, setExpiryEnabled] = useState(programme.expiryMonths !== null);
  const [expiryMonths, setExpiryMonths] = useState(programme.expiryMonths ? String(programme.expiryMonths) : "12");
  const [allowNegative, setAllowNegative] = useState(programme.allowNegativeBalanceOnReversal);
  const [description, setDescription] = useState(programme.description ?? "");
  const [terms, setTerms] = useState(programme.terms ?? "");
  const [redemptionRules, setRedemptionRules] = useState(programme.redemptionRules ?? "");
  const [eligible, setEligible] = useState<string[]>(
    programme.eligibleItems.map((item) => `${item.itemKind}:${item.itemId}`),
  );
  const [restrictItems, setRestrictItems] = useState(programme.eligibleItems.length > 0);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Record-purchase, adjust and reverse forms, one set per customer row.
  const [earnCard, setEarnCard] = useState<string | null>(null);
  const [earnAmount, setEarnAmount] = useState("");
  const [earnRef, setEarnRef] = useState("");
  const [earnNote, setEarnNote] = useState("");

  const [adjustCard, setAdjustCard] = useState<string | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const [reverseCard, setReverseCard] = useState<string | null>(null);
  const [reverseRef, setReverseRef] = useState("");
  const [reverseReason, setReverseReason] = useState("");

  // Reward catalogue editor.
  const [rewardTitle, setRewardTitle] = useState("");
  const [rewardDescription, setRewardDescription] = useState("");
  const [rewardKind, setRewardKind] = useState("FIXED_POINTS");
  const [rewardCost, setRewardCost] = useState("");
  const [rewardDiscount, setRewardDiscount] = useState("");

  const walletsByCard = useMemo(() => {
    const map = new Map<string, PointsAccountView>();
    for (const account of accounts) map.set(account.cardId, account);
    return map;
  }, [accounts]);

  const catalogueNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of catalogue) map.set(`${item.kind}:${item.id}`, item.name);
    return map;
  }, [catalogue]);

  async function send(url: string, method: string, body: unknown) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "That didn't work. Please try again.");
    return data;
  }

  async function run(key: string, action: () => Promise<{ message?: string } | void>, success: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const data = await action();
      setNotice((data && typeof data === "object" && data.message) || success);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function saveProgramme(event: React.FormEvent) {
    event.preventDefault();
    return run(
      "programme",
      () =>
        send(`/api/business/${businessId}/loyalty/points`, "PUT", {
          isActive,
          pointsPerUnit: pointsPerUnit || null,
          kesPerPoint: kesPerPoint || null,
          minPurchaseKES: Number(minPurchaseKES || 0),
          maxPointsPerTransaction: maxPointsPerTransaction || null,
          minRedeemPoints: Number(minRedeemPoints || 0),
          pointValueKES: pointValueKES || null,
          expiryMonths: expiryEnabled ? Number(expiryMonths || 12) : null,
          allowNegativeBalanceOnReversal: allowNegative,
          description,
          terms,
          redemptionRules,
          eligibleItems: restrictItems
            ? eligible.map((entry) => {
                const [itemKind, itemId] = entry.split(":");
                return { itemKind, itemId };
              })
            : [],
        }),
      isActive ? "Points programme saved and switched on." : "Points programme saved (earning off).",
    );
  }

  function recordPurchase(cardId: string) {
    return run(
      `earn-${cardId}`,
      () =>
        send(`/api/business/${businessId}/loyalty/points/earn`, "POST", {
          cardId,
          amountKES: Number(earnAmount),
          transactionRef: earnRef,
          note: earnNote || null,
        }).then((data) => {
          if (data.duplicate) return { message: "That purchase was already recorded. Nothing was awarded twice." };
          setEarnCard(null);
          setEarnAmount("");
          setEarnRef("");
          setEarnNote("");
          return { message: `${pointsLabel(data.entry?.points ?? 0)} awarded.` };
        }),
      "Points awarded.",
    );
  }

  function adjust(cardId: string) {
    return run(
      `adjust-${cardId}`,
      () =>
        send(`/api/business/${businessId}/loyalty/points/adjust`, "POST", {
          cardId,
          points: Number(adjustPoints),
          reason: adjustReason,
        }).then(() => {
          setAdjustCard(null);
          setAdjustPoints("");
          setAdjustReason("");
          return { message: "Adjustment recorded with your reason." };
        }),
      "Adjustment recorded.",
    );
  }

  function reverse(cardId: string) {
    return run(
      `reverse-${cardId}`,
      () =>
        send(`/api/business/${businessId}/loyalty/points/reverse`, "POST", {
          cardId,
          transactionRef: reverseRef,
          reason: reverseReason,
        }).then((data) => {
          setReverseCard(null);
          setReverseRef("");
          setReverseReason("");
          if (data.shortfall > 0) {
            return { message: `Reversed. ${pointsLabel(data.shortfall)} had already been spent or expired.` };
          }
          return { message: "Points reversed." };
        }),
      "Points reversed.",
    );
  }

  function addReward(event: React.FormEvent) {
    event.preventDefault();
    return run(
      "reward",
      () =>
        send(`/api/business/${businessId}/loyalty/points/rewards`, "POST", {
          title: rewardTitle,
          description: rewardDescription || null,
          kind: rewardKind,
          pointsCost: Number(rewardCost),
          discountKES: rewardKind === "DISCOUNT" ? Number(rewardDiscount || 0) : null,
        }).then(() => {
          setRewardTitle("");
          setRewardDescription("");
          setRewardCost("");
          setRewardDiscount("");
          return { message: "Reward added." };
        }),
      "Reward added.",
    );
  }

  function toggleReward(reward: PointsRewardView) {
    return run(
      `reward-${reward.id}`,
      () =>
        send(`/api/business/${businessId}/loyalty/points/rewards/${reward.id}`, "PATCH", {
          isActive: !reward.isActive,
        }),
      reward.isActive ? "Reward paused." : "Reward published.",
    );
  }

  function moveRedemption(redemption: PointsRedemptionView, status: string) {
    return run(
      `redemption-${redemption.id}`,
      () =>
        send(`/api/business/${businessId}/loyalty/points/redemptions/${redemption.id}`, "PATCH", {
          status,
          reason: status === "CANCELLED" ? "Cancelled by the business" : null,
        }),
      `Redemption marked ${status.toLowerCase()}.`,
    );
  }

  return (
    <div className="space-y-4">
      <dl className="jata-stat-grid">
        <div className="jata-stat">
          <dt>Points wallets</dt>
          <dd>{stats.wallets}</dd>
        </div>
        <div className="jata-stat">
          <dt>Points issued</dt>
          <dd>{formatNumber(stats.pointsIssued)}</dd>
        </div>
        <div className="jata-stat">
          <dt>Points redeemed</dt>
          <dd>{formatNumber(stats.pointsRedeemed)}</dd>
        </div>
        <div className="jata-stat">
          <dt>Points outstanding</dt>
          <dd>{formatNumber(stats.availablePoints)}</dd>
        </div>
        <div className="jata-stat">
          <dt>Expired</dt>
          <dd>{formatNumber(stats.pointsExpired)}</dd>
        </div>
        <div className="jata-stat">
          <dt>Reversed</dt>
          <dd>{formatNumber(stats.pointsReversed)}</dd>
        </div>
      </dl>

      <div className="jata-card space-y-2 border-l-4 border-l-[#b6ff2e]">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <ShieldAlert size={15} aria-hidden="true" />
          {programme.isActive ? "Points are live" : "Points are switched off"}
        </h2>
        <p className="jata-hint">
          {programme.isActive
            ? `Customers earn ${pointsLabel(programme.pointsPerUnit ?? 0)} for every ${money(programme.kesPerPoint ?? 0)} they spend${
                programme.minPurchaseKES > 0 ? ` on purchases of ${money(programme.minPurchaseKES)} or more` : ""
              }. Points are separate from stamps — a customer can hold both, and neither balance is converted into the other.`
            : "Nothing is awarded and nothing can be redeemed until you set a rate and switch the programme on. We don't pick a rate, an expiry period or a reward value for you."}
        </p>
      </div>

      {error ? (
        <p className="jata-error text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm font-medium text-emerald-700" role="status">
          {notice}
        </p>
      ) : null}

      <form onSubmit={saveProgramme} className="jata-card space-y-4">
        <div>
          <h2 className="text-sm font-bold">Points settings</h2>
          <p className="jata-hint">
            You choose the earning rate, the threshold and what a point is worth. Every setting below explains what it
            does before you turn it on.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="jata-field">
            <label className="jata-label" htmlFor="points-per-unit">
              Points earned
            </label>
            <input
              id="points-per-unit"
              className="jata-input"
              type="number"
              min={1}
              max={1000}
              value={pointsPerUnit}
              onChange={(event) => setPointsPerUnit(event.target.value)}
              placeholder="e.g. 1"
            />
            <p className="jata-hint">How many points a customer earns per unit of spend below.</p>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="kes-per-point">
              For every (KES)
            </label>
            <input
              id="kes-per-point"
              className="jata-input"
              type="number"
              min={1}
              max={100000}
              value={kesPerPoint}
              onChange={(event) => setKesPerPoint(event.target.value)}
              placeholder="e.g. 100"
            />
            <p className="jata-hint">
              Spend is counted in whole units: at 1 point per KES 100, a KES 250 purchase earns 2 points.
            </p>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="points-min-purchase">
              Minimum purchase (KES)
            </label>
            <input
              id="points-min-purchase"
              className="jata-input"
              type="number"
              min={0}
              value={minPurchaseKES}
              onChange={(event) => setMinPurchaseKES(event.target.value)}
            />
            <p className="jata-hint">Purchases below this amount earn nothing. 0 means every qualifying purchase earns.</p>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="points-cap">
              Cap per transaction (optional)
            </label>
            <input
              id="points-cap"
              className="jata-input"
              type="number"
              min={1}
              value={maxPointsPerTransaction}
              onChange={(event) => setMaxPointsPerTransaction(event.target.value)}
              placeholder="No cap"
            />
            <p className="jata-hint">A ceiling on one purchase. Leave empty for no cap.</p>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="points-min-redeem">
              Minimum points to redeem
            </label>
            <input
              id="points-min-redeem"
              className="jata-input"
              type="number"
              min={0}
              value={minRedeemPoints}
              onChange={(event) => setMinRedeemPoints(event.target.value)}
            />
            <p className="jata-hint">A customer must hold at least this many points before they can redeem anything.</p>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="points-value">
              What one point is worth (KES, optional)
            </label>
            <input
              id="points-value"
              className="jata-input"
              type="number"
              min={0}
              value={pointValueKES}
              onChange={(event) => setPointValueKES(event.target.value)}
              placeholder="Not stated"
            />
            <p className="jata-hint">
              Shown to customers as a guide to a discount. Points are not money and cannot be cashed out.
            </p>
          </div>
        </div>

        <div className="jata-field">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={expiryEnabled}
              onChange={(event) => setExpiryEnabled(event.target.checked)}
            />
            Points expire
          </label>
          {expiryEnabled ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                id="points-expiry"
                className="jata-input w-28"
                type="number"
                min={1}
                max={120}
                value={expiryMonths}
                onChange={(event) => setExpiryMonths(event.target.value)}
                aria-label="Months before points expire"
              />
              <span className="jata-hint">months after they are earned</span>
            </div>
          ) : (
            <p className="jata-hint">Off: points never expire, and no expiry run will ever touch them.</p>
          )}
          <p className="jata-hint">
            Only unused points expire. Expiry runs once per award, so an interrupted or repeated run never takes the
            same points twice.
          </p>
        </div>

        <div className="jata-field">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={allowNegative}
              onChange={(event) => setAllowNegative(event.target.checked)}
            />
            Allow a reversal to take a balance below zero
          </label>
          <p className="jata-hint">
            Off (recommended): reversing a refunded purchase takes back only the points still unspent, and you are told
            how many were already used. On: the wallet goes negative and you decide what to do about it — no automatic
            recovery or debt collection happens either way.
          </p>
        </div>

        <div className="jata-field">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={restrictItems} onChange={(event) => setRestrictItems(event.target.checked)} />
            Only some products or services earn points
          </label>
          {restrictItems ? (
            catalogue.length === 0 ? (
              <p className="jata-hint">
                Add products or services to your catalogue first, then choose which of them earn points.
              </p>
            ) : (
              <div className="mt-2 grid max-h-52 gap-1 overflow-y-auto sm:grid-cols-2">
                {catalogue.map((item) => {
                  const key = `${item.kind}:${item.id}`;
                  return (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={eligible.includes(key)}
                        onChange={(event) =>
                          setEligible((current) =>
                            event.target.checked ? [...current, key] : current.filter((entry) => entry !== key),
                          )
                        }
                      />
                      {item.name}
                      <span className="jata-hint">({item.kind.toLowerCase()})</span>
                    </label>
                  );
                })}
              </div>
            )
          ) : (
            <p className="jata-hint">Every qualifying purchase earns points.</p>
          )}
        </div>

        <div className="jata-field">
          <label className="jata-label" htmlFor="points-description">
            Programme description <span className="font-normal text-zinc-500">(shown to customers)</span>
          </label>
          <input
            id="points-description"
            className="jata-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={600}
            placeholder="e.g. Earn points every time you eat with us."
          />
        </div>
        <div className="jata-field">
          <label className="jata-label" htmlFor="points-terms">
            Terms <span className="font-normal text-zinc-500">(shown to customers)</span>
          </label>
          <textarea
            id="points-terms"
            className="jata-input"
            rows={3}
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="jata-field">
          <label className="jata-label" htmlFor="points-rules">
            Redemption restrictions <span className="font-normal text-zinc-500">(shown to customers)</span>
          </label>
          <textarea
            id="points-rules"
            className="jata-input"
            rows={3}
            value={redemptionRules}
            onChange={(event) => setRedemptionRules(event.target.value)}
            maxLength={2000}
            placeholder="e.g. Rewards are collected in store. One reward per visit."
          />
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          Switch points on
        </label>
        {isActive && (!kesPerPoint || !pointsPerUnit) ? (
          <p className="jata-hint">Set both earning fields above — the programme cannot go live without a rate.</p>
        ) : null}

        <button type="submit" className="jata-btn jata-btn-primary" disabled={busy === "programme"}>
          {busy === "programme" ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
          Save points settings
        </button>
      </form>

      <section className="jata-card space-y-3" aria-labelledby="rewards-heading">
        <div>
          <h2 id="rewards-heading" className="flex items-center gap-2 text-sm font-bold">
            <Gift size={15} aria-hidden="true" /> Reward catalogue
          </h2>
          <p className="jata-hint">
            You decide what a reward costs in points and what it is. Pause a reward instead of deleting it, so past
            redemptions keep their meaning.
          </p>
        </div>

        {rewards.length === 0 ? (
          <p className="jata-hint">No rewards yet. Add the first one below — nothing is offered to customers until you do.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {rewards.map((reward) => (
              <li key={reward.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-semibold">{reward.title}</p>
                  <p className="jata-hint">
                    {pointsLabel(reward.pointsCost)}
                    {reward.discountKES ? ` · ${money(reward.discountKES)} off` : ""}
                    {reward.itemId && catalogueNames.get(`${reward.itemKind}:${reward.itemId}`)
                      ? ` · ${catalogueNames.get(`${reward.itemKind}:${reward.itemId}`)}`
                      : ""}
                    {reward.isActive ? "" : " · paused"}
                  </p>
                  {reward.description ? <p className="jata-hint">{reward.description}</p> : null}
                </div>
                <button
                  type="button"
                  className="jata-btn jata-btn-secondary"
                  disabled={busy === `reward-${reward.id}`}
                  onClick={() => toggleReward(reward)}
                >
                  {reward.isActive ? "Pause" : "Publish"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addReward} className="grid gap-3 border-t border-zinc-200 pt-3 sm:grid-cols-5">
          <div className="jata-field sm:col-span-2">
            <label className="jata-label" htmlFor="reward-title">
              Reward name
            </label>
            <input
              id="reward-title"
              className="jata-input"
              value={rewardTitle}
              onChange={(event) => setRewardTitle(event.target.value)}
              maxLength={80}
              required
            />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="reward-kind">
              Type
            </label>
            <select
              id="reward-kind"
              className="jata-input"
              value={rewardKind}
              onChange={(event) => setRewardKind(event.target.value)}
            >
              <option value="FIXED_POINTS">Fixed points (free item)</option>
              <option value="DISCOUNT">Discount off a purchase</option>
              <option value="PRODUCT">Product</option>
              <option value="SERVICE">Service</option>
            </select>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="reward-cost">
              Cost (points)
            </label>
            <input
              id="reward-cost"
              className="jata-input"
              type="number"
              min={1}
              value={rewardCost}
              onChange={(event) => setRewardCost(event.target.value)}
              required
            />
          </div>
          {rewardKind === "DISCOUNT" ? (
            <div className="jata-field">
              <label className="jata-label" htmlFor="reward-discount">
                Discount (KES)
              </label>
              <input
                id="reward-discount"
                className="jata-input"
                type="number"
                min={0}
                value={rewardDiscount}
                onChange={(event) => setRewardDiscount(event.target.value)}
              />
            </div>
          ) : null}
          <div className="jata-field sm:col-span-5">
            <label className="jata-label" htmlFor="reward-description">
              What the customer gets <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input
              id="reward-description"
              className="jata-input"
              value={rewardDescription}
              onChange={(event) => setRewardDescription(event.target.value)}
              maxLength={600}
            />
          </div>
          <button type="submit" className="jata-btn jata-btn-primary sm:col-span-5" disabled={busy === "reward"}>
            {busy === "reward" ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Plus size={15} aria-hidden="true" />}
            Add reward
          </button>
        </form>
      </section>

      <section className="jata-card space-y-3" aria-labelledby="wallets-heading">
        <div>
          <h2 id="wallets-heading" className="flex items-center gap-2 text-sm font-bold">
            <Coins size={15} aria-hidden="true" /> Customer points
          </h2>
          <p className="jata-hint">
            Points are awarded when you record a verified purchase. This is you confirming the purchase — it is not an
            automatic payment check, and an order request never earns points because no payment is taken.
          </p>
        </div>

        {cards.length === 0 ? (
          <p className="jata-hint">Enrol customers on the Loyalty tab first, then record their purchases here.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {cards.map((card) => {
              const wallet = walletsByCard.get(card.id);
              const available = wallet?.availablePoints ?? 0;
              return (
                <li key={card.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{card.customerName}</p>
                    <p className="text-sm">
                      <span className="font-bold">{formatNumber(available)}</span> points
                      {wallet?.status === "BLOCKED" ? <span className="jata-hint"> · blocked</span> : null}
                    </p>
                  </div>
                  <p className="jata-hint">
                    Earned {wallet?.lifetimeEarned ?? 0} · redeemed {wallet?.lifetimeRedeemed ?? 0} · expired{" "}
                    {wallet?.lifetimeExpired ?? 0}
                    {wallet?.lastActivityAt ? ` · last movement ${formatDateTime(wallet.lastActivityAt)}` : ""}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="jata-btn jata-btn-secondary"
                      onClick={() => {
                        setAdjustCard(null);
                        setReverseCard(null);
                        setEarnCard(earnCard === card.id ? null : card.id);
                      }}
                    >
                      Record a purchase
                    </button>
                    <button
                      type="button"
                      className="jata-btn jata-btn-secondary"
                      onClick={() => {
                        setEarnCard(null);
                        setReverseCard(null);
                        setAdjustCard(adjustCard === card.id ? null : card.id);
                      }}
                    >
                      Adjust
                    </button>
                    <button
                      type="button"
                      className="jata-btn jata-btn-secondary"
                      onClick={() => {
                        setEarnCard(null);
                        setAdjustCard(null);
                        setReverseCard(reverseCard === card.id ? null : card.id);
                      }}
                    >
                      Reverse a refund
                    </button>
                  </div>

                  {earnCard === card.id ? (
                    <div className="grid gap-2 rounded-lg bg-zinc-50 p-3 sm:grid-cols-3">
                      <div className="jata-field">
                        <label className="jata-label" htmlFor={`earn-amount-${card.id}`}>
                          Purchase amount (KES)
                        </label>
                        <input
                          id={`earn-amount-${card.id}`}
                          className="jata-input"
                          type="number"
                          min={1}
                          value={earnAmount}
                          onChange={(event) => setEarnAmount(event.target.value)}
                          inputMode="decimal"
                        />
                      </div>
                      <div className="jata-field">
                        <label className="jata-label" htmlFor={`earn-ref-${card.id}`}>
                          Receipt / order reference
                        </label>
                        <input
                          id={`earn-ref-${card.id}`}
                          className="jata-input"
                          value={earnRef}
                          onChange={(event) => setEarnRef(event.target.value)}
                          maxLength={80}
                        />
                      </div>
                      <div className="jata-field">
                        <label className="jata-label" htmlFor={`earn-note-${card.id}`}>
                          Note (optional)
                        </label>
                        <input
                          id={`earn-note-${card.id}`}
                          className="jata-input"
                          value={earnNote}
                          onChange={(event) => setEarnNote(event.target.value)}
                          maxLength={400}
                        />
                      </div>
                      <button
                        type="button"
                        className="jata-btn jata-btn-primary sm:col-span-3"
                        disabled={busy === `earn-${card.id}` || !earnAmount || earnRef.trim().length < 3}
                        onClick={() => recordPurchase(card.id)}
                      >
                        {busy === `earn-${card.id}` ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
                        Award points
                      </button>
                      <p className="jata-hint sm:col-span-3">
                        The same reference can only ever award points once — replaying it returns the original award
                        instead of a second one.
                      </p>
                    </div>
                  ) : null}

                  {adjustCard === card.id ? (
                    <div className="grid gap-2 rounded-lg bg-zinc-50 p-3 sm:grid-cols-2">
                      <div className="jata-field">
                        <label className="jata-label" htmlFor={`adjust-points-${card.id}`}>
                          Points to add or remove
                        </label>
                        <input
                          id={`adjust-points-${card.id}`}
                          className="jata-input"
                          type="number"
                          value={adjustPoints}
                          onChange={(event) => setAdjustPoints(event.target.value)}
                          placeholder="10 or -10"
                        />
                      </div>
                      <div className="jata-field">
                        <label className="jata-label" htmlFor={`adjust-reason-${card.id}`}>
                          Reason (required, recorded)
                        </label>
                        <input
                          id={`adjust-reason-${card.id}`}
                          className="jata-input"
                          value={adjustReason}
                          onChange={(event) => setAdjustReason(event.target.value)}
                          maxLength={400}
                        />
                      </div>
                      <button
                        type="button"
                        className="jata-btn jata-btn-primary sm:col-span-2"
                        disabled={busy === `adjust-${card.id}` || !adjustPoints || adjustReason.trim().length < 5}
                        onClick={() => adjust(card.id)}
                      >
                        {busy === `adjust-${card.id}` ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
                        Record adjustment
                      </button>
                      <p className="jata-hint sm:col-span-2">
                        An adjustment never rewrites history: it adds a recorded entry the customer can see, with your
                        reason and your name against it.
                      </p>
                    </div>
                  ) : null}

                  {reverseCard === card.id ? (
                    <div className="grid gap-2 rounded-lg bg-zinc-50 p-3 sm:grid-cols-2">
                      <div className="jata-field">
                        <label className="jata-label" htmlFor={`reverse-ref-${card.id}`}>
                          Original purchase reference
                        </label>
                        <input
                          id={`reverse-ref-${card.id}`}
                          className="jata-input"
                          value={reverseRef}
                          onChange={(event) => setReverseRef(event.target.value)}
                          maxLength={80}
                        />
                      </div>
                      <div className="jata-field">
                        <label className="jata-label" htmlFor={`reverse-reason-${card.id}`}>
                          Reason (required)
                        </label>
                        <input
                          id={`reverse-reason-${card.id}`}
                          className="jata-input"
                          value={reverseReason}
                          onChange={(event) => setReverseReason(event.target.value)}
                          maxLength={400}
                          placeholder="Refunded on 12 Nov"
                        />
                      </div>
                      <button
                        type="button"
                        className="jata-btn jata-btn-primary sm:col-span-2"
                        disabled={busy === `reverse-${card.id}` || reverseRef.trim().length < 3 || reverseReason.trim().length < 5}
                        onClick={() => reverse(card.id)}
                      >
                        {busy === `reverse-${card.id}` ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
                        Reverse points
                      </button>
                      <p className="jata-hint sm:col-span-2">
                        One reversal per purchase, always. Points already spent or expired are reported to you rather
                        than clawed back, unless you allowed negative balances above.
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="jata-card space-y-3" aria-labelledby="redemptions-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="redemptions-heading" className="text-sm font-bold">
            Redemptions
          </h2>
          <p className="jata-hint">Mark a redemption fulfilled once the customer has the reward in hand.</p>
        </div>
        {redemptions.length === 0 ? (
          <p className="jata-hint">No redemptions yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {redemptions.map((redemption) => (
              <li key={redemption.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-semibold">{redemption.rewardTitle}</p>
                  <p className="jata-hint">
                    {redemption.customerName} · {pointsLabel(redemption.pointsSpent)} · {redemption.reference} ·{" "}
                    {formatDateTime(redemption.createdAt)} · {redemption.status.toLowerCase()}
                  </p>
                </div>
                {redemption.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="jata-btn jata-btn-secondary"
                      disabled={busy === `redemption-${redemption.id}`}
                      onClick={() => moveRedemption(redemption, "FULFILLED")}
                    >
                      Fulfilled
                    </button>
                    <button
                      type="button"
                      className="jata-btn jata-btn-secondary"
                      disabled={busy === `redemption-${redemption.id}`}
                      onClick={() => moveRedemption(redemption, "CANCELLED")}
                    >
                      Cancel &amp; return points
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="jata-card space-y-3" aria-labelledby="ledger-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ledger-heading" className="flex items-center gap-2 text-sm font-bold">
            <Sparkles size={15} aria-hidden="true" /> Points history
          </h2>
          <button
            type="button"
            className="jata-btn jata-btn-secondary"
            disabled={busy === "expiry"}
            onClick={() =>
              run(
                "expiry",
                () => send(`/api/business/${businessId}/loyalty/points/expire`, "POST", {}),
                "Expiry processed.",
              )
            }
          >
            {busy === "expiry" ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
            Run expiry now
          </button>
        </div>
        <p className="jata-hint">
          Every movement is kept. A correction is a new entry that points at the original — entries are never rewritten
          or deleted, and the balance below always adds up to the history.
        </p>
        {ledger.length === 0 ? (
          <p className="jata-hint">No points movements yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-semibold">
                    {entry.direction === "CREDIT" ? "+" : "−"}
                    {formatNumber(entry.points)} · {entry.type.toLowerCase().replace("_", " ")}
                  </p>
                  <p className="jata-hint">
                    {entry.explanation ?? entry.reference} · {formatDateTime(entry.createdAt)}
                    {entry.actorLabel ? ` · ${entry.actorLabel}` : ""}
                  </p>
                </div>
                <p className="jata-hint">balance {formatNumber(entry.balanceAfter)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default PointsBoard;
