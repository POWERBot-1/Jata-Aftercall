"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  FileSpreadsheet,
  Mic,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  WorkspaceHero,
  WorkspacePanel,
  WorkspaceStat,
} from "@/components/workspace/WorkspaceUI";
import { WORKSPACE_HERO_PHOTO } from "@/lib/workspaceImagery";
import { formatKES } from "@/lib/format";

export interface AutopilotOverviewPayload {
  actorRole: string;
  globalKillSwitchActive: boolean;
  entitlement: {
    entitled: boolean;
    previewMode: boolean;
    tier: string;
    planKey: string;
    subscriptionStatus: string;
    entitlementStatus: string;
    expiresAt: string | null;
    daysRemaining: number | null;
    banner: {
      tone: string;
      headline: string;
      detail: string;
      ctaLabel: string | null;
    };
  };
  plans: Array<{
    id: string | null;
    key: string;
    tier: string;
    name: string;
    priceKES: number;
    durationDays: number;
    description: string;
  }>;
  config: {
    businessId: string;
    autonomyMode: "ASSISTED" | "SUPERVISED" | "ADVANCED";
    operationalStatus: "LIVE" | "PAUSED";
    industryPackKey: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    timezone: string;
    dailySpendCapMinorKES: number;
    maxBatchRecipients: number;
    maxAutoDiscountPct: number;
    voiceEnabled: boolean;
    version: number;
  };
  industryPacks: Array<{
    key: string;
    name: string;
    hasRegulatedGuardrail: boolean;
  }>;
  diagnosis: {
    businessId: string;
    businessName: string;
    category: string;
    industryPackKey: string;
    industryPackName: string;
    generatedAt: string;
    healthSummary: string;
    metrics: Array<{
      key: string;
      label: string;
      value: number | string | null;
      unit?: string;
      basis: "RECORDED" | "CALCULATED" | "ESTIMATE" | "MISSING_DATA";
      explanation: string;
    }>;
    findings: Array<{
      id: string;
      severity: string;
      title: string;
      summary: string;
      basis: string;
      evidence: string[];
      recommendedActionType?: string;
    }>;
    dataGaps: string[];
    suggestedProposals: Array<{
      actionType: string;
      riskCategory: string;
      title: string;
      rationale: string;
      expectedImpact: string;
      payload: Record<string, unknown>;
      idempotencyKey: string;
    }>;
  };
  proposals: Array<{
    id: string;
    actionType: string;
    riskCategory: string;
    status: string;
    title: string;
    rationale: string;
    expectedImpact: string | null;
    rollbackSupported: boolean;
    executedAt: string | null;
    rolledBackAt: string | null;
    lastError: string | null;
    createdAt: string;
  }>;
  usage: {
    periodKey: string;
    dayKey: string;
    tierKey: string;
    dailySpendMinorKES: number;
    dailySpendCapMinorKES: number;
    monthlySpendMinorKES: number;
    monthlySpendCapMinorKES: number;
    capabilityUsedThisMonth: Record<string, number>;
    capabilityLimits: Record<string, number>;
  };
  channels: Array<{
    channelKey: string;
    label: string;
    status: string;
    inboundCapable: boolean;
    outboundCapable: boolean;
    detail: string;
  }>;
  auditEvents: Array<{
    id: string;
    actorKind: string;
    action: string;
    createdAt: string;
    metadata: Record<string, unknown> | null;
  }>;
}

function basisTone(basis: string): string {
  if (basis === "RECORDED") return "success";
  if (basis === "CALCULATED") return "info";
  if (basis === "ESTIMATE") return "warning";
  return "neutral";
}

function proposalStatusTone(status: string): string {
  if (status === "EXECUTED") return "success";
  if (status === "PROPOSED" || status === "APPROVED") return "warning";
  if (status === "ROLLED_BACK") return "info";
  if (status === "FAILED" || status === "REJECTED") return "danger";
  return "neutral";
}

