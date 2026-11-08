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
 * Presentation: drawn from the public storefront tokens (`.st-loyalty*` in `app/storefront.css`),
 * so it reads as a native JATA AFTERCALL feature — graphite structure, lime highlight, the same
 * radii and rhythm as every other section on the page — rather than an embedded widget.
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
      className="st-loyalty"
    >
      {/* Decorative only: the accent bloom that ties the band to the page's other surfaces. */}
      <span className="st-loyalty__glow" aria-hidden="true" />
      <div className="relative">
        <p className="st-loyalty__badge">
          <Sparkles size={13} aria-hidden="true" />
          Loyalty 2.0
        </p>
        <h2 id="loyalty-rewards-title" className="st-loyalty__title">
          Loyalty Rewards
        </h2>
        <p id="loyalty-rewards-subtitle" className="st-loyalty__subtitle">
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
      <p className="st-loyalty__pill" role="status">
        {unconfirmed ? "Rewards availability unconfirmed" : "Points rewards coming soon"}
      </p>
      <p className="st-loyalty__lead">
        {unconfirmed
          ? `We can't confirm ${businessName}'s points rewards right now. Please check back soon.`
          : `${businessName} hasn't switched on points rewards yet. This is where your points and rewards will live when they do.`}
      </p>
      <p className="st-loyalty__note">
        {unconfirmed
          ? "Nothing has changed with your points or stamps. If this business runs a stamp card, it is unaffected."
          : "Stamps are separate and unaffected — a stamp card keeps working exactly as it does today."}
      </p>
      <ul className="st-loyalty__list">
        {COMING_SOON.map((item) => (
          <li key={item.text} className="st-loyalty__listItem">
            <item.icon size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--st-accent)" }} />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      <p className="st-loyalty__fine">
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
      <p className="st-loyalty__pill st-loyalty__pill--live" role="status">
        Points rewards are live
      </p>

      <div className="st-loyalty__card">
        <h3 className="st-loyalty__cardTitle">
          <Coins size={15} aria-hidden="true" className="shrink-0" style={{ color: "var(--st-accent)" }} />
          How you earn
        </h3>
        <p className="st-loyalty__cardLead">
          {hasRate && earning
            ? `Earn ${pointsLabel(earning.pointsPerUnit ?? 0)} for every ${money(earning.kesPerPoint ?? 0)} you spend${
                earning.minPurchaseKES > 0 ? ` on purchases of ${money(earning.minPurchaseKES)} or more` : ""
              }.`
            : `${businessName} has not published an earning rate yet.`}
        </p>
        <div className="mt-1.5 grid gap-1.5">
          <p className="st-loyalty__note">
            {businessName} adds your points after they verify your purchase. Asking for a quote or sending an order
            request does not earn points, because no payment is taken on this page.
          </p>
          {earning?.description ? <p className="st-loyalty__note">{earning.description}</p> : null}
          {earning?.expiryMonths ? (
            <p className="st-loyalty__note" style={{ display: "flex", gap: "0.35rem", alignItems: "flex-start" }}>
              <Timer size={13} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--st-accent)" }} />
              Points expire {earning.expiryMonths} month{earning.expiryMonths === 1 ? "" : "s"} after you earn them.
            </p>
          ) : (
            <p className="st-loyalty__note">Your points do not expire.</p>
          )}
          {earning?.terms ? <p className="st-loyalty__note whitespace-pre-line">{earning.terms}</p> : null}
        </div>
      </div>

      <div className="st-loyalty__card">
        <h3 className="st-loyalty__cardTitle">
          <Gift size={15} aria-hidden="true" className="shrink-0" style={{ color: "var(--st-accent)" }} />
          Rewards
        </h3>
        {rewards.rewards.length === 0 ? (
          <p className="st-loyalty__note mt-1.5">{businessName} has not published any rewards yet.</p>
        ) : (
          <ul className="st-loyalty__rewards">
            {rewards.rewards.map((reward) => (
              <li key={reward.id} className="st-loyalty__reward">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="st-loyalty__rewardTitle">{reward.title}</p>
                  <p className="st-loyalty__rewardCost">{pointsLabel(reward.pointsCost)}</p>
                </div>
                {reward.description ? <p className="st-loyalty__note mt-1">{reward.description}</p> : null}
                {reward.discountKES ? (
                  <p className="st-loyalty__note mt-1">{money(reward.discountKES)} off your purchase.</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="st-loyalty__card">
        <h3 className="st-loyalty__cardTitle">
          <TicketPercent size={15} aria-hidden="true" className="shrink-0" style={{ color: "var(--st-accent)" }} />
          Redeeming your points
        </h3>
        <div className="mt-1.5 grid gap-1.5">
          {redemption?.rules ? <p className="st-loyalty__cardLead">{redemption.rules}</p> : null}
          {redemption && redemption.minRedeemPoints > 0 ? (
            <p className="st-loyalty__note">
              You can start redeeming once you hold {pointsLabel(redemption.minRedeemPoints)}.
            </p>
          ) : null}
          {redemption?.pointValueKES ? (
            <p className="st-loyalty__note">Each point is worth about {money(redemption.pointValueKES)} of value.</p>
          ) : null}
          <p className="st-loyalty__note">
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
