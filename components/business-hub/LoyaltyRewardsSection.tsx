"use client";

/**
 * Public Loyalty Rewards section (Loyalty 2.0) — the customer-facing front door of the programme.
 *
 * The section is part of the page whether or not the business has switched points on. Hiding it
 * made the feature undiscoverable: a customer had no way to know the business offered rewards at
 * all. So the section is always rendered and its STATE carries the truth:
 *
 *   • `inactive` — the programme does not exist or is switched off. The section says so ("Points
 *     rewards coming soon") and publishes no rate, reward, balance or expiry, because there is
 *     nothing authorised to publish.
 *   • `unknown`  — the configuration could not be read. The section stays with a neutral
 *     availability message instead of vanishing, and again publishes nothing.
 *   • `active`   — the values the owner actually configured: earning rules, rewards, redemption
 *     information, and the card-code lookup.
 *
 * Nothing here activates a programme, issues points or changes a balance — it is a read-only view
 * of `PublicLoyaltyRewards`. The stamp card is a separate section with its own flag and is not
 * touched by this one.
 *
 * Palette: the graphite/lime identity the rest of Loyalty 2.0 already ships with (see
 * `PointsWallet` and the owner's Points board) — `#16181d` on `#b6ff2e`. It is applied with the
 * same Tailwind tokens those surfaces use, so the brand stylesheet keeps its own palette.
 */

import { Coins, Gift, ShieldCheck, Sparkles, TicketPercent, Timer } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { PointsWalletLookup } from "./PointsWalletLookup";
import type { PublicLoyaltyRewards } from "@/lib/business-hub/loyaltyPoints";

const money = (value: number) => `KES ${formatNumber(Math.round(value))}`;
const pointsLabel = (value: number) => `${formatNumber(value)} ${value === 1 ? "point" : "points"}`;

/** What the section offers once a programme is switched on. Framed in the future tense: while the
 *  programme is off, nothing on this page may read as an offer the customer can take up today. */
const COMING_SOON = [
  { icon: Coins, text: "Earn points on the purchases the business verifies" },
  { icon: Gift, text: "Spend your points on the rewards the business publishes" },
  { icon: ShieldCheck, text: "See your balance here with your loyalty card code" },
];