function channelStatusTone(status: string): string {
  if (status === "SUPPORTED AND VERIFIED") return "success";
  if (status === "IMPLEMENTED BUT NOT LIVE-VERIFIED") return "info";
  if (
    status === "REQUIRES CREDENTIALS OR OWNER AUTHORIZATION" ||
    status === "REQUIRES PROVIDER APPROVAL"
  ) {
    return "warning";
  }
  return "neutral";
}

export function AutopilotCommandCenter({
  businessId,
  initialData,
}: {
  businessId: string;
  initialData: AutopilotOverviewPayload;
}) {
  const [data, setData] = useState<AutopilotOverviewPayload>(initialData);
  const [busy, setBusy] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{
    tone: "info" | "error" | "success";
    text: string;
  } | null>(null);

  // Command center prompt + voice state
  const [commandInput, setCommandInput] = useState("");
  const [modality, setModality] = useState<"TEXT" | "VOICE_TRANSCRIPT">("TEXT");
  const [voiceConfirmed, setVoiceConfirmed] = useState(false);
  const [commandReply, setCommandReply] = useState<string | null>(null);

  // Multimodal ingestion state
  const [ingestFileName, setIngestFileName] = useState("price-list.csv");
  const [ingestMime, setIngestMime] = useState("text/csv");
  const [ingestText, setIngestText] = useState("");
  const [ingestResult, setIngestResult] = useState<any | null>(null);

  // Consent recorder state
  const [consentName, setConsentName] = useState("");
  const [consentPhone, setConsentPhone] = useState("");
  const [consentChannel, setConsentChannel] = useState<"WHATSAPP" | "SMS" | "EMAIL">("WHATSAPP");

  async function refreshOverview() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/autopilot/overview?businessId=${encodeURIComponent(businessId)}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      if (res.ok && json) {
        setData(json as AutopilotOverviewPayload);
      }
    } finally {
      setBusy(false);
    }
  }

  async function patchConfig(patch: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch("/api/autopilot/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, ...patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBannerNotice({
          tone: "error",
          text: json.error || "Could not update Autopilot settings.",
        });
        return;
      }
      setBannerNotice({ tone: "success", text: successMsg });
      await refreshOverview();
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout(planId: string | null, planName: string) {
    if (!planId) {
      setBannerNotice({
        tone: "error",
        text: `${planName} plan record is not seeded in this environment yet. Run database seed to enable live Paystack checkout.`,
      });
      return;
    }
    setBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, planId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.authorization_url) {
        setBannerNotice({
          tone: "error",
          text: json.error || "Checkout could not be started right now.",
        });
        return;
      }
      window.location.assign(String(json.authorization_url));
    } finally {
      setBusy(false);
    }
  }

  async function queueSuggestedProposal(
    candidate: AutopilotOverviewPayload["diagnosis"]["suggestedProposals"][number],
  ) {
    setBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch("/api/autopilot/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          actionType: candidate.actionType,
          title: candidate.title,
          rationale: candidate.rationale,
          expectedImpact: candidate.expectedImpact,
          payload: candidate.payload,
          idempotencyKey: candidate.idempotencyKey,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBannerNotice({
          tone: "error",
          text: json.error || "Proposal was blocked by policy.",
        });
        return;
      }
      setBannerNotice({
        tone: "success",
        text: json.duplicate
          ? "This proposal is already in your Approval Queue."
          : json.autoExecuted
            ? "Proposal passed policy checks and executed automatically."
            : "Proposal added to your Approval Queue for review.",
      });
      await refreshOverview();
    } finally {
      setBusy(false);
    }
  }

  async function runProposalOperation(
    proposalId: string,
    operation: "APPROVE_AND_EXECUTE" | "REJECT" | "ROLLBACK",
  ) {
    setBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch("/api/autopilot/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, proposalId, operation }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBannerNotice({
          tone: "error",
          text: json.error || `Could not perform ${operation}.`,
        });
        return;
      }
      const executedActionType = json.proposal?.actionType;
      setBannerNotice({
        tone: "success",
        text:
          operation === "APPROVE_AND_EXECUTE"
            ? executedActionType === "QUEUE_CONSENTED_FOLLOWUP"
              ? "Follow-up staged in outbox (PENDING — awaiting verified external messaging gateway dispatch). You can cancel it via Rollback before external delivery."
              : "Action verified and executed. You can roll it back with 1 click if needed."
            : operation === "ROLLBACK"
              ? "Action rolled back to its captured pre-execution snapshot."
              : "Proposal rejected.",
      });
      await refreshOverview();
    } finally {
      setBusy(false);
    }
  }

  async function submitOwnerCommand(e: React.FormEvent) {
    e.preventDefault();
    if (!commandInput.trim()) return;
    setBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch("/api/autopilot/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          message: commandInput,
          modality,
          voiceTranscriptConfirmed: voiceConfirmed,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.reply) setCommandReply(String(json.reply));
      if (!res.ok) {
        setBannerNotice({
          tone: "error",
          text: json.reply || json.error || "Command blocked by policy.",
        });
      } else {
        setCommandInput("");
        await refreshOverview();
      }
    } finally {
      setBusy(false);
    }
  }

  function startBrowserDictation() {
    setModality("VOICE_TRANSCRIPT");
    setVoiceConfirmed(false);
    const SpeechRec =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SpeechRec) {
      setBannerNotice({
        tone: "info",
        text: "Voice transcript mode selected. Type or paste your spoken brief below and check 'Confirm voice transcript' before running write commands.",
      });
      return;
    }
    const rec = new SpeechRec();
    rec.lang = "en-KE";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: any) => {
      const transcript = ev?.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setCommandInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    rec.start();
  }

  async function handleIngestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingestText.trim()) return;
    setBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch("/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          fileName: ingestFileName,
          mimeType: ingestMime,
          textContent: ingestText,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBannerNotice({
          tone: "error",
          text: json.error || "Could not ingest document.",
        });
        return;
      }
      setIngestResult(json.record);
      await refreshOverview();
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordConsent(e: React.FormEvent) {
    e.preventDefault();
    if (!consentPhone.trim()) return;
    setBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch("/api/autopilot/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          displayName: consentName,
          phone: consentPhone,
          channel: consentChannel,
          scope: "TRANSACTIONAL",
          status: "OPTED_IN",
          source: "COMMAND_CENTER_OWNER_ENTRY",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBannerNotice({
          tone: "error",
          text: json.error || "Could not save consent record.",
        });
        return;
      }
      setConsentName("");
      setConsentPhone("");
      setBannerNotice({
        tone: "success",
        text: "Customer transactional consent recorded.",
      });
      await refreshOverview();
    } finally {
      setBusy(false);
    }
  }

  const isPaused = data.config.operationalStatus === "PAUSED";
  const canConfigure = ["OWNER", "ADMIN", "MANAGER"].includes(data.actorRole);
  const canManageBilling = ["OWNER", "ADMIN"].includes(data.actorRole);
  const canManageConsent = ["OWNER", "ADMIN", "MANAGER", "STAFF"].includes(data.actorRole);
  const dailyKesSpent = (data.usage.dailySpendMinorKES / 100).toFixed(2);
  const dailyKesCap = (data.usage.dailySpendCapMinorKES / 100).toFixed(2);
  const monthlyKesSpent = (data.usage.monthlySpendMinorKES / 100).toFixed(2);
  const monthlyKesCap = (data.usage.monthlySpendCapMinorKES / 100).toFixed(2);

  return (
    <div className="ws-stack">
      <WorkspaceHero
        compact
        kicker={`JATA Autopilot · ${data.diagnosis.industryPackName}`}
        title={data.diagnosis.businessName}
        subtitle={data.diagnosis.healthSummary}
        photo={WORKSPACE_HERO_PHOTO}
        actions={
          <>
            <button
              type="button"
              aria-pressed={isPaused}
              disabled={busy || !canConfigure}
              onClick={() =>
                patchConfig(
                  { operationalStatus: isPaused ? "LIVE" : "PAUSED" },
                  isPaused
                    ? "JATA Autopilot resumed."
                    : "Emergency Pause activated — all autonomous proposals and executions are halted.",
                )
              }
              className={isPaused ? "ws-btn-amber" : "ws-btn-outline"}
            >
              {isPaused ? (
                <>
                  <PlayCircle size={16} aria-hidden="true" /> Resume Autopilot
                </>
              ) : (
                <>
                  <PauseCircle size={16} aria-hidden="true" /> Emergency Pause
                </>
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void refreshOverview()}
              className="ws-btn-outline"
            >
              <RefreshCw size={15} aria-hidden="true" /> Refresh diagnosis
            </button>
            <Link href="/dashboard/autopilot" className="ws-btn-outline">
              All businesses
            </Link>
          </>
        }
        meta={`Mode: ${data.config.autonomyMode} · Status: ${data.config.operationalStatus} · Role: ${data.actorRole} · Quiet hours: ${data.config.quietHoursStart}–${data.config.quietHoursEnd} ${data.config.timezone}`}
      />

      {data.globalKillSwitchActive ? (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          <strong>Platform Kill Switch Active:</strong> Autonomous executions are globally paused.
          Diagnostic metrics and historical audit logs remain available.
        </div>
      ) : null}

      {!canConfigure ? (
        <div
          role="status"
          className="rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] px-4 py-3 text-xs"
        >
          <strong>Read-only role ({data.actorRole}):</strong> You can inspect grounded diagnostics
          and audit trails, while governance updates, billing, and action approvals require a
          MANAGER, ADMIN, or OWNER role.
        </div>
      ) : null}

      {bannerNotice ? (
        <div
          role={bannerNotice.tone === "error" ? "alert" : "status"}
          aria-live={bannerNotice.tone === "error" ? "assertive" : "polite"}
          className="rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] px-4 py-3 text-sm"
        >
          <StatusPill
            tone={
              bannerNotice.tone === "error"
                ? "danger"
                : bannerNotice.tone === "success"
                  ? "success"
                  : "info"
            }
          >
            {bannerNotice.tone.toUpperCase()}
          </StatusPill>{" "}
          <span className="ml-2">{bannerNotice.text}</span>
        </div>
      ) : null}

      {/* Governance, Industry Pack & Budget Controls */}
      <WorkspacePanel
        title="Governance, Autonomy Mode & Spend Cap"
        meta={`Daily AI spend: KES ${dailyKesSpent} / KES ${dailyKesCap} · Monthly included ceiling: KES ${monthlyKesSpent} / KES ${monthlyKesCap}`}
        action={
          <StatusPill tone={isPaused ? "danger" : data.entitlement.entitled ? "success" : "warning"}>
            {isPaused
              ? "Paused"
              : data.entitlement.entitled
                ? `${data.entitlement.tier} Active`
                : "Preview Mode"}
          </StatusPill>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <label htmlFor="autopilot-autonomy-mode" className="block text-sm">
            <span className="font-semibold">Autonomy Mode</span>
            <select
              id="autopilot-autonomy-mode"
              className="jata-input mt-1 w-full"
              value={data.config.autonomyMode}
              disabled={busy || !canConfigure}
              onChange={(e) =>
                void patchConfig(
                  { autonomyMode: e.target.value },
                  `Autonomy mode updated to ${e.target.value}.`,
                )
              }
            >
              <option value="ASSISTED">Assisted (Draft &amp; Queue Only — Recommended)</option>
              <option value="SUPERVISED">Supervised Autopilot (Low-Risk Reversible Auto)</option>
              <option value="ADVANCED">Advanced Bounded Autopilot (Within Strict Caps)</option>
            </select>
          </label>

          <label htmlFor="autopilot-industry-pack" className="block text-sm">
            <span className="font-semibold">Industry Pack (15 Packs + Custom)</span>
            <select
              id="autopilot-industry-pack"
              className="jata-input mt-1 w-full"
              value={data.config.industryPackKey}
              disabled={busy || !canConfigure}
              onChange={(e) =>
                void patchConfig(
                  { industryPackKey: e.target.value },
                  "Industry Pack updated and diagnosis re-aligned.",
                )
              }
            >
              {data.industryPacks.map((pack) => (
                <option key={pack.key} value={pack.key}>
                  {pack.name}
                  {pack.hasRegulatedGuardrail ? " (Regulated Safety Lock)" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-[color:var(--ws-line)] px-3 py-2 text-xs">
            <p className="font-bold">Monthly Meter ({data.usage.periodKey})</p>
            <p className="ws-muted mt-1">
              Reasoning: {data.usage.capabilityUsedThisMonth.LLM_REASONING ?? 0}/
              {data.usage.capabilityLimits.LLM_REASONING ?? 0} · Docs:{" "}
              {data.usage.capabilityUsedThisMonth.VISION_EXTRACT ?? 0}/
              {data.usage.capabilityLimits.VISION_EXTRACT ?? 0} · Workflows:{" "}
              {data.usage.capabilityUsedThisMonth.WORKFLOW_STEP ?? 0}/
              {data.usage.capabilityLimits.WORKFLOW_STEP ?? 0}
            </p>
          </div>
        </div>
      </WorkspacePanel>

      {/* Subscription Plans */}
      <WorkspacePanel
        tone="graphite"
        title={data.entitlement.banner.headline}
        meta={data.entitlement.banner.detail}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {data.plans.map((plan) => {
            const isCurrent =
              data.entitlement.entitled && data.entitlement.planKey === plan.key;
            return (
              <div
                key={plan.key}
                className="rounded-xl border border-white/15 bg-white/5 p-3.5 text-[color:var(--ws-on-ink)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{plan.name}</p>
                  <StatusPill tone={isCurrent ? "success" : "neutral"}>
                    {isCurrent ? "Current" : plan.tier}
                  </StatusPill>
                </div>
                <p className="mt-1 text-lg font-extrabold">
                  {formatKES(plan.priceKES)} <span className="text-xs font-normal">/ 30 days</span>
                </p>
                <p className="mt-1 text-xs opacity-85">{plan.description}</p>
                <button
                  type="button"
                  disabled={busy || !canManageBilling}
                  onClick={() => void startCheckout(plan.id, plan.name)}
                  className="ws-btn-amber mt-3 min-h-[44px] w-full justify-center"
                >
                  {isCurrent ? "Extend 30 days" : `Activate ${formatKES(plan.priceKES)}`}
                </button>
              </div>
            );
          })}
        </div>
      </WorkspacePanel>

      {/* Grounded 30-Day Metrics */}
      <WorkspacePanel
        title="Grounded 30-Day Business Health Diagnosis"
        meta="Every figure carries its exact data-provenance tag — zero fabricated numbers"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.diagnosis.metrics.map((metric) => (
            <WorkspaceStat
              key={metric.key}
              label={metric.label}
              value={
                metric.value === null
                  ? "No data yet"
                  : metric.unit === "KES"
                    ? formatKES(Number(metric.value))
                    : `${metric.value}${metric.unit === "%" ? "%" : ` ${metric.unit ?? ""}`}`
              }
              hint={
                <span className="inline-flex flex-col gap-1">
                  <span>
                    <StatusPill tone={basisTone(metric.basis)}>{metric.basis}</StatusPill>
                  </span>
                  <span>{metric.explanation}</span>
                </span>
              }
            />
          ))}
        </div>

        {data.diagnosis.findings.length > 0 ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {data.diagnosis.findings.map((finding) => (
              <div
                key={finding.id}
                className="rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">{finding.title}</p>
                  <StatusPill tone={basisTone(finding.basis)}>{finding.basis}</StatusPill>
                </div>
                <p className="ws-muted ws-tiny mt-1">{finding.summary}</p>
              </div>
            ))}
          </div>
        ) : null}

        {data.diagnosis.suggestedProposals.length > 0 ? (
          <div className="mt-4 border-t border-[color:var(--ws-line)] pt-3">
            <p className="text-xs font-bold uppercase tracking-wider">
              Recommended Safe Actions (Grounded in Current State)
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {data.diagnosis.suggestedProposals.map((cand) => (
                <div
                  key={cand.idempotencyKey}
                  className="flex flex-col justify-between gap-2 rounded-xl border border-[color:var(--ws-line)] p-3"
                >
                  <div>
                    <p className="text-sm font-bold">{cand.title}</p>
                    <p className="ws-muted ws-tiny mt-0.5">{cand.rationale}</p>
                    <p className="ws-tiny mt-1 font-medium">Impact: {cand.expectedImpact}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || isPaused || !canConfigure}
                    onClick={() => void queueSuggestedProposal(cand)}
                    className="jata-btn jata-btn-primary min-h-[44px] self-start"
                  >
                    <Sparkles size={14} aria-hidden="true" /> Queue in Approval Queue
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </WorkspacePanel>

      {/* Conversational & Voice Brief Command Center */}
      <WorkspacePanel
        title="Ask or Direct JATA Autopilot (Text & Push-to-Talk Voice Brief)"
        meta="Browser Web Speech dictation (with manual transcript fallback); server-side streaming STT/telephony is not active in Phase 1"
      >
        <form onSubmit={submitOwnerCommand} className="space-y-2.5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Input modality">
            <button
              type="button"
              aria-pressed={modality === "TEXT"}
              onClick={() => {
                setModality("TEXT");
                setVoiceConfirmed(false);
              }}
              className={
                modality === "TEXT"
                  ? "jata-btn jata-btn-primary min-h-[44px]"
                  : "jata-btn jata-btn-secondary min-h-[44px]"
              }
            >
              Text Command
            </button>
            <button
              type="button"
              aria-pressed={modality === "VOICE_TRANSCRIPT"}
              onClick={startBrowserDictation}
              className={
                modality === "VOICE_TRANSCRIPT"
                  ? "jata-btn jata-btn-primary min-h-[44px]"
                  : "jata-btn jata-btn-secondary min-h-[44px]"
              }
            >
              <Mic size={14} aria-hidden="true" /> Push-to-Talk Voice Transcript
            </button>
          </div>

          <label htmlFor="autopilot-command-input" className="block text-xs font-semibold">
            Owner question or command
          </label>
          <textarea
            id="autopilot-command-input"
            rows={2}
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder="Ask e.g. 'Why are customers dropping off?', 'Draft a featured offer', 'Resolve top unanswered FAQ', or 'Pause Autopilot'..."
            className="jata-input w-full"
          />

          {modality === "VOICE_TRANSCRIPT" ? (
            <label
              htmlFor="autopilot-voice-confirm"
              className="flex min-h-[44px] items-center gap-2 py-2 text-xs font-medium"
            >
              <input
                id="autopilot-voice-confirm"
                type="checkbox"
                checked={voiceConfirmed}
                onChange={(e) => setVoiceConfirmed(e.target.checked)}
              />
              Confirm voice transcript above is accurate before queuing any business write action
            </label>
          ) : null}

          <button
            type="submit"
            disabled={busy || !commandInput.trim()}
            className="jata-btn jata-btn-primary min-h-[44px]"
          >
            <Send size={14} aria-hidden="true" /> Run Grounded Command
          </button>
        </form>

        {commandReply ? (
          <div
            role="region"
            aria-label="Autopilot response"
            aria-live="polite"
            className="mt-3 break-words whitespace-pre-wrap rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] p-3 font-sans text-sm"
          >
            {commandReply}
          </div>
        ) : null}
      </WorkspacePanel>

      {/* Approval Queue & 1-Click Rollback */}
      <WorkspacePanel
        title="Approval Queue & Reversible Execution Log"
        meta="Every live write captures a before-snapshot so you can undo changes safely"
      >
        {data.proposals.length === 0 ? (
          <p className="ws-muted text-sm">
            No proposals queued yet. Queue one of the grounded recommendations above or ask
            Command Center to draft an offer or FAQ update.
          </p>
        ) : (
          <div className="space-y-2.5">
            {data.proposals.map((prop) => (
              <div
                key={prop.id}
                className="rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{prop.title}</p>
                    <p className="ws-muted ws-tiny">
                      {prop.actionType} · Risk: {prop.riskCategory}
                    </p>
                  </div>
                  <StatusPill tone={proposalStatusTone(prop.status)}>{prop.status}</StatusPill>
                </div>
                <p className="ws-tiny mt-1">{prop.rationale}</p>
                {prop.expectedImpact ? (
                  <p className="ws-muted ws-tiny mt-0.5">Expected impact: {prop.expectedImpact}</p>
                ) : null}
                {prop.lastError ? (
                  <p className="ws-tiny mt-1 text-red-700">Note: {prop.lastError}</p>
                ) : null}

                <div className="mt-2.5 flex flex-wrap gap-2">
                  {prop.status === "PROPOSED" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy || isPaused || !canConfigure}
                        onClick={() =>
                          void runProposalOperation(prop.id, "APPROVE_AND_EXECUTE")
                        }
                        className="jata-btn jata-btn-primary min-h-[44px]"
                      >
                        <CheckCircle2 size={14} aria-hidden="true" /> Approve &amp; Execute
                      </button>
                      <button
                        type="button"
                        disabled={busy || !canConfigure}
                        onClick={() => void runProposalOperation(prop.id, "REJECT")}
                        className="jata-btn jata-btn-secondary min-h-[44px]"
                      >
                        <XCircle size={14} aria-hidden="true" /> Reject
                      </button>
                    </>
                  ) : null}

                  {prop.status === "EXECUTED" && prop.rollbackSupported ? (
                    <button
                      type="button"
                      disabled={busy || !canConfigure}
                      onClick={() => void runProposalOperation(prop.id, "ROLLBACK")}
                      className="jata-btn jata-btn-secondary min-h-[44px]"
                    >
                      <RotateCcw size={14} aria-hidden="true" /> Rollback to Prior Snapshot
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </WorkspacePanel>

      {/* Multimodal CSV / Document / Payment-Claim Safety Extractor */}
      <WorkspacePanel
        title="Multimodal Document & Receipt Safety Extractor"
        meta="Phase 1 parses structured CSV/JSON/text directly and flags payment claims UNVERIFIED; binary image/PDF OCR vision extraction requires configured multimodal provider credentials"
      >
        <form onSubmit={handleIngestSubmit} className="space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="autopilot-ingest-filename" className="block text-xs font-semibold">
                Artifact file name
              </label>
              <input
                id="autopilot-ingest-filename"
                type="text"
                value={ingestFileName}
                onChange={(e) => setIngestFileName(e.target.value)}
                placeholder="File name (e.g. menu.csv or mpesa-claim.txt)"
                className="jata-input mt-1 w-full"
              />
            </div>
            <div>
              <label htmlFor="autopilot-ingest-mime" className="block text-xs font-semibold">
                Content format
              </label>
              <select
                id="autopilot-ingest-mime"
                value={ingestMime}
                onChange={(e) => setIngestMime(e.target.value)}
                className="jata-input mt-1 w-full"
              >
                <option value="text/csv">CSV Price List / Stock Sheet (text/csv)</option>
                <option value="application/json">Structured JSON (application/json)</option>
                <option value="text/plain">Plain Text / Receipt OCR Claim (text/plain)</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="autopilot-ingest-content" className="block text-xs font-semibold">
              Structured text or receipt claim to inspect
            </label>
            <textarea
              id="autopilot-ingest-content"
              rows={3}
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
              placeholder="Paste CSV rows (name,priceKES,stock) or customer payment message to inspect safely..."
              className="jata-input mt-1 w-full"
            />
          </div>
          <button
            type="submit"
            disabled={busy || isPaused || !canConfigure || !ingestText.trim()}
            className="jata-btn jata-btn-secondary min-h-[44px]"
          >
            <FileSpreadsheet size={14} aria-hidden="true" /> Inspect &amp; Extract Safely
          </button>
        </form>

        {ingestResult ? (
          <div className="mt-3 rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {ingestResult.fileName} ({ingestResult.documentKind})
              </p>
              <StatusPill
                tone={
                  ingestResult.paymentClaimSafeFlag === "UNVERIFIED_CLAIM_NEVER_PROOF"
                    ? "danger"
                    : "info"
                }
              >
                {ingestResult.paymentClaimSafeFlag}
              </StatusPill>
            </div>
            <p className="mt-1">{ingestResult.summary}</p>
            {ingestResult.securityWarning ? (
              <p className="mt-1 flex items-center gap-1 font-semibold text-amber-800">
                <ShieldAlert size={14} aria-hidden="true" /> {ingestResult.securityWarning}
              </p>
            ) : null}
          </div>
        ) : null}
      </WorkspacePanel>

      {/* Omnichannel Compatibility & Customer Consent */}
      <WorkspacePanel
        title="Omnichannel Readiness & Customer Opt-In Compliance"
        meta="Official APIs only — zero browser scraping; STOP/ACHA opt-outs and EAT quiet hours enforced automatically"
      >
        <div className="grid gap-2 md:grid-cols-2">
          {data.channels.map((ch) => (
            <div
              key={ch.channelKey}
              className="rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold">{ch.label}</p>
                <StatusPill tone={channelStatusTone(ch.status)}>{ch.status}</StatusPill>
              </div>
              <p className="ws-muted ws-tiny mt-1">{ch.detail}</p>
            </div>
          ))}
        </div>

        <form
          onSubmit={handleRecordConsent}
          className="mt-4 grid gap-2 border-t border-[color:var(--ws-line)] pt-3 sm:grid-cols-4"
        >
          <div>
            <label htmlFor="autopilot-consent-name" className="block text-xs font-semibold">
              Customer name
            </label>
            <input
              id="autopilot-consent-name"
              type="text"
              value={consentName}
              onChange={(e) => setConsentName(e.target.value)}
              placeholder="Customer name"
              className="jata-input mt-1 w-full"
            />
          </div>
          <div>
            <label htmlFor="autopilot-consent-phone" className="block text-xs font-semibold">
              Customer phone
            </label>
            <input
              id="autopilot-consent-phone"
              type="tel"
              value={consentPhone}
              onChange={(e) => setConsentPhone(e.target.value)}
              placeholder="Phone (+2547...)"
              className="jata-input mt-1 w-full"
            />
          </div>
          <div>
            <label htmlFor="autopilot-consent-channel" className="block text-xs font-semibold">
              Opt-in channel
            </label>
            <select
              id="autopilot-consent-channel"
              value={consentChannel}
              onChange={(e) => setConsentChannel(e.target.value as any)}
              className="jata-input mt-1 w-full"
            >
              <option value="WHATSAPP">WhatsApp Opt-In</option>
              <option value="SMS">SMS Opt-In</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy || !canManageConsent || !consentPhone.trim()}
              className="jata-btn jata-btn-secondary min-h-[44px] w-full justify-center"
            >
              Record Opt-In Consent
            </button>
          </div>
        </form>
      </WorkspacePanel>

      {/* Immutable Audit Trail */}
      <WorkspacePanel
        title="Immutable Audit Trail"
        meta="Secrets redacted automatically before persistence"
      >
        {data.auditEvents.length === 0 ? (
          <p className="ws-muted text-sm">No Autopilot audit events recorded yet.</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {data.auditEvents.map((ev) => (
              <li
                key={ev.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--ws-line)] px-3 py-2"
              >
                <span>
                  <strong>{ev.action}</strong>{" "}
                  <span className="ws-muted">by {ev.actorKind}</span>
                </span>
                <span className="ws-muted font-mono">{ev.createdAt.slice(0, 19).replace("T", " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </WorkspacePanel>
    </div>
  );
}

export default AutopilotCommandCenter;
