"use client";

import { useState } from "react";
import { Coins, Search } from "lucide-react";
import { PointsWallet } from "./PointsWallet";

/**
 * Independent customer entry point for Loyalty 2.0.
 * The public page renders this only when the business points programme is active.
 * The existing stamp-card lookup remains a separate feature and is not required here.
 */
export function PointsWalletLookup({ businessName }: { businessName: string }) {
  const [code, setCode] = useState("");
  const [lookupCode, setLookupCode] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().replace(/\s+/g, "").toUpperCase();
    if (normalized.length >= 4) setLookupCode(normalized);
  }

  return (
    <section id="points-rewards" className="jata-card" aria-labelledby="points-rewards-title">
      <h2 id="points-rewards-title" className="jata-section-title flex items-center gap-2">
        <Coins size={18} aria-hidden="true" />
        Points &amp; rewards
      </h2>
      {lookupCode ? (
        <>
          <PointsWallet code={lookupCode} businessName={businessName} />
          <button type="button" className="jata-btn jata-btn-secondary mt-3" onClick={() => { setLookupCode(""); setCode(""); }}>
            Check another card
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <p className="jata-hint">Enter the code on your loyalty card to view your points balance and available rewards. Points are separate from stamps.</p>
          <div className="jata-field">
            <label className="jata-label" htmlFor="points-card-code">Loyalty card code</label>
            <input
              id="points-card-code"
              className="jata-input font-mono uppercase tracking-wider"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="JATA-4F9K-2Q7M"
              maxLength={20}
              autoComplete="off"
              required
            />
          </div>
          <button type="submit" className="jata-btn jata-btn-primary" disabled={code.trim().length < 4}>
            <Search size={16} aria-hidden="true" /> View points
          </button>
        </form>
      )}
    </section>
  );
}

export default PointsWalletLookup;
