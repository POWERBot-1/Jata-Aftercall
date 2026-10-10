"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AI_BUSINESS_TEMPLATES, starterForTemplate, type BusinessTemplate } from "@/lib/ai-templates";
import { composePublicPaymentText, PREVIEW_TEST_QUESTIONS, type PublicPaymentDetails } from "@/lib/ai-grounding";
import type { DeliveryZoneRule } from "@/lib/ai-config";
import { toBusinessLocalInput } from "@/lib/sale-pricing";

function readableStoredHours(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
  } catch {
    return raw;
  }
  return raw;
}

type AIConfigFormProps = {
  businessId: string;
  businessSlug?: string;
};

type CatalogueDraft = {
  id?: string;
  kind: "product" | "service";
  name: string;
  category: string;
  description: string;
  price: string;
  unit: string;
  variations: string;
  stockStatus: string;
  quantity: string;
  minQty: string;
  maxQty: string;
  promoPrice: string;
  /** Sale window, Africa/Nairobi local input (datetime-local). The sale runs only between these. */
  promoStart: string;
  promoEnd: string;
  active: boolean;
  instructions: string;
};

type FaqDraft = { question: string; approvedAnswer: string };

const STEPS = [
  "Business Profile",
  "Products & Services",
  "Pricing & Stock",
  "Delivery Zones & Fees",
  "Payment Instructions",
  "Policies & FAQs",
  "Notification Number",
  "Preview & Ask My Bot",
  "Readiness Verification",
  "Subscribe & Publish Live",
] as const;

const EMPTY_ITEM: CatalogueDraft = {
  kind: "product",
  name: "",
  category: "",
  description: "",
  price: "",
  unit: "",
  variations: "",
  stockStatus: "IN_STOCK",
  quantity: "",
  minQty: "1",
  maxQty: "",
  promoPrice: "",
  promoStart: "",
  promoEnd: "",
  active: true,
  instructions: "",
};

function money(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Math.round(Number(value));
  return Number.isFinite(amount) ? Math.max(0, amount) : null;
}

