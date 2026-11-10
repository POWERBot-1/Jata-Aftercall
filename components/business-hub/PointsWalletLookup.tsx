"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { PointsWallet } from "./PointsWallet";
import { normaliseCardCode } from "@/lib/business-hub/cardCode";

/** Shortest code the lookup will take. Real codes are longer; this only stops a stray tap. */
const MIN_CODE_LENGTH = 4;

const FIELD = "st-loyalty__input font-mono uppercase tracking-wider";
const BUTTON = "st-loyalty__button";

/**
 * Independent customer entry point for Loyalty 2.0.
 *
 * The public page renders this only when the business points programme is active, and it does not
 * depend on the stamp-card programme in any way: it is a separate control with its own form, so a
 * business that runs points but not stamps still offers points here, and a stamp customer never has
 * to look up their stamp card first to reach their points.
 *
 * `businessSlug` scopes the lookup to this business's page. A card issued by a different business is
 * refused by the server with the same answer as a code that does not exist.
 */
export function PointsWalletLookup({
  businessName,
  businessSlug,
}: {
  businessName: string;
  businessSlug: string;
}) {
  const [code, setCode] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [rejected, setRejected] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normaliseCardCode(code);
    if (normalized.length < MIN_CODE_LENGTH) {
      // The button is disabled below this length; this is the keyboard-submit path.
      setRejected(true);
      return;
    }
    setRejected(false);
    setLookupCode(normalized);
  }

  return (
    <div
      id="points-rewards"
      aria-labelledby="points-rewards-title"
      className="st-loyalty__lookup"
    >
      <h3 id="points-rewards-title" className="st-loyalty__cardTitle">
        <Search size={15} aria-hidden="true" className="shrink-0" style={{ color: "var(--st-accent)" }} />
        Check your points
      </h3>
      {lookupCode ? (
        <>
          <PointsWallet code={lookupCode} businessName={businessName} businessSlug={businessSlug} />
          <button
            type="button"
            className={`${BUTTON} st-loyalty__button--ghost mt-3 w-full sm:w-auto`}
            onClick={() => {
              setLookupCode("");
              setCode("");
              setRejected(false);
            }}
          >
            Check another card
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-3 grid gap-3">
          <p className="st-loyalty__note">
            Enter the code on your loyalty card to view your points balance and available rewards. Points are separate
            from stamps.
          </p>
          <div className="grid gap-1.5">
            <label className="st-loyalty__label" htmlFor="points-card-code">
              Loyalty card code
            </label>
            <input
              id="points-card-code"
              className={`${FIELD} font-mono uppercase tracking-wider`}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                setRejected(false);
              }}
              placeholder="JATA-4F9K-2Q7M"
              maxLength={60}
              autoComplete="off"
              aria-describedby={rejected ? "points-card-code-hint" : undefined}
              required
            />
            {rejected ? (
              <p id="points-card-code-hint" className="st-loyalty__note" style={{ color: "var(--st-accent)" }} role="alert">
                That code is too short. Check the code printed on your card.
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            className={`${BUTTON} w-full sm:w-auto`}
            disabled={code.trim().length < MIN_CODE_LENGTH}
          >
            <Search size={16} aria-hidden="true" /> View points
          </button>
        </form>
      )}
    </div>
  );
}

export default PointsWalletLookup;
