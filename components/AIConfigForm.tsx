"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export function AIConfigForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [businessId, setBusinessId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    tone: "friendly",
    language: "en",
    salesBehavior: "informational",
    orderingAllowed: true,
    preordersAllowed: false,
    humanEscalation: "uncertain",
    welcomeMessage: "",
  });

  useEffect(() => {
    // Fetch user's first business for AI config
    fetch("/api/business").then((r) => r.json()).then((data) => {
      const businesses = Array.isArray(data.businesses) ? data.businesses : [];
      if (businesses.length > 0) setBusinessId(businesses[0].id);
    }).catch(() => { /* ignore */ });
  }, []);

  async function saveConfig() {
    if (!businessId) { setErr("No business found. Create a business first."); return; }
    setLoading(true);
    setErr("");
    setSuccess(false);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Could not save AI configuration.");
        return;
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setErr("Could not save AI configuration. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jata-card p-5">
      <h3 className="text-lg font-bold">AI Business Assistant Settings</h3>
      <p className="mt-1 text-sm text-zinc-600">These rules control how the AI communicates with customers (§29, §101).</p>

      <FormError>{err}</FormError>
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">AI settings saved.</p>}

      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); saveConfig(); }}>
        <Field id="ai-tone" label="Tone" hint="How the AI sounds to customers (§31).">
          <select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })}>
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="casual">Casual</option>
            <option value="premium">Premium</option>
            <option value="local">Local</option>
            <option value="formal">Formal</option>
          </select>
        </Field>

        <Field id="ai-language" label="Language" hint="English, Kiswahili, mixed, or other supported language (§23).">
          <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
            <option value="mixed">Mixed (English + Swahili)</option>
          </select>
        </Field>

        <Field id="ai-sales" label="Sales behavior" hint="How the AI should interact with buying intent (§31, §32).">
          <select value={form.salesBehavior} onChange={(e) => setForm({ ...form, salesBehavior: e.target.value })}>
            <option value="informational">Informational only</option>
            <option value="recommend">Recommend products</option>
            <option value="upsell">Upsell where appropriate</option>
            <option value="cross_sell">Cross-sell related items</option>
            <option value="promotions">Offer configured promotions</option>
          </select>
        </Field>

        <Field id="ai-ordering" label="Ordering allowed?">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.orderingAllowed} onChange={(e) => setForm({ ...form, orderingAllowed: e.target.checked })} />
            Allow AI to assist with orders
          </label>
        </Field>

        <Field id="ai-preorder" label="Pre-orders allowed?">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.preordersAllowed} onChange={(e) => setForm({ ...form, preordersAllowed: e.target.checked })} />
            Allow pre-orders for unavailable items
          </label>
        </Field>

        <Field id="ai-escalation" label="Human escalation" hint="When the AI should hand off to a human (§20, §31).">
          <select value={form.humanEscalation} onChange={(e) => setForm({ ...form, humanEscalation: e.target.value })}>
            <option value="always">Always available on request</option>
            <option value="business_hours">During business hours</option>
            <option value="specified_topics">For specified topics (complaints, refunds)</option>
            <option value="uncertain">When uncertain or missing authority</option>
          </select>
        </Field>

        <Field id="ai-welcome" label="Welcome message" hint="First message customers see (§24).">
          <textarea rows={2} maxLength={240} value={form.welcomeMessage} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })} placeholder="Welcome! How can I help you today?" />
        </Field>

        <Button className="w-full" disabled={loading || !businessId} onClick={saveConfig}>
          {loading ? "Saving…" : "Save AI settings"}
        </Button>
      </form>
    </div>
  );
}
