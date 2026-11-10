"use client";

/**
 * Loyalty management (Business Hub D).
 *
 * Owner-verified by design: a stamp is awarded only when the owner enters a transaction reference
 * and presses "Verify & award". The board says so on screen rather than implying visits or
 * purchases are detected automatically.
 *
 * Duplicate protection is visible too: re-submitting the same reference is refused with the
 * original award time, and "Redeem" is disabled unless a full cycle of stamps is available.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Award, Gift, Loader2, Plus, Star } from "lucide-react";
import { formatDateTime } from "@/lib/format";

export type LoyaltyCardView = {
  id: string;
  code: string;
  displayCode: string;
  customerName: string;
  contactMethod: string | null;
  contactValue: string | null;
  status: string;
  stampsEarned: number;
  balance: number;
  goal: number;
  remaining: number;
  percent: number;
  rewardsAvailable: number;
  rewardsRedeemed: number;
  lastStampAt: string | null;
};

export type LoyaltyProgramView = {
  isEnabled: boolean;
  stampGoal: number;
  maxStampsPerVisit: number;
  rewardDescription: string;
  terms: string | null;
  cardPrefix: string;
};

export function LoyaltyBoard({
  businessId,
  program,
  cards,
  stats,
}: {
  businessId: string;
  program: LoyaltyProgramView;
  cards: LoyaltyCardView[];
  stats: { cards: number; stampsAwarded: number; rewardsRedeemed: number; activeCards: number };
}) {
  const router = useRouter();
  const [stampGoal, setStampGoal] = useState(String(program.stampGoal));
  const [rewardDescription, setRewardDescription] = useState(program.rewardDescription);
  const [terms, setTerms] = useState(program.terms ?? "");
  const [maxStampsPerVisit, setMaxStampsPerVisit] = useState(String(program.maxStampsPerVisit));
  const [isEnabled, setIsEnabled] = useState(program.isEnabled);

  const [customerName, setCustomerName] = useState("");
  const [contactMethod, setContactMethod] = useState("PHONE");
  const [contactValue, setContactValue] = useState("");
  const [newCard, setNewCard] = useState<LoyaltyCardView | null>(null);

  const [references, setReferences] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function saveProgram(event: React.FormEvent) {
    event.preventDefault();
    setBusyId("program");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/business/${businessId}/loyalty`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stampGoal, maxStampsPerVisit, rewardDescription, terms, isEnabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't save those settings.");
        return;
      }
      setNotice("Loyalty settings saved.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function enrol(event: React.FormEvent) {
    event.preventDefault();
    setBusyId("enrol");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/business/${businessId}/loyalty`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, contactMethod, contactValue }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't issue that card.");
        return;
      }
      setNewCard(data.card as LoyaltyCardView);
      setCustomerName("");
      setContactValue("");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function award(card: LoyaltyCardView) {
    const transactionRef = (references[card.id] ?? "").trim();
    if (transactionRef.length < 3) {
      setError("Enter a short reference for the transaction (receipt, order or date) before awarding a stamp.");
      return;
    }
    setBusyId(card.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/business/${businessId}/loyalty/cards/${card.id}/stamp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionRef }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't award that stamp.");
        return;
      }
      setNotice(`Stamp awarded to ${card.customerName}.`);
      setReferences((current) => ({ ...current, [card.id]: "" }));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function redeem(card: LoyaltyCardView) {
    setBusyId(`redeem-${card.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/business/${businessId}/loyalty/cards/${card.id}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't redeem that reward.");
        return;
      }
      setNotice(`Reward redeemed for ${card.customerName}.`);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <dl className="jata-stat-grid">
        <div className="jata-stat">
          <dt>Cards issued</dt>
          <dd>{stats.cards}</dd>
        </div>
        <div className="jata-stat">
          <dt>Stamps awarded</dt>
          <dd>{stats.stampsAwarded}</dd>
        </div>
        <div className="jata-stat">
          <dt>Rewards redeemed</dt>
          <dd>{stats.rewardsRedeemed}</dd>
        </div>
      </dl>

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

      <form onSubmit={saveProgram} className="jata-card space-y-3">
        <h2 className="text-sm font-bold">Programme settings</h2>
        <p className="jata-hint">
          Stamps are added by you after you verify a purchase. Nothing is tracked automatically — this first release has
          no automatic visit or purchase detection.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="jata-field">
            <label className="jata-label" htmlFor="loyalty-goal">
              Stamps per reward
            </label>
            <input id="loyalty-goal" className="jata-input" type="number" min={2} max={50} value={stampGoal} onChange={(event) => setStampGoal(event.target.value)} required />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="loyalty-per-visit">
              Stamps per transaction
            </label>
            <input id="loyalty-per-visit" className="jata-input" type="number" min={1} max={10} value={maxStampsPerVisit} onChange={(event) => setMaxStampsPerVisit(event.target.value)} required />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="loyalty-reward">
              Reward
            </label>
            <input id="loyalty-reward" className="jata-input" value={rewardDescription} onChange={(event) => setRewardDescription(event.target.value)} maxLength={160} required />
          </div>
        </div>
        <div className="jata-field">
          <label className="jata-label" htmlFor="loyalty-terms">
            Terms <span className="font-normal text-zinc-500">(optional, shown to customers)</span>
          </label>
          <input id="loyalty-terms" className="jata-input" value={terms} onChange={(event) => setTerms(event.target.value)} maxLength={400} />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} />
          Show the loyalty section on my business page
        </label>
        <button type="submit" className="jata-btn jata-btn-primary" disabled={busyId === "program"}>
          {busyId === "program" ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
          Save settings
        </button>
      </form>

      <form onSubmit={enrol} className="jata-card space-y-3">
        <h2 className="text-sm font-bold">Issue a card</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="jata-field">
            <label className="jata-label" htmlFor="card-name">
              Customer name
            </label>
            <input id="card-name" className="jata-input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={80} required />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="card-method">
              Contact method
            </label>
            <select id="card-method" className="jata-input" value={contactMethod} onChange={(event) => setContactMethod(event.target.value)}>
              <option value="PHONE">Phone</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="IN_PERSON">In person</option>
            </select>
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="card-contact">
              Contact <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input id="card-contact" className="jata-input" value={contactValue} onChange={(event) => setContactValue(event.target.value)} maxLength={60} />
          </div>
        </div>
        <button type="submit" className="jata-btn jata-btn-primary" disabled={busyId === "enrol"}>
          {busyId === "enrol" ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Plus size={15} aria-hidden="true" />}
          Issue card
        </button>
        {newCard ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm" role="status">
            Issued to {newCard.customerName}. Card code <span className="font-mono font-bold">{newCard.displayCode}</span> —
            write it on their card now; it is the only way they can check their progress.
          </p>
        ) : null}
      </form>

      {cards.length === 0 ? (
        <div className="jata-empty">
          <Gift size={20} aria-hidden="true" />
          <p className="text-sm font-semibold">No cards yet</p>
          <p className="mt-1 text-sm text-zinc-600">Issue a card to a customer, then verify their purchases to add stamps.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li key={card.id} className="jata-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{card.customerName}</p>
                  <p className="font-mono text-xs text-zinc-600">{card.displayCode}</p>
                  {card.lastStampAt ? <p className="text-xs text-zinc-600">Last stamp {formatDateTime(card.lastStampAt)}</p> : null}
                </div>
                <span className="jata-pill" data-tone={card.rewardsAvailable > 0 ? "success" : "neutral"}>
                  {card.balance} / {card.goal} stamps
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5" aria-hidden="true">
                {Array.from({ length: card.goal }, (_, index) => (
                  <span
                    key={index}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold ${
                      index < card.balance ? "border-emerald-600 bg-emerald-600 text-white" : "border-dashed border-zinc-300 text-zinc-400"
                    }`}
                  >
                    {index < card.balance ? <Star size={12} /> : index + 1}
                  </span>
                ))}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="jata-field">
                  <label className="jata-label" htmlFor={`ref-${card.id}`}>
                    Transaction reference
                  </label>
                  <input
                    id={`ref-${card.id}`}
                    className="jata-input"
                    value={references[card.id] ?? ""}
                    onChange={(event) => setReferences((current) => ({ ...current, [card.id]: event.target.value }))}
                    maxLength={80}
                    placeholder="Receipt 1042 / order ref / date"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <button type="button" className="jata-btn jata-btn-primary" onClick={() => award(card)} disabled={busyId === card.id}>
                    {busyId === card.id ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Award size={15} aria-hidden="true" />}
                    Verify &amp; award stamp
                  </button>
                  <button type="button" className="jata-btn jata-btn-secondary" onClick={() => redeem(card)} disabled={busyId !== null || card.rewardsAvailable < 1}>
                    <Gift size={15} aria-hidden="true" /> Redeem reward
                  </button>
                </div>
              </div>
              <p className="jata-hint mt-2">
                {card.rewardsAvailable > 0
                  ? `${card.rewardsAvailable} reward ready. Redeeming records the reward and takes ${card.goal} stamps off this card.`
                  : `${card.remaining} more stamp${card.remaining === 1 ? "" : "s"} before a reward is available.`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default LoyaltyBoard;
