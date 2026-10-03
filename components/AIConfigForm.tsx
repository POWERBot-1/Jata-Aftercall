"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AI_BUSINESS_TEMPLATES, type BusinessTemplate } from "@/lib/ai-templates";
import type { DeliveryZoneRule } from "@/lib/ai-config";

type AIConfigFormProps = {
  businessId: string;
  businessSlug?: string;
};

export default function AIConfigForm({ businessId, businessSlug }: AIConfigFormProps) {
  const [toneOfVoice, setToneOfVoice] = useState("Friendly");
  const [greetingMessage, setGreetingMessage] = useState("");
  const [fallbackMessage, setFallbackMessage] = useState(
    "I don't have that information yet. Let me connect you with the business.",
  );
  const [languageBehavior, setLanguageBehavior] = useState("English + Swahili");
  const [afterHoursMessage, setAfterHoursMessage] = useState("");
  const [escalationRules, setEscalationRules] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [orderingAllowed, setOrderingAllowed] = useState(true);
  const [bookingsAllowed, setBookingsAllowed] = useState(true);
  const [preordersAllowed, setPreordersAllowed] = useState(false);

  // Extended configuration (§13, §37, §43, §45)
  const [templateCategory, setTemplateCategory] = useState("Retail Shop");
  const [operationalStatus, setOperationalStatus] = useState<"LIVE" | "PAUSED" | "MAINTENANCE">("LIVE");
  const [pauseAllOrdering, setPauseAllOrdering] = useState(false);
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZoneRule[]>([]);
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneFee, setNewZoneFee] = useState("200");
  const [freeDeliveryThreshold, setFreeDeliveryThreshold] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [refundPolicy, setRefundPolicy] = useState("");
  const [returnPolicy, setReturnPolicy] = useState("");
  const [cancellationPolicy, setCancellationPolicy] = useState("");

  // Merchant payment & nominated recipient (§14, §21)
  const [publicPaymentInfo, setPublicPaymentInfo] = useState("");
  const [notificationPhone, setNotificationPhone] = useState("");
  const [notificationLabel, setNotificationLabel] = useState("PRIMARY");

  // Readiness & Subscription (§4, §30, §31)
  const [readiness, setReadiness] = useState<{
    ready: boolean;
    canPublish: boolean;
    detailedChecks?: Array<{ id: string; label: string; passed: boolean; detail: string }>;
    missingItems?: string[];
  } | null>(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState<{
    status: string;
    entitled: boolean;
    planPriceKES?: number;
    planLabel?: string;
    durationDays?: number;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;

    Promise.all([
      fetch(`/api/ai/config?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/merchant-payment?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/notification-recipients?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/ai/readiness?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/ai/entitlement?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
    ]).then(([cfgData, payData, notifData, readyData, entData]) => {
      const c = cfgData?.config || {};
      const ext = cfgData?.extendedConfig || {};
      setToneOfVoice(c.toneOfVoice || ext.toneOfVoice || "Friendly");
      setGreetingMessage(c.greetingMessage || ext.greetingMessage || "");
      setFallbackMessage(
        c.fallbackMessage ||
          ext.fallbackMessage ||
          "I don't have that information yet. Let me connect you with the business.",
      );
      setLanguageBehavior(c.languageBehavior || ext.languageBehavior || "English + Swahili");
      setAfterHoursMessage(c.afterHoursMessage || ext.afterHoursMessage || "");
      setEscalationRules(c.escalationRules || ext.escalationRules || "");
      setAutoReplyEnabled(c.autoReplyEnabled !== undefined ? c.autoReplyEnabled : true);
      setOrderingAllowed(c.orderingAllowed !== undefined ? c.orderingAllowed : true);
      setBookingsAllowed(c.bookingsAllowed !== undefined ? c.bookingsAllowed : true);
      setPreordersAllowed(c.preordersAllowed !== undefined ? c.preordersAllowed : false);

      if (ext.templateCategory) setTemplateCategory(ext.templateCategory);
      if (ext.operationalStatus) setOperationalStatus(ext.operationalStatus);
      if (ext.pauseAllOrdering !== undefined) setPauseAllOrdering(Boolean(ext.pauseAllOrdering));
      if (ext.delivery) {
        setPickupEnabled(ext.delivery.pickupEnabled !== false);
        setDeliveryEnabled(Boolean(ext.delivery.deliveryEnabled));
        setDeliveryZones(Array.isArray(ext.delivery.zones) ? ext.delivery.zones : []);
        setFreeDeliveryThreshold(
          typeof ext.delivery.freeDeliveryThresholdKES === "number"
            ? String(ext.delivery.freeDeliveryThresholdKES)
            : "",
        );
        setDeliveryInstructions(ext.delivery.deliveryInstructions || "");
      }
      if (ext.policies) {
        setRefundPolicy(ext.policies.refundPolicy || "");
        setReturnPolicy(ext.policies.returnPolicy || "");
        setCancellationPolicy(ext.policies.cancellationPolicy || "");
      }

      if (payData?.config?.publicInfo) {
        setPublicPaymentInfo(payData.config.publicInfo);
      }
      if (Array.isArray(notifData?.recipients) && notifData.recipients[0]) {
        setNotificationPhone(notifData.recipients[0].phone || "");
        setNotificationLabel(notifData.recipients[0].label || "PRIMARY");
      }
      if (readyData && typeof readyData.ready === "boolean") {
        setReadiness(readyData);
      }
      if (entData?.entitlement) {
        setSubscriptionInfo({
          status: entData.entitlement.status,
          entitled: Boolean(entData.entitlement.entitled),
          planPriceKES: entData.plan?.priceKes,
          planLabel: entData.plan?.label,
          durationDays: entData.plan?.durationDays,
        });
      }
    });
  }, [businessId]);

  function applyBusinessTemplate(template: BusinessTemplate) {
    setTemplateCategory(template.label);
    setToneOfVoice(template.defaultTone);
    setGreetingMessage(template.welcomeMessage);
    setOrderingAllowed(template.orderingAllowed);
    setPreordersAllowed(template.preordersAllowed);
    setStatusMsg(`Applied "${template.label}" template defaults.`);
  }

  function addDeliveryZone() {
    const trimmed = newZoneName.trim();
    if (!trimmed) return;
    const fee = Math.max(0, Math.round(Number(newZoneFee) || 0));
    setDeliveryZones((prev) => [
      ...prev.filter((z) => z.name.toLowerCase() !== trimmed.toLowerCase()),
      { name: trimmed, feeKES: fee },
    ]);
    setNewZoneName("");
  }

  function removeDeliveryZone(name: string) {
    setDeliveryZones((prev) => prev.filter((z) => z.name !== name));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          toneOfVoice,
          greetingMessage,
          fallbackMessage,
          languageBehavior,
          afterHoursMessage,
          escalationRules,
          autoReplyEnabled,
          orderingAllowed,
          bookingsAllowed,
          preordersAllowed,
          templateCategory,
          operationalStatus,
          pauseAllOrdering,
          delivery: {
            pickupEnabled,
            deliveryEnabled,
            zones: deliveryZones,
            freeDeliveryThresholdKES: freeDeliveryThreshold ? Number(freeDeliveryThreshold) : null,
            deliveryInstructions: deliveryInstructions || null,
          },
          policies: {
            refundPolicy: refundPolicy || null,
            returnPolicy: returnPolicy || null,
            cancellationPolicy: cancellationPolicy || null,
          },
        }),
      });
      if (!res.ok) throw new Error("Save failed.");

      if (publicPaymentInfo.trim()) {
        await fetch("/api/merchant-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            publicInfo: publicPaymentInfo.trim(),
          }),
        });
      }

      if (notificationPhone.trim()) {
        await fetch("/api/notification-recipients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            label: notificationLabel,
            phone: notificationPhone.trim(),
            whatsappEnabled: true,
          }),
        });
      }

      const readyRes = await fetch(`/api/ai/readiness?businessId=${businessId}`).then((r) => r.json());
      if (readyRes && typeof readyRes.ready === "boolean") {
        setReadiness(readyRes);
      }

      setStatusMsg("AI configuration, delivery rules, payment details, and notifications saved.");
    } catch {
      setStatusMsg("Error saving AI configuration.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/ai/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error || "Cannot publish yet. Complete Readiness checks and active subscription.");
        if (data.readiness) setReadiness(data.readiness);
        return;
      }
      setStatusMsg(`Published live! Shareable AI link: ${data.sharePath}`);
      if (data.readiness) setReadiness(data.readiness);
    } catch {
      setStatusMsg("Failed to publish AI Front Desk.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 p-4 border rounded-xl bg-slate-900 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">AI Business Front Desk Configuration</h2>
          <p className="text-xs text-slate-300">
            Configure your business brain, delivery zones, payment instructions, notification numbers, and readiness gate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {businessSlug && (
            <Link
              href={`/b/${businessSlug}/ai?preview=true`}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
            >
              Preview AI Front Desk
            </Link>
          )}
          <Link
            href={`/dashboard/ai?businessId=${businessId}`}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            Open AI Dashboard
          </Link>
        </div>
      </div>

      {/* Business Category Template Selector (§42, §43) */}
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <label className="block text-xs font-semibold text-slate-200">
          Business Type Template (1-Click Starter Defaults)
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.values(AI_BUSINESS_TEMPLATES).map((tpl) => (
            <button
              key={tpl.key}
              type="button"
              onClick={() => applyBusinessTemplate(tpl)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                templateCategory === tpl.label
                  ? "bg-emerald-600 text-white"
                  : "border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Operational Status & Emergency Controls (§45) */}
      <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
        <div>
          <label className="block text-xs font-semibold text-slate-200">Operational Status</label>
          <select
            value={operationalStatus}
            onChange={(e) => setOperationalStatus(e.target.value as "LIVE" | "PAUSED" | "MAINTENANCE")}
            className="mt-1 w-full rounded bg-slate-900 p-2 border border-slate-700 text-sm"
          >
            <option value="LIVE">LIVE — Active & Answering</option>
            <option value="PAUSED">PAUSED — Temporarily Paused</option>
            <option value="MAINTENANCE">MAINTENANCE — Human Handoff Only</option>
          </select>
        </div>
        <div className="flex items-center">
          <label className="flex items-center gap-2 text-xs font-semibold text-amber-300">
            <input
              type="checkbox"
              checked={pauseAllOrdering}
              onChange={(e) => setPauseAllOrdering(e.target.checked)}
            />
            PAUSE ALL ORDERING (Emergency Stop)
          </label>
        </div>
      </div>

      {/* Core AI Behavior (§37) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Tone of Voice</label>
          <select
            value={toneOfVoice}
            onChange={(e) => setToneOfVoice(e.target.value)}
            className="mt-1 w-full rounded bg-slate-800 p-2 border border-slate-700"
          >
            <option value="Friendly">Friendly</option>
            <option value="Formal">Formal</option>
            <option value="Direct">Direct</option>
            <option value="Warm">Warm</option>
            <option value="Premium">Premium</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Language Behavior</label>
          <select
            value={languageBehavior}
            onChange={(e) => setLanguageBehavior(e.target.value)}
            className="mt-1 w-full rounded bg-slate-800 p-2 border border-slate-700"
          >
            <option value="English">English</option>
            <option value="Swahili">Swahili</option>
            <option value="English + Swahili">English + Swahili (Mixed Kenyan)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">Greeting Message</label>
        <textarea
          value={greetingMessage}
          onChange={(e) => setGreetingMessage(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded bg-slate-800 p-2 border border-slate-700"
          placeholder="Hello! Welcome to our business. How can I help you today?"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Fallback Message (When Answer Is Unknown)</label>
        <textarea
          value={fallbackMessage}
          onChange={(e) => setFallbackMessage(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded bg-slate-800 p-2 border border-slate-700"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">After-Hours Message</label>
          <textarea
            value={afterHoursMessage}
            onChange={(e) => setAfterHoursMessage(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded bg-slate-800 p-2 border border-slate-700"
            placeholder="We are currently closed. Leave your order or question and we will reply when we open."
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Human Escalation & Handoff Rules</label>
          <textarea
            value={escalationRules}
            onChange={(e) => setEscalationRules(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded bg-slate-800 p-2 border border-slate-700"
            placeholder="Escalate refunds, custom bulk quotes, and complaints to the business owner."
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-1 sm:grid-cols-4">
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={autoReplyEnabled}
            onChange={(e) => setAutoReplyEnabled(e.target.checked)}
          />
          <span>Auto-Reply Enabled</span>
        </label>
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={orderingAllowed}
            onChange={(e) => setOrderingAllowed(e.target.checked)}
          />
          <span>Ordering Allowed</span>
        </label>
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={bookingsAllowed}
            onChange={(e) => setBookingsAllowed(e.target.checked)}
          />
          <span>Bookings Allowed</span>
        </label>
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={preordersAllowed}
            onChange={(e) => setPreordersAllowed(e.target.checked)}
          />
          <span>Pre-Orders Allowed</span>
        </label>
      </div>

      {/* Delivery Configuration (§13) */}
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white">Delivery & Fulfilment Configuration</h3>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={pickupEnabled}
              onChange={(e) => setPickupEnabled(e.target.checked)}
            />
            Customer Pickup Available
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={deliveryEnabled}
              onChange={(e) => setDeliveryEnabled(e.target.checked)}
            />
            Delivery Available
          </label>
        </div>

        {deliveryEnabled && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                placeholder="Zone name (e.g. CBD, Westlands, Kilimani)"
                className="flex-1 rounded bg-slate-900 p-2 border border-slate-700 text-xs"
              />
              <input
                type="number"
                value={newZoneFee}
                onChange={(e) => setNewZoneFee(e.target.value)}
                placeholder="Fee (KES)"
                className="w-28 rounded bg-slate-900 p-2 border border-slate-700 text-xs"
              />
              <button
                type="button"
                onClick={addDeliveryZone}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Add Zone
              </button>
            </div>

            {deliveryZones.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {deliveryZones.map((z) => (
                  <span
                    key={z.name}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs"
                  >
                    {z.name}: KES {z.feeKES}
                    <button
                      type="button"
                      onClick={() => removeDeliveryZone(z.name)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="number"
                value={freeDeliveryThreshold}
                onChange={(e) => setFreeDeliveryThreshold(e.target.value)}
                placeholder="Free delivery above KES (optional)"
                className="rounded bg-slate-900 p-2 border border-slate-700 text-xs"
              />
              <input
                type="text"
                value={deliveryInstructions}
                onChange={(e) => setDeliveryInstructions(e.target.value)}
                placeholder="Delivery instructions / dispatch hours"
                className="rounded bg-slate-900 p-2 border border-slate-700 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* Merchant Payment & Nominated Notification Destination (§14, §21) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
          <label className="block text-xs font-semibold text-white">
            Customer Payment Instructions (Public Only — Never Secrets)
          </label>
          <input
            type="text"
            value={publicPaymentInfo}
            onChange={(e) => setPublicPaymentInfo(e.target.value)}
            placeholder="e.g. M-Pesa Till 123456 or Paybill 247247 Acc Name"
            className="w-full rounded bg-slate-900 p-2 border border-slate-700 text-xs"
          />
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
          <label className="block text-xs font-semibold text-white">
            Nominated Business Notification Number (WhatsApp / SMS)
          </label>
          <div className="flex gap-2">
            <select
              value={notificationLabel}
              onChange={(e) => setNotificationLabel(e.target.value)}
              className="rounded bg-slate-900 p-2 border border-slate-700 text-xs"
            >
              <option value="PRIMARY">PRIMARY</option>
              <option value="SECONDARY">SECONDARY</option>
              <option value="OWNER">OWNER</option>
              <option value="STAFF">STAFF</option>
            </select>
            <input
              type="tel"
              value={notificationPhone}
              onChange={(e) => setNotificationPhone(e.target.value)}
              placeholder="+254712345678"
              className="flex-1 rounded bg-slate-900 p-2 border border-slate-700 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Business Policies (§6) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          type="text"
          value={refundPolicy}
          onChange={(e) => setRefundPolicy(e.target.value)}
          placeholder="Refund policy"
          className="rounded bg-slate-800 p-2 border border-slate-700 text-xs"
        />
        <input
          type="text"
          value={returnPolicy}
          onChange={(e) => setReturnPolicy(e.target.value)}
          placeholder="Return / exchange policy"
          className="rounded bg-slate-800 p-2 border border-slate-700 text-xs"
        />
        <input
          type="text"
          value={cancellationPolicy}
          onChange={(e) => setCancellationPolicy(e.target.value)}
          placeholder="Cancellation policy"
          className="rounded bg-slate-800 p-2 border border-slate-700 text-xs"
        />
      </div>

      {/* AI Readiness Gate & Subscription Status (§4, §30, §31) */}
      {readiness && (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">
              AI Readiness Gate:{" "}
              <span className={readiness.ready ? "text-emerald-400" : "text-amber-400"}>
                {readiness.ready ? "READY FOR PUBLISH" : "CONFIGURATION INCOMPLETE"}
              </span>
            </h3>
            {subscriptionInfo && (
              <span className="text-xs text-slate-300">
                Package: {subscriptionInfo.planLabel || "AI Business Front Desk"} •{" "}
                {subscriptionInfo.planPriceKES ? `KES ${subscriptionInfo.planPriceKES} / month` : ""} • Status:{" "}
                <strong className="text-white">{subscriptionInfo.status}</strong>
              </span>
            )}
          </div>
          {Array.isArray(readiness.detailedChecks) && (
            <ul className="grid gap-1.5 sm:grid-cols-2 text-xs">
              {readiness.detailedChecks.map((chk) => (
                <li key={chk.id} className="flex items-center gap-2">
                  <span className={chk.passed ? "text-emerald-400" : "text-amber-400"}>
                    {chk.passed ? "✓" : "•"}
                  </span>
                  <span className="text-slate-200">{chk.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {statusMsg && <div className="text-sm text-emerald-400">{statusMsg}</div>}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded font-medium text-sm disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save AI Configuration"}
        </button>

        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium text-sm disabled:opacity-50"
        >
          {publishing ? "Publishing..." : "Verify & Publish AI Front Desk"}
        </button>
      </div>
    </form>
  );
}
