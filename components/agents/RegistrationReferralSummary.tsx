"use client";
import { useEffect, useState } from "react";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; count: number };
export default function RegistrationReferralSummary() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/agents/referrals/summary", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Summary unavailable");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("registrationCount" in data) || typeof data.registrationCount !== "number" || !Number.isSafeInteger(data.registrationCount) || data.registrationCount < 0) throw new Error("Invalid summary");
        setState({ status: "ready", count: data.registrationCount });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  return <section aria-label="Registration referral summary">
    <h3>Consented registration referrals</h3>
    {state.status === "loading" ? <p role="status">Loading referral summary…</p> : state.status === "error" ? <p role="alert">Referral summary is temporarily unavailable. Refresh to try again.</p> : <p><strong>{state.count}</strong> {state.count === 1 ? "registration" : "registrations"} recorded.</p>}
    <p>These are registration records, not verified sales or commission eligibility.</p>
  </section>;
}
