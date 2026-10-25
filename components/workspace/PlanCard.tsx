import Link from "next/link";
import { ArrowRight, Bot, CalendarDays, Check, Sparkles, Store, Wand2 } from "lucide-react";
import { formatNumber } from "@/lib/dateFormat";

/**
 * A subscription plan card.
 *
 * Presentation only. The price, the billing period and the plan name come from the caller as
 * values read out of `PlanConfig`; this component never knows, invents or rounds a price. The
 * benefits list is the same `PLAN_INCLUDES` copy the public pricing grid uses, so the plan an
 * owner compares on the homepage is described identically here.
 */
export type PlanCardData = {
  id: string;
  key: string;
  name: string;
  priceKES: number;
  durationDays: number;
};

function planIcon(key: string) {
  if (key === "ANNUAL" || key === "MONTHLY") return <CalendarDays size={18} aria-hidden="true" />;
  if (key === "AI_BUSINESS_FRONT_DESK") return <Bot size={18} aria-hidden="true" />;
  if (key === "INTERACTIVE_BUSINESS") return <Wand2 size={18} aria-hidden="true" />;
  if (key === "BUSINESS_POS") return <Store size={18} aria-hidden="true" />;
  return <Sparkles size={18} aria-hidden="true" />;
}

export function PlanCard({
  plan,
  includes,
  badge,
  blurb,
  href,
  current = false,
}: {
  plan: PlanCardData;
  includes: readonly string[];
  badge?: string;
  blurb?: string | null;
  /** Checkout URL. Omitted when there is no business to attach the plan to. */
  href?: string;
  current?: boolean;
}) {
  const featured = plan.key === "ANNUAL";
  return (
    <article className="ws-plan" data-featured={featured} aria-label={plan.name}>
      <div className="ws-plan__head">
        <span className="ws-plan__icon" aria-hidden="true">
          {planIcon(plan.key)}
        </span>
        {current ? <span className="ws-plan__badge">Your plan</span> : badge ? <span className="ws-plan__badge">{badge}</span> : null}
      </div>
      <p className="ws-plan__name">{plan.name}</p>
      <p className="ws-plan__price">
        <span className="ws-plan__amount">KES {formatNumber(plan.priceKES)}</span>
        <span className="ws-plan__period">
          {plan.durationDays === 365 ? "per year" : `per ${plan.durationDays} days`} · {plan.durationDays} days access
        </span>
      </p>
      {includes.length > 0 ? (
        <ul className="ws-plan__includes">
          {includes.map((item) => (
            <li key={item}>
              <Check size={13} aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {blurb ? <p className="ws-muted ws-tiny">{blurb}</p> : null}
      {href ? (
        <Link href={href} className="jata-btn jata-btn-primary ws-plan__cta">
          Choose this plan <ArrowRight size={15} aria-hidden="true" />
        </Link>
      ) : null}
      <p className="ws-muted ws-tiny">You review the amount on Paystack before paying. The plan starts when payment is confirmed.</p>
    </article>
  );
}

export default PlanCard;
