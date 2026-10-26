"use client";

/**
 * The AI Front Desk, as one guided job rather than an administration panel.
 *
 * Five steps, always in the same order — welcome, business information, customer responses,
 * private preview, publish — with every step reachable at any time and no form data lost when the
 * owner moves between them (all state lives in this one component).
 *
 * Two rules the UI obeys:
 *   1. Nothing here decides whether the Front Desk is live. `publication` always comes from the
 *      server (`lib/ai-publication.ts`: published + activated + server-verified entitlement), and
 *      the LIVE label only renders when the server says `state === "LIVE"` — after a publish
 *      response, never optimistically.
 *   2. Every button performs a real request. No fabricated confirmation, no invented prices, no
 *      invented testimonials: the copy only names capabilities the business actually configured.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bot,
  CheckCircle2,
  Clock,
  CreditCard,
  ImagePlus,
  Loader2,
  Lock,
  MapPin,
  MessageSquare,
  Phone,
  PlayCircle,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Store,
  Wallet,
} from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import { WorkspacePhotoImage } from "@/components/workspace/WorkspaceUI";
import { categoryLabel, photoForCategory, type WorkspacePhoto } from "@/lib/workspaceImagery";
import { aiFrontDeskStatusLabel } from "@/lib/statusLabels";
import { formatDate, formatKES } from "@/lib/format";

export type PublicationSummary = {
  state: "DRAFT" | "PREVIEW" | "LIVE" | "PAUSED" | "MAINTENANCE" | "SUSPENDED";
  publiclyOperational: boolean;
  isPublished: boolean;
  operationalStatus: string;
  entitled: boolean;
  entitlementStatus: string;
  reason: string;
};

export type EntitlementSummary = {
  status: string;
  entitled: boolean;
  reason: string;
  priceKES?: number;
  currency?: string;
  billingCycleDays?: number;
  expiresAt?: string | null;
  graceUntil?: string | null;
};

export type ReadinessSummary = {
  ready: boolean;
  canPublish: boolean;
  missingItems: string[];
  checks: Array<{ id: string; label: string; passed: boolean; detail: string }>;
};

export type ProfileSummary = {
  name: string;
  category: string;
  description: string;
  location: string;
  phone: string;
  whatsapp: string;
  openingHours: string;
};

export type ResponseSummary = {
  greetingMessage: string;
  fallbackMessage: string;
  toneOfVoice: string;
  languageBehavior: string;
  orderingAllowed: boolean;
  bookingsAllowed: boolean;
  preordersAllowed: boolean;
  escalationRules: string;
  afterHoursMessage: string;
};

export type CatalogueSummary = {
  products: Array<{ id: string; name: string; priceKES?: number | null; stockStatus?: string }>;
  services: Array<{ id: string; title: string; priceFrom?: number | null }>;
  zones: Array<{ name: string; feeKES: number }>;
  faqCount: number;
};

type StepId = "welcome" | "business" | "responses" | "preview" | "publish";

const STEPS: Array<{ id: StepId; short: string; title: string; blurb: string }> = [
  { id: "welcome", short: "Welcome", title: "What your front desk does", blurb: "One minute to understand the job." },
  { id: "business", short: "Business", title: "Your business information", blurb: "We reuse what you already saved." },
  { id: "responses", short: "Answers", title: "How it answers customers", blurb: "Plain-English settings." },
  { id: "preview", short: "Preview", title: "Preview and test", blurb: "Private — nobody else can see it." },
  { id: "publish", short: "Publish", title: "Publish to customers", blurb: "Needs a verified subscription." },
];

const TONES = [
  { value: "Friendly", label: "Friendly", hint: "Warm and conversational, like your best shop assistant." },
  { value: "Professional", label: "Professional", hint: "Measured and precise, good for clinics and offices." },
  { value: "Casual", label: "Casual", hint: "Relaxed street language, good for salons and food." },
  { value: "Formal", label: "Formal", hint: "Full sentences and formal Kiswahili/Swahili greeting forms." },
] as const;

const LANGUAGES = [
  { value: "English + Swahili", label: "English + Kiswahili", hint: "Answers in whichever language the customer writes in." },
  { value: "English", label: "English only", hint: "Every answer stays in English." },
  { value: "Swahili", label: "Kiswahili only", hint: "Every answer stays in Kiswahili." },
] as const;

/** Questions built from the tenant's own saved catalogue — never a fixed script of invented facts. */
export function representativeQuestions(catalogue: CatalogueSummary): string[] {
  const questions: string[] = [];
  const firstProduct = catalogue.products.find((product) => product.name);
  if (firstProduct) questions.push(`How much is ${firstProduct.name}?`);
  const firstService = catalogue.services.find((service) => service.title);
  if (firstService) questions.push(`Tell me about ${firstService.title}`);
  if (catalogue.zones.length > 0) {
    questions.push(`How much is delivery to ${catalogue.zones[0].name}?`);
    questions.push("How long does delivery take?");
  }
  questions.push("Are you open now?");
  if (catalogue.products.length > 0) questions.push("I want to order");
  if (catalogue.faqCount > 0) questions.push("What do other customers ask you?");
  questions.push("I want to speak to someone");
  return Array.from(new Set(questions)).slice(0, 6);
}

/**
 * Money and dates go through the shared formatters: they pin the locale and the Africa/Nairobi
 * zone, which keeps server and client markup identical (no hydration mismatch) and keeps every
 * amount in the same shape as the rest of the product.
 */
function money(amount: number | null | undefined, currency = "KES") {
  if (typeof amount !== "number") return null;
  if (currency !== "KES") return `${currency} ${amount}`;
  return formatKES(amount);
}

function fieldError(profile: ProfileSummary): Partial<Record<keyof ProfileSummary, string>> {
  const errors: Partial<Record<keyof ProfileSummary, string>> = {};
  if (profile.name.trim().length < 2) errors.name = "Use the name customers know you by (at least 2 characters).";
  if (!profile.category.trim()) errors.category = "Pick the category that best matches your business.";
  if (!profile.phone.trim() && !profile.whatsapp.trim() && !profile.location.trim()) {
    errors.phone = "Add a phone number, a WhatsApp number, or your location so customers can reach you.";
  }
  return errors;
}