export function LoyaltyRewardsSection({
  businessName,
  businessSlug,
  rewards,
}: {
  businessName: string;
  businessSlug: string;
  rewards: PublicLoyaltyRewards;
}) {
  const status = rewards.status;

  return (
    <section
      id="loyalty-rewards"
      data-loyalty-state={status}
      aria-labelledby="loyalty-rewards-title"
      className="relative mt-4 overflow-hidden rounded-3xl border border-[#b6ff2e]/20 bg-[#16181d] p-5 shadow-lg shadow-black/20 sm:p-6"
    >
      {/* Decorative only: a lime bloom in the corner, so the band reads as a premium surface
          without an animation a customer has to wait for. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(182,255,46,0.18),rgba(182,255,46,0)_70%)]"
      />
      <div className="relative">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-[#b6ff2e]/10 px-2.5 py-1 text-[0.68rem] font-extrabold uppercase tracking-[0.16em] text-[#b6ff2e]">
          <Sparkles size={13} aria-hidden="true" />
          Loyalty 2.0
        </p>
        <h2
          id="loyalty-rewards-title"
          className="mt-2.5 text-lg font-extrabold uppercase tracking-[0.12em] text-white sm:text-xl"
        >
          Loyalty Rewards
        </h2>
        <p id="loyalty-rewards-subtitle" className="mt-1 text-sm font-semibold text-[#b6ff2e]">
          Shop. Earn. Enjoy rewards.
        </p>

        {status === "active" ? (
          <ActiveRewards businessName={businessName} businessSlug={businessSlug} rewards={rewards} />
        ) : (
          <PendingRewards businessName={businessName} status={status} />
        )}
      </div>
    </section>
  );
}

/**
 * STATE A — the programme is not available to customers.
 *
 * No balance, no rate, no reward, no expiry and no call to action: everything a customer could read
 * as an entitlement is deliberately absent. The three lines below describe the product in the
 * future tense, which is the honest way to present a feature this business has not switched on.
 */
function PendingRewards({ businessName, status }: { businessName: string; status: "inactive" | "unknown" }) {
  const unconfirmed = status === "unknown";
  return (
    <div className="mt-4 grid gap-3">
      <p
        role="status"
        className="inline-flex w-fit items-center rounded-full bg-white/10 px-3 py-1 text-[0.72rem] font-extrabold uppercase tracking-[0.08em] text-zinc-200"
      >
        {unconfirmed ? "Rewards availability unconfirmed" : "Points rewards coming soon"}
      </p>
      <p className="text-sm leading-6 text-zinc-100">
        {unconfirmed
          ? `We can't confirm ${businessName}'s points rewards right now. Please check back soon.`
          : `${businessName} hasn't switched on points rewards yet. This is where your points and rewards will live when they do.`}
      </p>
      <p className="text-[0.78rem] leading-5 text-zinc-400">
        {unconfirmed
          ? "Nothing has changed with your points or stamps. If this business runs a stamp card, it is unaffected."
          : "Stamps are separate and unaffected — a stamp card keeps working exactly as it does today."}
      </p>
      <ul className="mt-0.5 grid gap-2">
        {COMING_SOON.map((item) => (
          <li
            key={item.text}
            className="flex items-start gap-2.5 rounded-2xl bg-white/5 p-3 text-[0.82rem] leading-5 text-zinc-200 transition-colors hover:bg-white/[0.07]"
          >
            <item.icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[#b6ff2e]" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-white/10 pt-2.5 text-[0.7rem] leading-5 text-zinc-500">
        Points are not cash and cannot be withdrawn. Rates, rewards and expiry are set by {businessName} and are not
        published until they switch points on.
      </p>
    </div>
  );
}

/** STATE B — the programme is active, so the configured information is published verbatim. */
function ActiveRewards({
  businessName,
  businessSlug,
  rewards,
}: {
  businessName: string;
  businessSlug: string;
  rewards: PublicLoyaltyRewards;
}) {
  const earning = rewards.earning;
  const redemption = rewards.redemption;
  const hasRate = Boolean(earning?.pointsPerUnit && earning?.kesPerPoint);

  return (
    <div className="mt-4 grid gap-3">
      <p
        role="status"
        className="inline-flex w-fit items-center rounded-full bg-[#b6ff2e]/15 px-3 py-1 text-[0.72rem] font-extrabold uppercase tracking-[0.08em] text-[#b6ff2e]"
      >
        Points rewards are live
      </p>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <h3 className="flex items-center gap-2 text-[0.78rem] font-extrabold uppercase tracking-[0.08em] text-white">
          <Coins size={15} aria-hidden="true" className="shrink-0 text-[#b6ff2e]" />
          How you earn
        </h3>
        <p className="mt-2 text-sm font-semibold leading-6 text-zinc-100">
          {hasRate && earning
            ? `Earn ${pointsLabel(earning.pointsPerUnit ?? 0)} for every ${money(earning.kesPerPoint ?? 0)} you spend${
                earning.minPurchaseKES > 0 ? ` on purchases of ${money(earning.minPurchaseKES)} or more` : ""
              }.`
            : `${businessName} has not published an earning rate yet.`}
        </p>
        <div className="mt-1.5 grid gap-1.5">
          <p className="text-[0.78rem] leading-5 text-zinc-400">
            {businessName} adds your points after they verify your purchase. Asking for a quote or sending an order
            request does not earn points, because no payment is taken on this page.
          </p>
          {earning?.description ? <p className="text-[0.78rem] leading-5 text-zinc-300">{earning.description}</p> : null}
          {earning?.expiryMonths ? (
            <p className="flex items-start gap-1.5 text-[0.78rem] leading-5 text-zinc-400">
              <Timer size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-[#b6ff2e]" />
              Points expire {earning.expiryMonths} month{earning.expiryMonths === 1 ? "" : "s"} after you earn them.
            </p>
          ) : (
            <p className="text-[0.78rem] leading-5 text-zinc-400">Your points do not expire.</p>
          )}
          {earning?.terms ? (
            <p className="whitespace-pre-line text-[0.78rem] leading-5 text-zinc-400">{earning.terms}</p>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <h3 className="flex items-center gap-2 text-[0.78rem] font-extrabold uppercase tracking-[0.08em] text-white">
          <Gift size={15} aria-hidden="true" className="shrink-0 text-[#b6ff2e]" />
          Rewards
        </h3>
        {rewards.rewards.length === 0 ? (
          <p className="mt-1.5 text-[0.78rem] leading-5 text-zinc-400">
            {businessName} has not published any rewards yet.
          </p>
        ) : (
          <ul className="mt-2 grid divide-y divide-white/10">
            {rewards.rewards.map((reward) => (
              <li key={reward.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100">{reward.title}</p>
                  {reward.description ? (
                    <p className="mt-0.5 text-[0.78rem] leading-5 text-zinc-400">{reward.description}</p>
                  ) : null}
                  {reward.discountKES ? (
                    <p className="mt-0.5 text-[0.78rem] leading-5 text-zinc-400">
                      {money(reward.discountKES)} off your purchase.
                    </p>
                  ) : null}
                </div>
                <p className="text-sm font-extrabold text-[#b6ff2e]">{pointsLabel(reward.pointsCost)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <h3 className="flex items-center gap-2 text-[0.78rem] font-extrabold uppercase tracking-[0.08em] text-white">
          <TicketPercent size={15} aria-hidden="true" className="shrink-0 text-[#b6ff2e]" />
          Redeeming your points
        </h3>
        <div className="mt-1.5 grid gap-1.5">
          {redemption?.rules ? (
            <p className="text-sm font-semibold leading-6 text-zinc-100">{redemption.rules}</p>
          ) : null}
          {redemption && redemption.minRedeemPoints > 0 ? (
            <p className="text-[0.78rem] leading-5 text-zinc-400">
              You can start redeeming once you hold {pointsLabel(redemption.minRedeemPoints)}.
            </p>
          ) : null}
          {redemption?.pointValueKES ? (
            <p className="text-[0.78rem] leading-5 text-zinc-400">
              Each point is worth about {money(redemption.pointValueKES)} of value.
            </p>
          ) : null}
          <p className="text-[0.78rem] leading-5 text-zinc-400">
            Points are not cash and cannot be withdrawn. Redeeming records that {businessName} owes you the reward; no
            payment is taken or made on this page.
          </p>
        </div>
      </div>

      {/* The lookup itself — the same card-code normalisation and business-page scoping as before.
          It is the only control on this page that opens a customer's own balance. */}
      <PointsWalletLookup businessName={businessName} businessSlug={businessSlug} />
    </div>
  );
}

export default LoyaltyRewardsSection;