export default function AIConfigForm({ businessId, businessSlug }: AIConfigFormProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [templateCategory, setTemplateCategory] = useState("Retail & General Store");
  const [starterNote, setStarterNote] = useState("Selecting a template only suggests questions. JATA will not invent prices or delivery areas.");

  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [openingHours, setOpeningHours] = useState("");
  const [languageBehavior, setLanguageBehavior] = useState("English + Swahili");
  const [toneOfVoice, setToneOfVoice] = useState("Friendly");
  const [branchName, setBranchName] = useState("");
  const [branchLocation, setBranchLocation] = useState("");

  const [operationalStatus, setOperationalStatus] = useState<"LIVE" | "PAUSED" | "MAINTENANCE">("LIVE");
  const [pauseAllOrdering, setPauseAllOrdering] = useState(false);
  const [pausedMessage, setPausedMessage] = useState("");
  const [greetingMessage, setGreetingMessage] = useState("");
  const [fallbackMessage, setFallbackMessage] = useState("I don't have that information yet. Let me connect you with the business.");
  const [afterHoursMessage, setAfterHoursMessage] = useState("");
  const [escalationRules, setEscalationRules] = useState("");
  const [orderingAllowed, setOrderingAllowed] = useState(true);
  const [bookingsAllowed, setBookingsAllowed] = useState(false);
  const [preordersAllowed, setPreordersAllowed] = useState(false);
  const [walkInsAccepted, setWalkInsAccepted] = useState<boolean | null>(null);
  const [preparationTime, setPreparationTime] = useState("");
  const [fulfilmentProcedure, setFulfilmentProcedure] = useState("");
  const [modificationRules, setModificationRules] = useState("");
  const [outOfStockBehavior, setOutOfStockBehavior] = useState("state_fact");
  const [afterHoursBehavior, setAfterHoursBehavior] = useState("message_only");

  const [items, setItems] = useState<CatalogueDraft[]>([]);
  const [draft, setDraft] = useState<CatalogueDraft>(EMPTY_ITEM);
  const [bulkProduct, setBulkProduct] = useState("");
  const [bulkMin, setBulkMin] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkPricing, setBulkPricing] = useState<Array<{ productName: string; minQuantity: number; unitPriceKES: number }>>([]);

  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZoneRule[]>([]);
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneFee, setNewZoneFee] = useState("");
  const [newZoneEta, setNewZoneEta] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");

  const [payment, setPayment] = useState<PublicPaymentDetails>({});
  const [notificationPhone, setNotificationPhone] = useState("");
  const [notificationLabel, setNotificationLabel] = useState("PRIMARY");

  const [refundPolicy, setRefundPolicy] = useState("");
  const [cancellationPolicy, setCancellationPolicy] = useState("");
  const [exchangePolicy, setExchangePolicy] = useState("");
  const [creditPolicy, setCreditPolicy] = useState("");
  const [minimumOrder, setMinimumOrder] = useState("");
  const [bulkRules, setBulkRules] = useState("");
  const [deliveryConditions, setDeliveryConditions] = useState("");
  const [bookingConditions, setBookingConditions] = useState("");
  const [preorderConditions, setPreorderConditions] = useState("");
  const [faqs, setFaqs] = useState<FaqDraft[]>([]);
  const [faqQuestion, setFaqQuestion] = useState("");
  const [faqAnswer, setFaqAnswer] = useState("");

  const [readiness, setReadiness] = useState<{
    ready: boolean;
    canPublish: boolean;
    detailedChecks?: Array<{ id: string; label: string; passed: boolean; detail: string }>;
    missingItems?: string[];
  } | null>(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState<{ status: string; entitled: boolean; planPriceKES?: number } | null>(null);

  const [previewQuestion, setPreviewQuestion] = useState("");
  const [previewConversation, setPreviewConversation] = useState<string | null>(null);
  const [previewMessages, setPreviewMessages] = useState<Array<{ role: "customer" | "assistant"; text: string }>>([]);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    Promise.all([
      fetch(`/api/ai/config?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/ai/brain?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/products?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/business`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/merchant-payment?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/notification-recipients?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/ai/readiness?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/ai/entitlement?businessId=${businessId}`).then((r) => r.json()).catch(() => ({})),
    ]).then(([cfgData, brainData, productData, businessData, payData, notifData, readyData, entData]) => {
      const c = cfgData?.config || {};
      const ext = cfgData?.extendedConfig || {};
      const business = (businessData?.businesses || []).find((item: { id: string }) => item.id === businessId) || brainData?.businessProfile || {};
      setBusinessName(business.name || "");
      setCategory(business.category || "");
      setLocation(business.location || "");
      setPhone(business.phone || "");
      setWhatsapp(business.whatsapp || "");
      setOpeningHours(readableStoredHours(business.openingHours));
      setToneOfVoice(c.toneOfVoice || ext.toneOfVoice || "Friendly");
      setGreetingMessage(c.greetingMessage || ext.greetingMessage || "");
      setFallbackMessage(c.fallbackMessage || ext.fallbackMessage || "I don't have that information yet. Let me connect you with the business.");
      setLanguageBehavior(c.languageBehavior || ext.languageBehavior || "English + Swahili");
      setAfterHoursMessage(c.afterHoursMessage || ext.afterHoursMessage || "");
      setEscalationRules(c.escalationRules || ext.escalationRules || "");
      setOrderingAllowed(ext.orderingAllowed !== undefined ? Boolean(ext.orderingAllowed) : true);
      setBookingsAllowed(Boolean(ext.bookingsAllowed));
      setPreordersAllowed(Boolean(ext.preordersAllowed));
      setWalkInsAccepted(typeof ext.walkInsAccepted === "boolean" ? ext.walkInsAccepted : null);
      setPreparationTime(ext.preparationTime || "");
      setFulfilmentProcedure(ext.fulfilmentProcedure || "");
      setModificationRules(ext.modificationRules || "");
      setOutOfStockBehavior(ext.outOfStockBehavior || "state_fact");
      setAfterHoursBehavior(ext.afterHoursBehavior || "message_only");
      setPausedMessage(ext.pausedMessage || "");
      if (ext.templateCategory) setTemplateCategory(ext.templateCategory);
      if (ext.operationalStatus === "PAUSED" || ext.operationalStatus === "MAINTENANCE" || ext.operationalStatus === "LIVE") {
        setOperationalStatus(ext.operationalStatus);
      }
      setPauseAllOrdering(Boolean(ext.pauseAllOrdering));
      if (Array.isArray(ext.bulkPricing)) setBulkPricing(ext.bulkPricing);
      if (ext.paymentDetails) setPayment(ext.paymentDetails);
      if (ext.delivery) {
        setPickupEnabled(ext.delivery.pickupEnabled !== false);
        setDeliveryEnabled(Boolean(ext.delivery.deliveryEnabled));
        setDeliveryZones(Array.isArray(ext.delivery.zones) ? ext.delivery.zones : []);
        setDeliveryInstructions(ext.delivery.deliveryInstructions || "");
      }
      if (ext.policies) {
        setRefundPolicy(ext.policies.refundPolicy || "");
        setCancellationPolicy(ext.policies.cancellationPolicy || "");
        setExchangePolicy(ext.policies.exchangePolicy || ext.policies.returnPolicy || "");
        setCreditPolicy(ext.policies.creditPolicy || "");
        setMinimumOrder(ext.policies.minimumOrderKES ? String(ext.policies.minimumOrderKES) : "");
        setBulkRules(ext.policies.bulkOrderRules || "");
        setDeliveryConditions(ext.policies.deliveryConditions || "");
        setBookingConditions(ext.policies.bookingConditions || ext.policies.bookingRules || "");
        setPreorderConditions(ext.policies.preorderConditions || "");
      }
      if (Array.isArray(ext.branches) && ext.branches[0]) {
        setBranchName(ext.branches[0].name || "");
        setBranchLocation(ext.branches[0].location || "");
      }
      const loadedProducts = Array.isArray(productData?.products) ? productData.products : brainData?.products || [];
      const loadedServices = Array.isArray(brainData?.services) ? brainData.services : [];
      setItems([
        ...loadedProducts.map((product: Record<string, unknown>) => ({
          id: String(product.id),
          kind: "product" as const,
          name: String(product.name || ""),
          category: String(product.category || ""),
          description: String(product.description || ""),
          price: product.basePriceKES != null ? String(product.basePriceKES) : "",
          unit: String(product.portionSize || ""),
          variations: "",
          stockStatus: String(product.stockStatus || "IN_STOCK"),
          quantity: product.quantity != null ? String(product.quantity) : "",
          minQty: product.minOrder != null ? String(product.minOrder) : "1",
          maxQty: product.maxOrder != null ? String(product.maxOrder) : "",
          promoPrice: product.salePriceKES != null ? String(product.salePriceKES) : "",
          promoStart: toBusinessLocalInput(product.salePriceStartsAt ? new Date(String(product.salePriceStartsAt)) : null),
          promoEnd: toBusinessLocalInput(product.salePriceEndsAt ? new Date(String(product.salePriceEndsAt)) : null),
          active: product.isActive !== false,
          instructions: "",
        })),
        ...loadedServices.map((service: Record<string, unknown>) => ({
          id: String(service.id),
          kind: "service" as const,
          name: String(service.title || ""),
          category: "",
          description: String(service.description || ""),
          price: service.priceFrom != null ? String(service.priceFrom) : "",
          unit: "",
          variations: "",
          stockStatus: "IN_STOCK",
          quantity: "",
          minQty: "1",
          maxQty: "",
          promoPrice: "",
          promoStart: "",
          promoEnd: "",
          active: service.isActive !== false,
          instructions: "",
        })),
      ]);
      if (Array.isArray(brainData?.faqs)) {
        setFaqs(brainData.faqs.map((faq: FaqDraft) => ({ question: faq.question, approvedAnswer: faq.approvedAnswer })));
      }
      if (payData?.config?.publicInfo && !ext.paymentDetails?.otherInstructions) {
        setPayment((prev) => ({ ...prev, otherInstructions: prev.otherInstructions || payData.config.publicInfo }));
      }
      if (Array.isArray(notifData?.recipients) && notifData.recipients[0]) {
        setNotificationPhone(notifData.recipients[0].phone || "");
        setNotificationLabel(notifData.recipients[0].label || "PRIMARY");
      }
      if (readyData && typeof readyData.ready === "boolean") setReadiness(readyData);
      if (entData?.entitlement) {
        setSubscriptionInfo({
          status: entData.entitlement.status,
          entitled: Boolean(entData.entitlement.entitled),
          planPriceKES: entData.plan?.priceKes,
        });
      }
    });
  }, [businessId]);

  function applyBusinessTemplate(template: BusinessTemplate) {
    const starter = starterForTemplate(template);
    setTemplateCategory(template.label);
    setToneOfVoice(template.defaultTone);
    setGreetingMessage(template.welcomeMessage);
    setOrderingAllowed(starter.ordersAccepted);
    setBookingsAllowed(starter.bookingsAccepted);
    setPreordersAllowed(starter.preordersAccepted);
    setWalkInsAccepted(starter.walkInsAccepted);
    setDeliveryEnabled(template.deliveryMode !== "PICKUP");
    setPickupEnabled(template.deliveryMode !== "DELIVERY");
    setEscalationRules((current) => current || starter.escalationHint);
    setStarterNote(`${template.label} only suggests the questionnaire. Add your own products, prices, zones and rules. ${starter.fulfilmentHint}`);
    if (starter.questionPrompts.length && faqs.length === 0) {
      setFaqs(starter.questionPrompts.map((question) => ({ question, approvedAnswer: "" })));
    }
  }

  async function saveBrain() {
    const publicInfo = composePublicPaymentText(payment);
    const configRes = await fetch("/api/ai/config", {
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
        orderingAllowed,
        bookingsAllowed,
        preordersAllowed,
        templateCategory,
        operationalStatus,
        pauseAllOrdering,
        pausedMessage,
        walkInsAccepted,
        preparationTime,
        fulfilmentProcedure,
        modificationRules,
        outOfStockBehavior,
        afterHoursBehavior,
        branches: branchName.trim() ? [{ name: branchName.trim(), location: branchLocation.trim() || null }] : [],
        bulkPricing,
        paymentDetails: payment,
        delivery: {
          pickupEnabled,
          deliveryEnabled,
          zones: deliveryZones,
          deliveryInstructions: deliveryInstructions || null,
        },
        policies: {
          refundPolicy: refundPolicy || null,
          cancellationPolicy: cancellationPolicy || null,
          exchangePolicy: exchangePolicy || null,
          returnPolicy: exchangePolicy || null,
          creditPolicy: creditPolicy || null,
          minimumOrderKES: minimumOrder ? Number(minimumOrder) : null,
          bulkOrderRules: bulkRules || null,
          deliveryConditions: deliveryConditions || null,
          bookingConditions: bookingConditions || null,
          preorderConditions: preorderConditions || null,
        },
        faqs: faqs.filter((faq) => faq.question.trim() && faq.approvedAnswer.trim()),
      }),
    });
    if (!configRes.ok) throw new Error("Save failed.");
    if (businessName.trim()) {
      await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          name: businessName,
          category,
          location,
          phone,
          whatsapp,
          openingHours: openingHours || null,
        }),
      });
    }
    if (publicInfo) {
      await fetch("/api/merchant-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, publicInfo }),
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
    if (readyRes && typeof readyRes.ready === "boolean") setReadiness(readyRes);
  }

  async function saveItem(item: CatalogueDraft) {
    if (item.name.trim().length < 2) return;
    const variations = item.variations
      .split(",")
      .map((part) => {
        const [label, price] = part.split(":");
        return label?.trim() ? { label: label.trim(), priceKES: money(price || "") } : null;
      })
      .filter(Boolean);
    if (item.kind === "service") {
      await fetch("/api/services", {
        method: item.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          businessId,
          title: item.name,
          description: [item.description, item.instructions].filter(Boolean).join(" "),
          priceFrom: money(item.price),
          isActive: item.active,
        }),
      });
      return;
    }
    await fetch("/api/products", {
      method: item.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        businessId,
        name: item.name,
        category: item.category,
        description: [item.description, item.instructions].filter(Boolean).join(" "),
        portionSize: item.unit || null,
        basePriceKES: money(item.price),
        salePriceKES: money(item.promoPrice),
        salePriceStartsAt: item.promoStart.trim() || null,
        salePriceEndsAt: item.promoEnd.trim() || null,
        stockStatus: item.quantity.trim() || item.stockStatus ? item.stockStatus : undefined,
        quantity: item.quantity.trim() ? Number(item.quantity) : null,
        minOrder: Number(item.minQty) || 1,
        maxOrder: item.maxQty.trim() ? Number(item.maxQty) : null,
        isActive: item.active,
        variants: variations,
      }),
    });
  }

  async function handleSave(event?: React.FormEvent) {
    event?.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      if (draft.name.trim()) {
        await saveItem(draft);
        setItems((prev) => [...prev.filter((item) => item.name.toLowerCase() !== draft.name.toLowerCase()), draft]);
        setDraft(EMPTY_ITEM);
      }
      await saveBrain();
      setStatusMsg("Saved. JATA will answer from this Business Brain, not from generic guesses.");
    } catch {
      setStatusMsg("Could not save. Check the required answers and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function askPreview(question: string) {
    const text = question.trim();
    if (!text) return;
    setPreviewing(true);
    setPreviewMessages((prev) => [...prev, { role: "customer", text }]);
    setPreviewQuestion("");
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          message: text,
          conversationId: previewConversation,
          preview: true,
          mode: "ask_my_bot",
        }),
      });
      const data = await res.json();
      if (data.conversationId) setPreviewConversation(data.conversationId);
      setPreviewMessages((prev) => [...prev, { role: "assistant", text: data.reply || data.error || "No reply." }]);
    } catch {
      setPreviewMessages((prev) => [...prev, { role: "assistant", text: "Preview could not reach the Business Brain." }]);
    } finally {
      setPreviewing(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setStatusMsg(null);
    try {
      await saveBrain();
      const res = await fetch("/api/ai/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error || "Cannot publish yet. Finish the missing checks and subscribe.");
        if (data.readiness) setReadiness(data.readiness);
        return;
      }
      setStatusMsg(`Published live. Shareable AI link: ${data.sharePath}`);
      if (data.readiness) setReadiness(data.readiness);
    } catch {
      setStatusMsg("Failed to publish AI Front Desk.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5 rounded-xl border bg-slate-900 p-4 text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tell JATA how your business works</h2>
          <p className="text-xs text-slate-300">
            Answer in plain language. JATA turns the answers into this business&apos;s front desk. It will not invent prices, stock, delivery fees or payment details.
          </p>
        </div>
        <div className="flex gap-2">
          {businessSlug && (
            <Link href={`/b/${businessSlug}/ai?preview=true`} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
              Preview AI Front Desk
            </Link>
          )}
          <Link href={`/dashboard/ai?businessId=${businessId}`} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium">
            Open AI Dashboard
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(index)}
            className={`rounded-full px-3 py-1 text-xs ${step === index ? "bg-emerald-600 text-white" : "border border-slate-700 text-slate-200"}`}
          >
            {index + 1}. {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <p className="text-xs font-semibold">One-click starter — configuration accelerator, not an answer</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.values(AI_BUSINESS_TEMPLATES).map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => applyBusinessTemplate(template)}
              className={`rounded-full px-3 py-1 text-xs ${templateCategory === template.label ? "bg-emerald-600 text-white" : "border border-slate-700"}`}
            >
              {template.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">{starterNote}</p>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 sm:grid-cols-2">
        <label className="text-xs">
          Operational status
          <select value={operationalStatus} onChange={(e) => setOperationalStatus(e.target.value as "LIVE" | "PAUSED" | "MAINTENANCE")} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm">
            <option value="LIVE">LIVE — Active & Answering</option>
            <option value="PAUSED">PAUSED — Temporarily Paused</option>
            <option value="MAINTENANCE">MAINTENANCE — Human Handoff Only</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-amber-300">
          <input type="checkbox" checked={pauseAllOrdering} onChange={(e) => setPauseAllOrdering(e.target.checked)} />
          PAUSE ALL ORDERING
        </label>
      </div>

      {step === 0 && (
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name" value={businessName} onChange={setBusinessName} />
          <Field label="What kind of business is this?" value={category} onChange={setCategory} />
          <Field label="Where are you located?" value={location} onChange={setLocation} />
          <Field label="Customer phone" value={phone} onChange={setPhone} />
          <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />
          <Field label="When are you open?" value={openingHours} onChange={setOpeningHours} placeholder="Mon–Sat 08:00–18:00" />
          <Field label="Branch name, if you have one" value={branchName} onChange={setBranchName} />
          <Field label="Branch location" value={branchLocation} onChange={setBranchLocation} />
          <label className="text-xs">
            Preferred language
            <select value={languageBehavior} onChange={(e) => setLanguageBehavior(e.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2">
              <option>English</option>
              <option>Swahili</option>
              <option>English + Swahili</option>
            </select>
          </label>
          <label className="text-xs">
            Tone of voice
            <select value={toneOfVoice} onChange={(e) => setToneOfVoice(e.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2">
              <option>Friendly</option>
              <option>Formal</option>
              <option>Direct</option>
              <option>Warm</option>
              <option>Premium</option>
            </select>
          </label>
          <label className="text-xs sm:col-span-2">
            Greeting
            <textarea value={greetingMessage} onChange={(e) => setGreetingMessage(e.target.value)} rows={2} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2" />
          </label>
        </section>
      )}

      {(step === 1 || step === 2) && (
        <section className="space-y-3">
          <p className="text-xs text-slate-300">
            {step === 1
              ? "Add what you sell. Each price is a record JATA can quote. Do not leave the price blank if customers can order it."
              : "Set the price, unit, stock and any bulk price. If stock is unknown, leave quantity blank — JATA will not claim the item is in stock."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
            <Field label="Category" value={draft.category} onChange={(value) => setDraft({ ...draft, category: value })} />
            <Field label="Original price (KES)" value={draft.price} onChange={(value) => setDraft({ ...draft, price: value })} />
            <Field label="Unit" value={draft.unit} onChange={(value) => setDraft({ ...draft, unit: value })} placeholder="bag, plate, session" />
            <Field label="Variations (Label:price, Label:price)" value={draft.variations} onChange={(value) => setDraft({ ...draft, variations: value })} />
            <label className="text-xs">
              Stock status
              <select value={draft.stockStatus} onChange={(e) => setDraft({ ...draft, stockStatus: e.target.value })} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2">
                <option value="IN_STOCK">In stock</option>
                <option value="LOW_STOCK">Low stock</option>
                <option value="OUT_OF_STOCK">Out of stock</option>
                <option value="PRE_ORDER">Pre-order</option>
                <option value="AVAILABLE_ON_REQUEST">Available on request</option>
              </select>
            </label>
            <Field label="Quantity on hand" value={draft.quantity} onChange={(value) => setDraft({ ...draft, quantity: value })} />
            <Field label="Minimum quantity" value={draft.minQty} onChange={(value) => setDraft({ ...draft, minQty: value })} />
            <Field label="Maximum quantity" value={draft.maxQty} onChange={(value) => setDraft({ ...draft, maxQty: value })} />
            <Field label="Sale price (KES, optional)" value={draft.promoPrice} onChange={(value) => setDraft({ ...draft, promoPrice: value })} />
            <label className="block text-xs">
              Sale starts (Africa/Nairobi)
              <input type="datetime-local" value={draft.promoStart} onChange={(event) => setDraft({ ...draft, promoStart: event.target.value })} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
            </label>
            <label className="block text-xs">
              Sale ends (Africa/Nairobi)
              <input type="datetime-local" value={draft.promoEnd} onChange={(event) => setDraft({ ...draft, promoEnd: event.target.value })} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
            </label>
            <Field label="Special instructions" value={draft.instructions} onChange={(value) => setDraft({ ...draft, instructions: value })} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Active
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.kind === "service"} onChange={(e) => setDraft({ ...draft, kind: e.target.checked ? "service" : "product" })} />
              This is a service, not a product
            </label>
          </div>
          <button type="button" onClick={() => { setItems((prev) => [...prev, draft]); setDraft(EMPTY_ITEM); }} className="rounded bg-slate-700 px-3 py-1.5 text-xs">
            Add to list
          </button>
          <ul className="space-y-1 text-xs">
            {items.map((item) => (
              <li key={`${item.kind}-${item.name}`} className="flex justify-between rounded border border-slate-800 px-2 py-1">
                <span>{item.name}{item.price ? ` — KES ${item.price}${item.unit ? `/${item.unit}` : ""}` : " — price not set"}</span>
                <span className="text-slate-400">{item.stockStatus}{item.quantity ? ` · ${item.quantity}` : ""}</span>
              </li>
            ))}
          </ul>
          {step === 2 && (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Bulk item" value={bulkProduct} onChange={setBulkProduct} />
              <Field label="From quantity" value={bulkMin} onChange={setBulkMin} />
              <Field label="Bulk unit price" value={bulkPrice} onChange={setBulkPrice} />
              <button
                type="button"
                className="self-end rounded bg-slate-700 px-3 py-2 text-xs"
                onClick={() => {
                  if (!bulkProduct.trim() || Number(bulkMin) < 2) return;
                  setBulkPricing((prev) => [...prev, { productName: bulkProduct.trim(), minQuantity: Number(bulkMin), unitPriceKES: Number(bulkPrice) || 0 }]);
                  setBulkProduct("");
                  setBulkMin("");
                  setBulkPrice("");
                }}
              >
                Add bulk price
              </button>
            </div>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="space-y-3">
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={pickupEnabled} onChange={(e) => setPickupEnabled(e.target.checked)} /> Walk-in / pickup</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} /> Delivery</label>
          </div>
          {deliveryEnabled && (
            <>
              <div className="flex flex-wrap gap-2">
                <input value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} placeholder="Your zone name" className="flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
                <input value={newZoneFee} onChange={(e) => setNewZoneFee(e.target.value)} placeholder="Fee KES" className="w-24 rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
                <input value={newZoneEta} onChange={(e) => setNewZoneEta(e.target.value)} placeholder="Expected time" className="w-36 rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
                <button
                  type="button"
                  className="rounded bg-emerald-600 px-3 text-xs"
                  onClick={() => {
                    if (!newZoneName.trim()) return;
                    setDeliveryZones((prev) => [...prev.filter((zone) => zone.name.toLowerCase() !== newZoneName.trim().toLowerCase()), { name: newZoneName.trim(), feeKES: Math.max(0, Math.round(Number(newZoneFee) || 0)), estimatedTime: newZoneEta.trim() || undefined }]);
                    setNewZoneName("");
                    setNewZoneFee("");
                    setNewZoneEta("");
                  }}
                >
                  Add zone
                </button>
              </div>
              <ul className="text-xs">
                {deliveryZones.map((zone) => (
                  <li key={zone.name}>{zone.name}: KES {zone.feeKES}{zone.estimatedTime ? ` · ${zone.estimatedTime}` : " · time not set"}</li>
                ))}
              </ul>
            </>
          )}
          <Field label="How is an order fulfilled?" value={fulfilmentProcedure} onChange={setFulfilmentProcedure} />
          <Field label="Delivery instructions" value={deliveryInstructions} onChange={setDeliveryInstructions} />
          <Field label="Usual preparation time" value={preparationTime} onChange={setPreparationTime} />
        </section>
      )}

      {step === 4 && (
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="M-Pesa Till" value={payment.mpesaTill || ""} onChange={(value) => setPayment({ ...payment, mpesaTill: value })} />
          <Field label="Paybill" value={payment.paybill || ""} onChange={(value) => setPayment({ ...payment, paybill: value })} />
          <Field label="Paybill account" value={payment.paybillAccount || ""} onChange={(value) => setPayment({ ...payment, paybillAccount: value })} />
          <Field label="Pochi" value={payment.pochi || ""} onChange={(value) => setPayment({ ...payment, pochi: value })} />
          <Field label="Bank name" value={payment.bankName || ""} onChange={(value) => setPayment({ ...payment, bankName: value })} />
          <Field label="Bank account" value={payment.bankAccount || ""} onChange={(value) => setPayment({ ...payment, bankAccount: value })} />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(payment.cash)} onChange={(e) => setPayment({ ...payment, cash: e.target.checked })} /> Cash</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(payment.cashOnDelivery)} onChange={(e) => setPayment({ ...payment, cashOnDelivery: e.target.checked })} /> Cash on delivery</label>
          <Field label="Deposit requirement" value={payment.depositRequirements || ""} onChange={(value) => setPayment({ ...payment, depositRequirements: value })} />
          <p className="text-xs text-slate-400 sm:col-span-2">Only public customer instructions are saved. API keys, passwords and secrets are removed and never shown to customers.</p>
        </section>
      )}

      {step === 5 && (
        <section className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={orderingAllowed} onChange={(e) => setOrderingAllowed(e.target.checked)} /> Accept orders</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={bookingsAllowed} onChange={(e) => setBookingsAllowed(e.target.checked)} /> Accept bookings</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={preordersAllowed} onChange={(e) => setPreordersAllowed(e.target.checked)} /> Accept pre-orders</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={walkInsAccepted === true} onChange={(e) => setWalkInsAccepted(e.target.checked)} /> Accept walk-ins</label>
          <Field label="Refund policy" value={refundPolicy} onChange={setRefundPolicy} />
          <Field label="Cancellation policy" value={cancellationPolicy} onChange={setCancellationPolicy} />
          <Field label="Exchange policy" value={exchangePolicy} onChange={setExchangePolicy} />
          <Field label="Credit policy" value={creditPolicy} onChange={setCreditPolicy} />
          <Field label="Minimum order (KES)" value={minimumOrder} onChange={setMinimumOrder} />
          <Field label="Bulk-order rules" value={bulkRules} onChange={setBulkRules} />
          <Field label="Delivery conditions" value={deliveryConditions} onChange={setDeliveryConditions} />
          <Field label="Booking conditions" value={bookingConditions} onChange={setBookingConditions} />
          <Field label="Pre-order conditions" value={preorderConditions} onChange={setPreorderConditions} />
          <Field label="Can customers change an order?" value={modificationRules} onChange={setModificationRules} />
          <label className="text-xs">
            If an item is out of stock
            <select value={outOfStockBehavior} onChange={(e) => setOutOfStockBehavior(e.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2">
              <option value="state_fact">Tell the customer the stock fact</option>
              <option value="offer_preorder">Offer a pre-order if enabled</option>
              <option value="offer_alternative">Offer another configured item</option>
              <option value="handoff">Call a person</option>
            </select>
          </label>
          <label className="text-xs">
            When you are closed
            <select value={afterHoursBehavior} onChange={(e) => setAfterHoursBehavior(e.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2">
              <option value="message_only">Send the after-hours message</option>
              <option value="accept_enquiries">Keep answering questions</option>
              <option value="handoff">Call a person</option>
            </select>
          </label>
          <Field label="After-hours message" value={afterHoursMessage} onChange={setAfterHoursMessage} />
          <Field label="Paused message" value={pausedMessage} onChange={setPausedMessage} />
          <label className="text-xs sm:col-span-2">
            When should JATA call a person?
            <textarea value={escalationRules} onChange={(e) => setEscalationRules(e.target.value)} rows={2} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2" placeholder="Complaints, refunds, missing information, large orders, payment problems." />
          </label>
          <label className="text-xs sm:col-span-2">
            If JATA does not know
            <textarea value={fallbackMessage} onChange={(e) => setFallbackMessage(e.target.value)} rows={2} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2" />
          </label>
          <div className="sm:col-span-2 space-y-2">
            <div className="flex gap-2">
              <input value={faqQuestion} onChange={(e) => setFaqQuestion(e.target.value)} placeholder="Question customers ask" className="flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
              <input value={faqAnswer} onChange={(e) => setFaqAnswer(e.target.value)} placeholder="Your approved answer" className="flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
              <button type="button" className="rounded bg-slate-700 px-3 text-xs" onClick={() => { if (faqQuestion.trim() && faqAnswer.trim()) { setFaqs((prev) => [...prev, { question: faqQuestion.trim(), approvedAnswer: faqAnswer.trim() }]); setFaqQuestion(""); setFaqAnswer(""); } }}>Add FAQ</button>
            </div>
            {faqs.filter((faq) => faq.approvedAnswer).map((faq) => <p key={faq.question} className="text-xs text-slate-300">{faq.question}</p>)}
          </div>
        </section>
      )}

      {step === 6 && (
        <section className="flex gap-2">
          <select value={notificationLabel} onChange={(e) => setNotificationLabel(e.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2 text-xs">
            <option>PRIMARY</option>
            <option>SECONDARY</option>
            <option>OWNER</option>
            <option>STAFF</option>
          </select>
          <input value={notificationPhone} onChange={(e) => setNotificationPhone(e.target.value)} placeholder="Number that receives new orders, bookings and handoffs" className="flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
        </section>
      )}

      {step === 7 && (
        <section className="space-y-3">
          <p className="text-xs text-slate-300">Ask as a customer. This uses the saved Business Brain for this business only. Save first if you just changed prices or zones.</p>
          <div className="flex flex-wrap gap-2">
            {PREVIEW_TEST_QUESTIONS.map((question) => (
              <button key={question} type="button" onClick={() => askPreview(question)} className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs text-emerald-200">{question}</button>
            ))}
          </div>
          <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3 text-sm">
            {previewMessages.length === 0 && <p className="text-xs text-slate-400">No preview yet.</p>}
            {previewMessages.map((message, index) => (
              <p key={`${message.role}-${index}`} className={message.role === "customer" ? "text-emerald-200" : "text-slate-100"}>
                <strong>{message.role === "customer" ? "Customer" : "JATA"}:</strong> {message.text}
              </p>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={previewQuestion} onChange={(e) => setPreviewQuestion(e.target.value)} placeholder="Ask a realistic customer question" className="flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
            <button type="button" disabled={previewing} onClick={() => askPreview(previewQuestion)} className="rounded bg-emerald-600 px-3 text-sm">{previewing ? "Asking..." : "Ask"}</button>
          </div>
        </section>
      )}

      {step === 8 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{readiness?.ready ? "Ready to subscribe and publish" : "Not ready yet"}</h3>
          <ul className="space-y-1 text-xs">
            {(readiness?.detailedChecks || []).map((check) => (
              <li key={check.id} className={check.passed ? "text-emerald-300" : "text-amber-300"}>
                {check.passed ? "Ready" : "Missing"} — {check.label}. {check.detail}
              </li>
            ))}
          </ul>
          {!readiness && <p className="text-xs text-slate-400">Save the questionnaire to run readiness verification.</p>}
        </section>
      )}

      {step === 9 && (
        <section className="space-y-3 text-sm">
          <p>AI Business Front Desk is <strong>KES 499/month</strong>. Configure, preview, verify, subscribe, then publish. An unpaid configuration cannot go live.</p>
          <p className="text-xs text-slate-300">Subscription status: {subscriptionInfo?.status || "not loaded"}{subscriptionInfo?.entitled ? " · entitled" : " · not entitled"}</p>
          <Link href={`/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`} className="inline-block rounded bg-indigo-600 px-3 py-2 text-xs font-semibold">
            Subscribe — KES 499/month
          </Link>
          <button type="button" onClick={handlePublish} disabled={publishing} className="ml-2 rounded bg-emerald-600 px-3 py-2 text-xs font-semibold disabled:opacity-50">
            {publishing ? "Publishing..." : "Verify & Publish Live"}
          </button>
        </section>
      )}

      {statusMsg && <p className="text-sm text-emerald-300">{statusMsg}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-4 py-2 text-sm disabled:opacity-50">{saving ? "Saving..." : "Save this step"}</button>
        {step < STEPS.length - 1 && (
          <button type="button" onClick={() => setStep((current) => current + 1)} className="rounded border border-slate-600 px-4 py-2 text-sm">Next</button>
        )}
      </div>
    </form>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block text-xs">
      {label}
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
    </label>
  );
}