export default function AIFrontDeskWorkspace({
  businessId,
  businessSlug,
  initialProfile,
  initialResponses,
  initialCatalogue,
  initialPublication,
  initialEntitlement,
  initialReadiness,
  plan,
}: {
  businessId: string;
  businessSlug: string;
  initialProfile: ProfileSummary;
  initialResponses: ResponseSummary;
  initialCatalogue: CatalogueSummary;
  initialPublication: PublicationSummary;
  initialEntitlement: EntitlementSummary;
  initialReadiness: ReadinessSummary;
  plan: { name: string; priceKES: number; durationDays: number } | null;
}) {
  const [step, setStep] = useState<StepId>("welcome");
  const [profile, setProfile] = useState<ProfileSummary>(initialProfile);
  const [responses, setResponses] = useState<ResponseSummary>(initialResponses);
  const [catalogue, setCatalogue] = useState<CatalogueSummary>(initialCatalogue);
  const [publication, setPublication] = useState<PublicationSummary>(initialPublication);
  const [entitlement, setEntitlement] = useState<EntitlementSummary>(initialEntitlement);
  const [readiness, setReadiness] = useState<ReadinessSummary>(initialReadiness);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingResponses, setSavingResponses] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // True when the last status/billing refresh never reached the server. Distinguishing this from
  // "not subscribed" matters: one is retryable, the other needs a payment.
  const [statusUnreachable, setStatusUnreachable] = useState(false);

  const [profileNotice, setProfileNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [responseNotice, setResponseNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [publishNotice, setPublishNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [draftQuestion, setDraftQuestion] = useState("");
  const [testTurns, setTestTurns] = useState<Array<{ role: "owner" | "desk"; text: string; missing?: string[] }>>([]);
  const [testing, setTesting] = useState(false);
  const [hasTested, setHasTested] = useState(false);

  const stepRefs = useRef<Record<StepId, HTMLDivElement | null>>({
    welcome: null,
    business: null,
    responses: null,
    preview: null,
    publish: null,
  });

  const profileErrors = fieldError(profile);
  const profileComplete = Object.keys(profileErrors).length === 0;
  const statusLabel = aiFrontDeskStatusLabel(publication.state);
  const questions = useMemo(() => representativeQuestions(catalogue), [catalogue]);
  const photo: WorkspacePhoto = useMemo(() => photoForCategory(profile.category), [profile.category]);

  const missingChecks = readiness.checks.filter((check) => !check.passed);
  // The billing service answering "unknown" is not the same as "not subscribed": we cannot tell
  // whether this business paid, so nothing may be published or reported as live (fail closed).
  const billingUnavailable =
    statusUnreachable || publication.entitlementStatus === "UNKNOWN" || entitlement.status === "UNKNOWN";
  // Which of the eleven UI states the owner is actually in, from server facts only.
  const setupStage: "NOT_CONFIGURED" | "DRAFT_SAVED" | "PREVIEW_READY" | "ELIGIBLE" | "LIVE" =
    publication.state === "LIVE" || publication.state === "PAUSED" || publication.state === "MAINTENANCE"
      ? "LIVE"
      : !readiness.ready && missingChecks.length === readiness.checks.length
        ? "NOT_CONFIGURED"
        : hasTested
          ? "PREVIEW_READY"
          : readiness.canPublish
            ? "ELIGIBLE"
            : "DRAFT_SAVED";
  // Publication eligibility is the server's answer, not the local form's: both the subscription
  // and the derived publication must agree before the publish button is enabled.
  const subscriptionRequired = !entitlement.entitled || !publication.entitled;
  const planPrice = money(plan?.priceKES ?? entitlement.priceKES, entitlement.currency || "KES");
  const subscribeHref = `/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`;
  const checkoutHref = `/checkout?businessId=${encodeURIComponent(businessId)}`;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [statusRes, readinessRes, entitlementRes] = await Promise.all([
        fetch(`/api/ai/status?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" }),
        fetch(`/api/ai/readiness?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" }),
        fetch(`/api/ai/entitlement?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" }),
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        if (data.publication) setPublication(data.publication as PublicationSummary);
        if (data.operationalStatus) {
          setPublication((prev) => ({ ...prev, operationalStatus: data.operationalStatus }));
        }
      }
      if (readinessRes.ok) {
        const data = await readinessRes.json();
        setReadiness({
          ready: Boolean(data.ready),
          canPublish: Boolean(data.canPublish),
          missingItems: Array.isArray(data.missingItems) ? data.missingItems : [],
          checks: Array.isArray(data.detailedChecks) ? data.detailedChecks : [],
        });
      }
      if (entitlementRes.ok) {
        const data = await entitlementRes.json();
        if (data.entitlement) setEntitlement(data.entitlement as EntitlementSummary);
      }
      setStatusUnreachable(false);
    } catch {
      // Keep the last server truth we have, but say out loud that it is the last known one.
      setStatusUnreachable(true);
    } finally {
      setRefreshing(false);
    }
  }, [businessId]);

  // Deep links ("/dashboard/ai#publish") open the requested step. Deferred to a task so the first
  // paint is the server-rendered "welcome" step — no hydration mismatch and no cascade on mount.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const hash = window.location.hash.replace("#", "");
      if (STEPS.some((entry) => entry.id === hash)) setStep(hash as StepId);
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  const goToStep = useCallback((next: StepId) => {
    setStep(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${next}`);
      window.requestAnimationFrame(() => {
        stepRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setProfileNotice(null);
    if (!profileComplete) {
      setProfileNotice({ tone: "error", text: "Fix the highlighted fields, then save again." });
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          name: profile.name,
          category: profile.category,
          description: profile.description || null,
          location: profile.location || null,
          phone: profile.phone || null,
          whatsapp: profile.whatsapp || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfileNotice({ tone: "error", text: data.error || "We could not save your business details. Please try again." });
        return;
      }
      setProfileNotice({ tone: "success", text: "Business details saved. Your front desk will use them immediately." });
      await refresh();
    } catch {
      setProfileNotice({ tone: "error", text: "No connection. Your changes are still on this page — try again when you are back online." });
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveResponses(event: React.FormEvent) {
    event.preventDefault();
    setResponseNotice(null);
    setSavingResponses(true);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          greetingMessage: responses.greetingMessage,
          fallbackMessage: responses.fallbackMessage,
          toneOfVoice: responses.toneOfVoice,
          languageBehavior: responses.languageBehavior,
          orderingAllowed: responses.orderingAllowed,
          bookingsAllowed: responses.bookingsAllowed,
          preordersAllowed: responses.preordersAllowed,
          escalationRules: responses.escalationRules,
          afterHoursMessage: responses.afterHoursMessage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResponseNotice({
          tone: "error",
          text: data.error || "We could not save these settings. Please try again.",
        });
        return;
      }
      setResponseNotice({ tone: "success", text: "Saved as a draft. Customers see these answers after you publish." });
      await refresh();
    } catch {
      setResponseNotice({ tone: "error", text: "No connection. Your settings are still on this page — try again." });
    } finally {
      setSavingResponses(false);
    }
  }

  async function askDesk(question: string) {
    const text = question.trim();
    if (!text || testing) return;
    setTesting(true);
    setTestTurns((prev) => [...prev, { role: "owner", text }]);
    setDraftQuestion("");
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          message: text,
          preview: true,
          mode: "ask_my_bot",
        }),
      });
      const data = await res.json().catch(() => ({}));
      const missing: string[] = Array.isArray(data?.diagnostics?.missingInformation)
        ? data.diagnostics.missingInformation.slice(0, 3)
        : [];
      setTestTurns((prev) => [
        ...prev,
        {
          role: "desk",
          text:
            data.reply ||
            data.error ||
            "The front desk could not answer that. Add the detail to your business information and try again.",
          missing,
        },
      ]);
      setHasTested(true);
    } catch {
      setTestTurns((prev) => [
        ...prev,
        { role: "desk", text: "No connection, so the test could not run. Try again when you are back online." },
      ]);
    } finally {
      setTesting(false);
    }
  }

  async function publish() {
    setPublishNotice(null);
    if (billingUnavailable) {
      setPublishNotice({
        tone: "error",
        text: "We could not confirm your subscription just now, so nothing was published. Check your connection and press Refresh.",
      });
      return;
    }
    if (!entitlement.entitled) {
      setPublishNotice({
        tone: "error",
        text: "Publishing needs an active AI Business Front Desk subscription. Choose the plan, then come back here.",
      });
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch("/api/ai/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Show the real server reason and the next action — never a fake success.
        const reason =
          data.error ||
          (Array.isArray(data?.readiness?.missingItems) && data.readiness.missingItems.length
            ? `Still missing: ${data.readiness.missingItems.join(" ")}`
            : "Publication failed. Nothing was changed — please try again.");
        setPublishNotice({ tone: "error", text: reason });
        await refresh();
        return;
      }
      setPublishNotice({
        tone: "success",
        text: `Published. Customers can now reach your front desk at ${data.sharePath || `/b/${businessSlug}/ai`}.`,
      });
      // Re-read the derived state from the server; the LIVE label appears only if it comes back LIVE.
      await refresh();
    } catch {
      setPublishNotice({ tone: "error", text: "No connection, so nothing was published. Try again when you are back online." });
    } finally {
      setPublishing(false);
    }
  }

  async function switchOperational(next: "LIVE" | "PAUSED") {
    setPublishNotice(null);
    setStatusBusy(true);
    try {
      const res = await fetch("/api/ai/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, operationalStatus: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPublishNotice({
          tone: "error",
          text: data.error || "That change was not applied.",
        });
        return;
      }
      setPublishNotice({
        tone: "success",
        text:
          next === "LIVE"
            ? "Front desk switched back on."
            : "Front desk paused. Customers are handed to a person until you switch it back on.",
      });
      await refresh();
    } catch {
      setPublishNotice({ tone: "error", text: "No connection, so nothing changed." });
    } finally {
      setStatusBusy(false);
    }
  }

  const completed: Record<StepId, boolean> = {
    welcome: true,
    business: profileComplete,
    responses: Boolean(responses.greetingMessage.trim() && responses.fallbackMessage.trim() && responses.escalationRules.trim()),
    preview: hasTested,
    publish: publication.state === "LIVE" || publication.state === "PAUSED" || publication.state === "MAINTENANCE",
  };

  const currentIndex = STEPS.findIndex((entry) => entry.id === step);
  const nextStep: StepId | null = STEPS[currentIndex + 1]?.id ?? null;
  const previousStep: StepId | null = STEPS[currentIndex - 1]?.id ?? null;

  return (
    <div className="ws-stack">
      {/* ---------- Progress rail ---------- */}
      <nav
        aria-label="AI Front Desk setup steps"
        className="ws-panel"
      >
        <ol className="flex snap-x gap-2 overflow-x-auto p-3 sm:p-4" style={{ listStyle: "none", margin: 0 }}>
          {STEPS.map((entry, index) => {
            const active = entry.id === step;
            const done = completed[entry.id] && !active;
            return (
              <li key={entry.id} className="min-w-0 flex-1 snap-start">
                <button
                  type="button"
                  onClick={() => goToStep(entry.id)}
                  aria-current={active ? "step" : undefined}
                  className="flex w-full items-start gap-2 rounded-[var(--ws-radius-md)] border px-2.5 py-2 text-left transition"
                  style={{
                    borderColor: active ? "var(--ws-ink)" : "var(--ws-line)",
                    background: active ? "var(--ws-ink)" : "var(--ws-paper)",
                    color: active ? "var(--ws-on-ink)" : "var(--ws-text)",
                    minHeight: "2.75rem",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                    style={{
                      background: active ? "var(--ws-amber)" : done ? "var(--ws-jade-soft)" : "var(--ws-cream-2)",
                      color: active ? "#1a140d" : done ? "var(--ws-jade)" : "var(--ws-muted)",
                    }}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold">{entry.short}</span>
                    <span
                      className="hidden text-[11px] sm:block"
                      style={{ color: active ? "rgba(247,242,232,0.74)" : "var(--ws-muted)" }}
                    >
                      {done ? "Done" : entry.blurb}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ---------- Status strip ---------- */}
      <section
        aria-label="Front desk status"
        className="ws-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={statusLabel.tone} icon={<Radio size={12} aria-hidden="true" />}>
                {statusLabel.label}
              </StatusPill>
              <StatusPill
                tone={
                  setupStage === "LIVE"
                    ? "success"
                    : setupStage === "ELIGIBLE" || setupStage === "PREVIEW_READY"
                      ? "info"
                      : "neutral"
                }
              >
                {setupStage === "NOT_CONFIGURED"
                  ? "Not set up yet"
                  : setupStage === "DRAFT_SAVED"
                    ? "Draft saved"
                    : setupStage === "PREVIEW_READY"
                      ? "Private preview ready"
                      : setupStage === "ELIGIBLE"
                        ? "Ready to publish"
                        : "Set up"}
              </StatusPill>
              <StatusPill tone={entitlement.entitled ? "success" : "warning"}>
                {entitlement.entitled
                  ? `Subscription: ${entitlement.status.toLowerCase().replace(/_/g, " ")}`
                  : entitlement.status === "PENDING"
                    ? "Subscription: payment not confirmed"
                    : "Subscription: not active"}
              </StatusPill>
              {publication.state === "SUSPENDED" ? (
                <StatusPill tone="danger" icon={<ShieldAlert size={12} aria-hidden="true" />}>
                  Not serving customers
                </StatusPill>
              ) : null}
            </div>
            <p className="ws-small ws-muted mt-1.5 max-w-2xl">{publication.reason}</p>
            {statusLabel.help ? <p className="ws-tiny ws-muted mt-0.5">{statusLabel.help}</p> : null}
            {entitlement.entitled && entitlement.expiresAt ? (
              <p className="ws-tiny ws-muted mt-1">
                Covered until {formatDate(entitlement.expiresAt)}
                {entitlement.billingCycleDays ? ` · ${entitlement.billingCycleDays}-day cycle` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {publication.state === "LIVE" ? (
              <>
                <Link href={`/b/${businessSlug}/ai`} className="jata-btn jata-btn-secondary jata-btn-sm" target="_blank" rel="noopener noreferrer">
                  Open customer view
                </Link>
                <button
                  type="button"
                  onClick={() => switchOperational("PAUSED")}
                  disabled={statusBusy}
                  aria-busy={statusBusy}
                  className="jata-btn jata-btn-ghost jata-btn-sm"
                >
                  {statusBusy ? "Pausing…" : "Pause front desk"}
                </button>
              </>
            ) : null}
            {publication.state === "PAUSED" || publication.state === "MAINTENANCE" ? (
              <button
                type="button"
                onClick={() => switchOperational("LIVE")}
                disabled={statusBusy}
                aria-busy={statusBusy}
                className="jata-btn jata-btn-primary jata-btn-sm"
              >
                {statusBusy ? "Switching on…" : "Switch back on"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-busy={refreshing}
              className="jata-btn jata-btn-ghost jata-btn-sm"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
              <span className="ml-1">{refreshing ? "Checking…" : "Refresh"}</span>
            </button>
          </div>
        </div>
      </section>

      {billingUnavailable ? (
        <section
          role="status"
          aria-live="polite"
          className="ws-panel"
          style={{ borderColor: "rgba(180,83,9,0.4)", background: "var(--ws-amber-soft)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold" style={{ color: "var(--ws-amber-deep)" }}>
                <ShieldAlert size={15} aria-hidden="true" /> We could not confirm your subscription
              </p>
              <p className="ws-small mt-1 max-w-2xl" style={{ color: "var(--ws-text)" }}>
                Our billing service did not answer, so we cannot tell whether this front desk is
                paid for. Nothing was published or switched on, and customers keep seeing exactly
                what they saw before. Your setup is safe — press refresh to check again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-busy={refreshing}
              className="jata-btn jata-btn-secondary jata-btn-sm"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
              <span className="ml-1">{refreshing ? "Checking…" : "Try again"}</span>
            </button>
          </div>
        </section>
      ) : null}

      {/* ---------- Step 1: Welcome ---------- */}
      <div ref={(el) => { stepRefs.current.welcome = el; }} id="welcome" aria-hidden={step !== "welcome"} hidden={step !== "welcome"}>
        <section className="ws-panel ws-panel--flush">
          <div className="grid gap-0 md:grid-cols-[1.15fr_0.85fr]">
            <div className="p-5 sm:p-6">
              <p className="ws-kicker">AI Front Desk</p>
              <h2 className="mt-1.5 text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--ws-display)" }}>
                Your front desk answers customers, every hour, from your own information.
              </h2>
              <p className="ws-small ws-muted mt-3 max-w-prose">
                It replies to the questions Kenyan customers actually send — price, delivery,
                opening hours, how to order — using only what you save here. When it does not know
                something, it asks a person at your business to follow up instead of guessing.
              </p>

              <ul className="mt-4 grid gap-2">
                {[
                  { icon: <MessageSquare size={15} aria-hidden="true" />, text: "Answers price, stock, delivery and hours questions from your saved catalogue." },
                  { icon: <Clock size={15} aria-hidden="true" />, text: "Works after hours, and hands over to a human when it is unsure." },
                  { icon: <ShieldAlert size={15} aria-hidden="true" />, text: "Never invents prices, services or policies that you did not save." },
                ].map((row) => (
                  <li key={row.text} className="flex items-start gap-2 text-sm" style={{ color: "var(--ws-text)" }}>
                    <span className="mt-0.5" style={{ color: "var(--ws-amber-deep)" }}>{row.icon}</span>
                    <span>{row.text}</span>
                  </li>
                ))}
              </ul>

              <div
                className="mt-5 rounded-[var(--ws-radius-md)] border p-3.5"
                style={{ borderColor: "var(--ws-line)", background: "var(--ws-plan-tint)" }}
              >
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em]" style={{ color: "var(--ws-amber-deep)" }}>
                  <Lock size={13} aria-hidden="true" /> Before you can publish
                </p>
                <p className="ws-small mt-1" style={{ color: "var(--ws-text)" }}>
                  You can set everything up and preview it for free. Going live for customers needs
                  the {plan?.name || "AI Business Front Desk plan"}
                  {planPrice ? ` (${planPrice}${plan ? ` every ${plan.durationDays} days` : ""})` : ""}, and we
                  only treat it as paid after our server confirms the payment with the payment
                  provider.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href={subscribeHref} className="jata-btn jata-btn-secondary jata-btn-sm">
                    See the plan
                  </Link>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={() => goToStep("business")} className="jata-btn jata-btn-primary">
                  Set up AI Front Desk <ArrowRight size={15} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => goToStep("preview")} className="jata-btn jata-btn-ghost">
                  <PlayCircle size={15} aria-hidden="true" /> Try it with your data first
                </button>
              </div>
            </div>

            <div className="relative min-h-[15rem] overflow-hidden border-t md:border-l md:border-t-0" style={{ borderColor: "var(--ws-line)" }}>
              <WorkspacePhotoImage photo={photo} sizes="(min-width: 900px) 34vw, 100vw" className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div
                  className="rounded-[var(--ws-radius-md)] px-3 py-2 text-[11px] leading-relaxed"
                  style={{ background: "rgba(20,17,15,0.86)", color: "var(--ws-on-ink)" }}
                >
                  <span aria-hidden="true">🗣️ </span>
                  {categoryLabel(profile.category)} customers asking about price, delivery and
                  opening hours — answered from your saved information.
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ---------- Step 2: Business information ---------- */}
      <div ref={(el) => { stepRefs.current.business = el; }} id="business" aria-hidden={step !== "business"} hidden={step !== "business"}>
        <section className="ws-panel">
          <div className="ws-panel__head">
            <h2 className="ws-panel__title">Your business information</h2>
            <p className="ws-section-head__meta">Step 2 · prefilled from your account</p>
          </div>
          <div className="ws-panel__body">
            <p className="ws-small ws-muted mb-3">
              These are the facts your front desk may quote. We filled in what you already saved —
              change anything that is out of date. Nothing is invented on your behalf.
            </p>

            <form onSubmit={saveProfile} className="grid gap-3" noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="jata-field">
                  <label className="jata-label" htmlFor="fd-name">
                    Business name <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="fd-name"
                    className="jata-input w-full"
                    value={profile.name}
                    onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))}
                    aria-invalid={profileErrors.name ? true : undefined}
                    aria-describedby={profileErrors.name ? "fd-name-error" : "fd-name-hint"}
                    autoComplete="organization"
                    required
                  />
                  {profileErrors.name ? (
                    <p id="fd-name-error" role="alert" className="jata-error">
                      {profileErrors.name}
                    </p>
                  ) : (
                    <p id="fd-name-hint" className="jata-hint">Exactly as customers say it, e.g. “Savanna Bakery”.</p>
                  )}
                </div>

                <div className="jata-field">
                  <label className="jata-label" htmlFor="fd-category">
                    Category <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="fd-category"
                    className="jata-input w-full"
                    value={profile.category}
                    onChange={(event) => setProfile((prev) => ({ ...prev, category: event.target.value }))}
                    aria-invalid={profileErrors.category ? true : undefined}
                    aria-describedby={profileErrors.category ? "fd-category-error" : "fd-category-hint"}
                    required
                  />
                  {profileErrors.category ? (
                    <p id="fd-category-error" role="alert" className="jata-error">{profileErrors.category}</p>
                  ) : (
                    <p id="fd-category-hint" className="jata-hint">e.g. Bakery, Salon, Hardware, Clinic.</p>
                  )}
                </div>
              </div>

              <div className="jata-field">
                <label className="jata-label" htmlFor="fd-description">
                  What you sell or do <span className="ws-tiny ws-muted">(optional)</span>
                </label>
                <textarea
                  id="fd-description"
                  className="jata-input w-full"
                  rows={3}
                  value={profile.description}
                  onChange={(event) => setProfile((prev) => ({ ...prev, description: event.target.value }))}
                  aria-describedby="fd-description-hint"
                />
                <p id="fd-description-hint" className="jata-hint">
                  One or two sentences. Example: “Fresh cakes, bread and samosas baked daily in Kitengela. Orders from 9am.”
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="jata-field">
                  <label className="jata-label" htmlFor="fd-phone">
                    <Phone size={12} aria-hidden="true" className="mr-1 inline" /> Phone
                  </label>
                  <input
                    id="fd-phone"
                    type="tel"
                    className="jata-input w-full"
                    value={profile.phone}
                    onChange={(event) => setProfile((prev) => ({ ...prev, phone: event.target.value }))}
                    aria-invalid={profileErrors.phone ? true : undefined}
                    aria-describedby={profileErrors.phone ? "fd-contact-error" : undefined}
                    autoComplete="tel"
                    placeholder="0712 345 678"
                  />
                </div>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="fd-whatsapp">
                    <MessageSquare size={12} aria-hidden="true" className="mr-1 inline" /> WhatsApp
                  </label>
                  <input
                    id="fd-whatsapp"
                    type="tel"
                    className="jata-input w-full"
                    value={profile.whatsapp}
                    onChange={(event) => setProfile((prev) => ({ ...prev, whatsapp: event.target.value }))}
                    autoComplete="tel"
                    placeholder="0712 345 678"
                  />
                </div>
              </div>

              <div className="jata-field">
                <label className="jata-label" htmlFor="fd-location">
                  <MapPin size={12} aria-hidden="true" className="mr-1 inline" /> Location
                </label>
                <input
                  id="fd-location"
                  className="jata-input w-full"
                  value={profile.location}
                  onChange={(event) => setProfile((prev) => ({ ...prev, location: event.target.value }))}
                  placeholder="Kitengela, Kajiado"
                  aria-describedby={profileErrors.phone ? "fd-contact-error" : undefined}
                />
                {profileErrors.phone ? (
                  <p id="fd-contact-error" role="alert" className="jata-error">{profileErrors.phone}</p>
                ) : null}
              </div>

              {profile.openingHours ? (
                <div className="jata-field">
                  <span className="jata-label">
                    <Clock size={12} aria-hidden="true" className="mr-1 inline" /> Opening hours on file
                  </span>
                  <p className="ws-small" style={{ color: "var(--ws-text)" }}>{profile.openingHours}</p>
                  <p className="jata-hint">Change these in your business page settings; the front desk reads them from there.</p>
                </div>
              ) : (
                <p className="ws-tiny ws-muted">
                  No opening hours on file yet. Without them, the front desk will say it does not
                  know rather than guessing your hours.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="jata-btn jata-btn-primary" disabled={savingProfile} aria-busy={savingProfile}>
                  {savingProfile ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <BadgeCheck size={15} aria-hidden="true" />}
                  <span className="ml-1">{savingProfile ? "Saving…" : "Save business information"}</span>
                </button>
                <button type="button" onClick={() => goToStep("responses")} className="jata-btn jata-btn-ghost">
                  Next: how it answers <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
              {profileNotice ? (
                <p
                  role={profileNotice.tone === "error" ? "alert" : "status"}
                  className="rounded-[var(--ws-radius-sm)] border px-3 py-2 text-sm"
                  style={{
                    borderColor: profileNotice.tone === "error" ? "rgba(185,28,28,0.35)" : "rgba(15,118,110,0.35)",
                    background: profileNotice.tone === "error" ? "#fef2f2" : "var(--ws-jade-soft)",
                    color: profileNotice.tone === "error" ? "#991b1b" : "var(--ws-jade)",
                  }}
                >
                  {profileNotice.text}
                </p>
              ) : null}
            </form>
          </div>
        </section>
      </div>

      {/* ---------- Step 3: Customer response settings ---------- */}
      <div ref={(el) => { stepRefs.current.responses = el; }} id="responses" aria-hidden={step !== "responses"} hidden={step !== "responses"}>
        <section className="ws-panel">
          <div className="ws-panel__head">
            <h2 className="ws-panel__title">How it answers customers</h2>
            <p className="ws-section-head__meta">Step 3 · plain-English settings</p>
          </div>
          <div className="ws-panel__body">
            <form onSubmit={saveResponses} className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="jata-field">
                  <label className="jata-label" htmlFor="fd-tone">Tone of voice</label>
                  <select
                    id="fd-tone"
                    className="jata-input w-full"
                    value={
                      TONES.find((tone) => tone.value.toLowerCase() === responses.toneOfVoice.toLowerCase())?.value ||
                      responses.toneOfVoice
                    }
                    onChange={(event) => setResponses((prev) => ({ ...prev, toneOfVoice: event.target.value }))}
                  >
                    {TONES.map((tone) => (
                      <option key={tone.value} value={tone.value}>{tone.label}</option>
                    ))}
                    {!TONES.some((tone) => tone.value.toLowerCase() === responses.toneOfVoice.toLowerCase()) ? (
                      <option value={responses.toneOfVoice}>{responses.toneOfVoice}</option>
                    ) : null}
                  </select>
                  <p className="jata-hint">
                    {TONES.find((tone) => tone.value === responses.toneOfVoice)?.hint ||
                      "How the front desk sounds when it writes to customers."}
                  </p>
                </div>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="fd-language">Language</label>
                  <select
                    id="fd-language"
                    className="jata-input w-full"
                    value={responses.languageBehavior}
                    onChange={(event) => setResponses((prev) => ({ ...prev, languageBehavior: event.target.value }))}
                  >
                    {LANGUAGES.map((language) => (
                      <option key={language.value} value={language.value}>{language.label}</option>
                    ))}
                    {!LANGUAGES.some((language) => language.value === responses.languageBehavior) ? (
                      <option value={responses.languageBehavior}>{responses.languageBehavior}</option>
                    ) : null}
                  </select>
                  <p className="jata-hint">
                    {LANGUAGES.find((language) => language.value === responses.languageBehavior)?.hint ||
                      "The front desk mirrors the language the customer writes in."}
                  </p>
                </div>
              </div>

              <div className="jata-field">
                <label className="jata-label" htmlFor="fd-greeting">First message customers see</label>
                <textarea
                  id="fd-greeting"
                  className="jata-input w-full"
                  rows={2}
                  value={responses.greetingMessage}
                  onChange={(event) => setResponses((prev) => ({ ...prev, greetingMessage: event.target.value }))}
                  aria-describedby="fd-greeting-hint"
                />
                <p id="fd-greeting-hint" className="jata-hint">
                  Example: “Karibu {profile.name}! Ask me about prices, delivery or opening hours.”
                </p>
              </div>

              <fieldset
                className="rounded-[var(--ws-radius-md)] border p-3"
                style={{ borderColor: "var(--ws-line)", background: "var(--ws-wash)" }}
              >
                <legend className="px-1 text-sm font-bold">What the front desk may offer</legend>
                <p className="ws-tiny ws-muted mb-2">
                  These switches only expose capabilities you have configured. Turn one off and the
                  front desk will take a message instead of promising it.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    {
                      key: "orderingAllowed" as const,
                      label: "Take orders",
                      help: "Needs a price on your products.",
                      checked: responses.orderingAllowed,
                    },
                    {
                      key: "bookingsAllowed" as const,
                      label: "Take bookings",
                      help: "For salons, clinics and services.",
                      checked: responses.bookingsAllowed,
                    },
                    {
                      key: "preordersAllowed" as const,
                      label: "Allow pre-orders",
                      help: "Only when you sell out and restock.",
                      checked: responses.preordersAllowed,
                    },
                  ].map((toggle) => (
                    <label
                      key={toggle.key}
                      className="flex cursor-pointer items-start gap-2 rounded-[var(--ws-radius-sm)] border p-2.5"
                      style={{ borderColor: "var(--ws-line)", background: "var(--ws-paper)" }}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={toggle.checked}
                        onChange={(event) => setResponses((prev) => ({ ...prev, [toggle.key]: event.target.checked }))}
                      />
                      <span>
                        <span className="block text-sm font-semibold">{toggle.label}</span>
                        <span className="ws-tiny ws-muted">{toggle.help}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="jata-field">
                  <label className="jata-label" htmlFor="fd-escalation">
                    When should a person take over? <span aria-hidden="true">*</span>
                  </label>
                  <textarea
                    id="fd-escalation"
                    className="jata-input w-full"
                    rows={3}
                    value={responses.escalationRules}
                    onChange={(event) => setResponses((prev) => ({ ...prev, escalationRules: event.target.value }))}
                    aria-describedby="fd-escalation-hint"
                  />
                  <p id="fd-escalation-hint" className="jata-hint">
                    Example: “Any complaint, refund, discount request, or question about a custom
                    order should go to the owner on WhatsApp.”
                  </p>
                </div>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="fd-fallback">When it does not know the answer</label>
                  <textarea
                    id="fd-fallback"
                    className="jata-input w-full"
                    rows={3}
                    value={responses.fallbackMessage}
                    onChange={(event) => setResponses((prev) => ({ ...prev, fallbackMessage: event.target.value }))}
                    aria-describedby="fd-fallback-hint"
                  />
                  <p id="fd-fallback-hint" className="jata-hint">
                    The honest reply used instead of inventing an answer.
                  </p>
                </div>
              </div>

              <div className="jata-field">
                <label className="jata-label" htmlFor="fd-afterhours">
                  After-hours message <span className="ws-tiny ws-muted">(optional)</span>
                </label>
                <input
                  id="fd-afterhours"
                  className="jata-input w-full"
                  value={responses.afterHoursMessage}
                  onChange={(event) => setResponses((prev) => ({ ...prev, afterHoursMessage: event.target.value }))}
                  placeholder="We are closed now, but I can take your details and we will call you in the morning."
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="jata-btn jata-btn-primary" disabled={savingResponses} aria-busy={savingResponses}>
                  {savingResponses ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Bot size={15} aria-hidden="true" />}
                  <span className="ml-1">{savingResponses ? "Saving…" : "Save answer settings"}</span>
                </button>
                <button type="button" onClick={() => goToStep("preview")} className="jata-btn jata-btn-ghost">
                  Next: preview it <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
              {responseNotice ? (
                <p
                  role={responseNotice.tone === "error" ? "alert" : "status"}
                  className="rounded-[var(--ws-radius-sm)] border px-3 py-2 text-sm"
                  style={{
                    borderColor: responseNotice.tone === "error" ? "rgba(185,28,28,0.35)" : "rgba(15,118,110,0.35)",
                    background: responseNotice.tone === "error" ? "#fef2f2" : "var(--ws-jade-soft)",
                    color: responseNotice.tone === "error" ? "#991b1b" : "var(--ws-jade)",
                  }}
                >
                  {responseNotice.text}
                </p>
              ) : null}
            </form>
          </div>
        </section>
      </div>

      {/* ---------- Step 4: Preview and test ---------- */}
      <div ref={(el) => { stepRefs.current.preview = el; }} id="preview" aria-hidden={step !== "preview"} hidden={step !== "preview"}>
        <section className="ws-panel">
          <div className="ws-panel__head">
            <h2 className="ws-panel__title">Preview and test</h2>
            <p className="ws-section-head__meta">Step 4 · private to you</p>
          </div>
          <div className="ws-panel__body">
            <div
              className="mb-3 flex items-start gap-2 rounded-[var(--ws-radius-md)] border p-3"
              style={{ borderColor: "rgba(180,83,9,0.32)", background: "var(--ws-amber-soft)" }}
            >
              <Lock size={16} aria-hidden="true" style={{ color: "var(--ws-amber-deep)" }} />
              <p className="ws-small" style={{ color: "var(--ws-text)" }}>
                <strong>Private preview.</strong> Answers below are produced from your saved
                information for you only. No customer can reach this until the Front Desk is
                published, and no live order or charge is created here.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
              <div
                className="flex min-h-[18rem] flex-col overflow-hidden rounded-[var(--ws-radius-md)] border"
                style={{ borderColor: "var(--ws-line)", background: "var(--ws-paper)" }}
              >
                <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--ws-line)" }}>
                  <p className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: "var(--ws-muted)" }}>
                    Test conversation
                  </p>
                  <StatusPill tone="warning">Private preview</StatusPill>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "22rem" }}>
                  {testTurns.length === 0 ? (
                    <div className="grid h-full place-items-center text-center">
                      <div>
                        <Sparkles size={22} aria-hidden="true" style={{ color: "var(--ws-amber-deep)" }} />
                        <p className="ws-small ws-muted mt-2 max-w-xs">
                          Ask one of the questions on the right, or type your own. This is exactly
                          how the front desk will answer with the information you saved.
                        </p>
                      </div>
                    </div>
                  ) : (
                    testTurns.map((turn, index) => (
                      <div key={`${turn.role}-${index}`} className={`flex ${turn.role === "owner" ? "justify-end" : "justify-start"}`}>
                        <div
                          className="max-w-[85%] rounded-[var(--ws-radius-md)] px-3 py-2 text-sm"
                          style={
                            turn.role === "owner"
                              ? { background: "var(--ws-ink)", color: "var(--ws-on-ink)" }
                              : { background: "var(--ws-cream-2)", color: "var(--ws-text)" }
                          }
                        >
                          <p className="whitespace-pre-wrap leading-relaxed">{turn.text}</p>
                          {turn.missing && turn.missing.length > 0 ? (
                            <ul className="mt-1.5 space-y-0.5 text-[11px]" style={{ color: "var(--ws-amber-deep)" }}>
                              {turn.missing.map((item) => (
                                <li key={item}>Missing on your side: {item}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                  {testing ? (
                    <p role="status" className="ws-tiny ws-muted">Checking your saved information…</p>
                  ) : null}
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void askDesk(draftQuestion);
                  }}
                  className="flex gap-2 border-t p-2.5"
                  style={{ borderColor: "var(--ws-line)" }}
                >
                  <label className="sr-only" htmlFor="fd-test-question">Test question</label>
                  <input
                    id="fd-test-question"
                    className="jata-input w-full"
                    value={draftQuestion}
                    onChange={(event) => setDraftQuestion(event.target.value)}
                    placeholder="e.g. Do you deliver to Kitengela?"
                    autoComplete="off"
                  />
                  <button type="submit" className="jata-btn jata-btn-primary jata-btn-sm" disabled={testing || !draftQuestion.trim()}>
                    <Send size={14} aria-hidden="true" /> <span className="sr-only">Send test question</span>
                  </button>
                </form>
              </div>

              <div className="grid content-start gap-3">
                <div>
                  <p className="ws-kicker">Questions from your own data</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {questions.map((question) => (
                      <button
                        key={question}
                        type="button"
                        onClick={() => void askDesk(question)}
                        disabled={testing}
                        className="min-h-11 rounded-full border px-3.5 text-xs font-semibold transition disabled:opacity-50"
                        style={{ borderColor: "var(--ws-line)", background: "var(--ws-paper)", color: "var(--ws-text)" }}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                  {questions.length <= 1 ? (
                    <p className="ws-tiny ws-muted mt-2">
                      Add products, services and delivery zones to your business information and the
                      test questions become specific to what you sell.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-[var(--ws-radius-md)] border p-3" style={{ borderColor: "var(--ws-line)" }}>
                  <p className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: "var(--ws-muted)" }}>
                    What it knows right now
                  </p>
                  <ul className="ws-tiny mt-1.5 grid gap-1" style={{ color: "var(--ws-text)" }}>
                    <li>{catalogue.products.length} product{catalogue.products.length === 1 ? "" : "s"} with prices</li>
                    <li>{catalogue.services.length} service{catalogue.services.length === 1 ? "" : "s"}</li>
                    <li>{catalogue.zones.length} delivery zone{catalogue.zones.length === 1 ? "" : "s"}</li>
                    <li>{catalogue.faqCount} approved answer{catalogue.faqCount === 1 ? "" : "s"} to common questions</li>
                    <li>{profile.openingHours ? "Opening hours saved" : "No opening hours saved yet"}</li>
                  </ul>
                </div>

                <button type="button" onClick={() => goToStep("publish")} className="jata-btn jata-btn-secondary">
                  Next: publish <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ---------- Step 5: Publish ---------- */}
      <div ref={(el) => { stepRefs.current.publish = el; }} id="publish" aria-hidden={step !== "publish"} hidden={step !== "publish"}>
        <section className="ws-panel">
          <div className="ws-panel__head">
            <h2 className="ws-panel__title">Publish to customers</h2>
            <p className="ws-section-head__meta">Step 5 · publication and subscription</p>
          </div>
          <div className="ws-panel__body">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Subscription */}
              <div
                className="rounded-[var(--ws-radius-md)] border p-4"
                style={{
                  borderColor: entitlement.entitled ? "rgba(15,118,110,0.35)" : "rgba(180,83,9,0.35)",
                  background: entitlement.entitled ? "var(--ws-jade-soft)" : "var(--ws-amber-soft)",
                }}
              >
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  {entitlement.entitled ? <CheckCircle2 size={16} aria-hidden="true" /> : <Wallet size={16} aria-hidden="true" />}
                  Subscription and eligibility
                </p>
                <p className="ws-small mt-1" style={{ color: "var(--ws-text)" }}>
                  {entitlement.entitled
                    ? `Active ${plan?.name || "AI Business Front Desk"} plan${planPrice ? ` · ${planPrice}` : ""}. Verified on our server — you can publish.`
                    : entitlement.status === "PENDING"
                      ? "We have a payment record but it is not confirmed yet. Payment is only treated as paid after the provider confirms it — refresh in a moment."
                      : `Publishing needs the ${plan?.name || "AI Business Front Desk"} plan${planPrice ? ` (${planPrice}${plan ? ` / ${plan.durationDays} days` : ""})` : ""}. Setup and preview stay free.`}
                </p>
                {!entitlement.entitled ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link href={subscribeHref} className="jata-btn jata-btn-primary jata-btn-sm">
                      <CreditCard size={14} aria-hidden="true" /> Choose the plan
                    </Link>
                    <Link href={checkoutHref} className="jata-btn jata-btn-secondary jata-btn-sm">
                      Go to checkout
                    </Link>
                  </div>
                ) : null}
              </div>

              {/* Readiness */}
              <div className="rounded-[var(--ws-radius-md)] border p-4" style={{ borderColor: "var(--ws-line)", background: "var(--ws-paper)" }}>
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <Store size={16} aria-hidden="true" /> Before customers see it
                </p>
                {readiness.checks.length === 0 ? (
                  <p className="ws-small ws-muted mt-1">Checking your saved information…</p>
                ) : (
                  <>
                    <p className="ws-small mt-1" style={{ color: "var(--ws-text)" }}>
                      {missingChecks.length === 0
                        ? "Every readiness check passes. Publication promotes exactly what you see in the preview."
                        : `${missingChecks.length} item${missingChecks.length === 1 ? "" : "s"} still needed before publication can succeed.`}
                    </p>
                    <ul className="mt-2 grid gap-1.5">
                      {readiness.checks.map((check) => (
                        <li key={check.id} className="flex items-start gap-2 text-xs">
                          <span aria-hidden="true" style={{ color: check.passed ? "var(--ws-jade)" : "var(--ws-amber-deep)" }}>
                            {check.passed ? "✓" : "•"}
                          </span>
                          <span style={{ color: check.passed ? "var(--ws-muted)" : "var(--ws-text)" }}>
                            <span className="font-semibold">{check.label}</span>
                            {check.passed ? "" : ` — ${check.detail}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {missingChecks.length > 0 ? (
                      <Link href={`/onboarding/ai?businessId=${encodeURIComponent(businessId)}`} className="jata-btn jata-btn-ghost jata-btn-sm mt-2">
                        Open the detailed configuration <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void publish()}
                disabled={publishing || subscriptionRequired || !readiness.ready || billingUnavailable}
                aria-busy={publishing}
                className="jata-btn jata-btn-primary"
              >
                {publishing ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Radio size={15} aria-hidden="true" />}
                <span className="ml-1">
                  {publishing ? "Publishing…" : publication.state === "LIVE" ? "Publish latest changes" : "Publish AI Front Desk"}
                </span>
              </button>
              {publication.state === "LIVE" ? (
                <Link href={`/b/${businessSlug}/ai`} target="_blank" rel="noopener noreferrer" className="jata-btn jata-btn-secondary">
                  Open the live customer view
                </Link>
              ) : null}
              {!entitlement.entitled ? (
                <p className="ws-tiny ws-muted">
                  Publication stays disabled until the payment is verified on our server.
                </p>
              ) : !readiness.ready ? (
                <p className="ws-tiny ws-muted">
                  Finish the items above — publication refuses rather than publishing an incomplete
                  front desk.
                </p>
              ) : null}
            </div>

            {publishNotice ? (
              <p
                role={publishNotice.tone === "error" ? "alert" : "status"}
                className="mt-3 rounded-[var(--ws-radius-sm)] border px-3 py-2 text-sm"
                style={{
                  borderColor: publishNotice.tone === "error" ? "rgba(185,28,28,0.35)" : "rgba(15,118,110,0.35)",
                  background: publishNotice.tone === "error" ? "#fef2f2" : "var(--ws-jade-soft)",
                  color: publishNotice.tone === "error" ? "#991b1b" : "var(--ws-jade)",
                }}
              >
                {publishNotice.text}
              </p>
            ) : null}

            <div className="mt-4 rounded-[var(--ws-radius-md)] border p-3" style={{ borderColor: "var(--ws-line)", background: "var(--ws-wash)" }}>
              <p className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: "var(--ws-muted)" }}>
                What happens when you publish
              </p>
              <ul className="ws-small mt-1.5 grid gap-1" style={{ color: "var(--ws-text)" }}>
                <li>Customers reach your front desk at <code>/b/{businessSlug}/ai</code>, and the link appears on your business page.</li>
                <li>The answers you tested become the version customers get — paused or maintenance states still hand over to a person.</li>
                <li>If your subscription later lapses, the desk stops answering customers and this page says so instead of pretending it is live.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      {/* ---------- Step navigation ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {previousStep ? (
          <button type="button" onClick={() => goToStep(previousStep)} className="jata-btn jata-btn-ghost">
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {nextStep ? (
            <button type="button" onClick={() => goToStep(nextStep)} className="jata-btn jata-btn-secondary">
              Next: {STEPS.find((entry) => entry.id === nextStep)?.short} <ArrowRight size={15} aria-hidden="true" />
            </button>
          ) : null}
          <Link href="/dashboard" className="jata-btn jata-btn-ghost">Back to dashboard</Link>
        </div>
      </div>

      <p className="ws-tiny ws-muted flex items-center gap-1.5">
        <ImagePlus size={13} aria-hidden="true" />
        Photographs are illustrative of the business category — nothing here needs an upload before
        you can publish.
      </p>
    </div>
  );
}
