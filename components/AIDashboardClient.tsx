"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PREVIEW_TEST_QUESTIONS } from "@/lib/ai-grounding";
import { StatusPill } from "@/components/ui/StatusPill";
import { WorkspacePanel, WorkspaceSectionHead, WorkspaceStat } from "@/components/workspace/WorkspaceUI";
import { aiFrontDeskStatusLabel } from "@/lib/statusLabels";
import type { PublicationSummary } from "@/components/ai/AIFrontDeskWorkspace";
import {
  AlertTriangle,
  ClipboardList,
  Download,
  ExternalLink,
  HelpCircle,
  Inbox,
  Loader2,
  Pause,
  Play,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";

type SectionTab = "overview" | "conversations" | "orders" | "products" | "customers" | "knowledge" | "ask_my_bot";

const TABS: Array<{ id: SectionTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "conversations", label: "Conversations" },
  { id: "orders", label: "Orders & pre-orders" },
  { id: "products", label: "Products & stock" },
  { id: "customers", label: "Customers & leads" },
  { id: "knowledge", label: "Knowledge & demand" },
  { id: "ask_my_bot", label: "Ask my bot" },
];

/**
 * The operations half of the AI Front Desk: what the desk is actually doing for customers.
 *
 * Presentation follows the workspace design system (cream paper, ink type, amber accent) instead
 * of the previous dark console, so this screen belongs to the rest of the dashboard. The status
 * badge is `frontDesk` from the server — the derived lifecycle — never a local default: the old
 * component seeded a local "LIVE" status before its first response, which is one of the ways a
 * LIVE label could appear without a paid, published Front Desk.
 */
export default function AIDashboardClient({
  businessId,
  businessName,
  businessSlug,
  userEmail,
  isAdmin,
  initialPublication,
}: {
  businessId: string;
  businessName: string;
  businessSlug: string;
  userEmail: string;
  isAdmin?: boolean;
  initialPublication?: PublicationSummary | null;
}) {
  const [activeTab, setActiveTab] = useState<SectionTab>("overview");
  const [conversationFilter, setConversationFilter] = useState<string>("ALL");
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  // Unanswered question approval state (§35)
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});

  // Owner "Ask My Bot" testing console state (§29)
  const [botQuestion, setBotQuestion] = useState("");
  const [botConversationId, setBotConversationId] = useState<string | null>(null);
  const [botTesting, setBotTesting] = useState(false);
  const [botResult, setBotResult] = useState<{
    reply: string;
    responseType: string;
    source: string;
    confidence: string;
    escalatedToHuman: boolean;
    diagnostics?: {
      informationFound: string[];
      informationNotFound: string[];
      missingInformation: string[];
      configurationImprovement: string[];
      toolsInvoked: string[];
      conflicts: Array<{
        productName: string;
        field: string;
        structuredValue: string;
        conflictingValue: string;
        sourceTitle: string;
      }>;
    };
  } | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/ai/dashboard?businessId=${encodeURIComponent(businessId)}&conversationStatus=${encodeURIComponent(conversationFilter)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDashboard(data);
      } else {
        setLoadError(data.error || "We could not load your front desk activity.");
      }
    } catch {
      setLoadError("No connection. Your saved settings are unaffected — try again when you are back online.");
    } finally {
      setLoading(false);
    }
  }, [businessId, conversationFilter]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const publication: PublicationSummary | null = dashboard?.frontDesk || initialPublication || null;
  const statusLabel = aiFrontDeskStatusLabel(publication?.state);

  async function handleStatusToggle(nextStatus: "PAUSED" | "MAINTENANCE" | "LIVE") {
    setBannerMessage(null);
    setStatusBusy(true);
    try {
      const res = await fetch("/api/ai/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, operationalStatus: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBannerMessage(
          nextStatus === "LIVE"
            ? "Front desk switched back on."
            : nextStatus === "PAUSED"
              ? "Front desk paused — customers are handed to a person until you resume."
              : "Front desk moved to maintenance — customers are handed to a person.",
        );
        await loadDashboard();
      } else {
        setBannerMessage(data.error || "That change was not applied.");
      }
    } catch {
      setBannerMessage("No connection, so nothing changed.");
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleApproveAnswer(questionId: string) {
    const approvedAnswer = (answerDrafts[questionId] || "").trim();
    if (!approvedAnswer) return;
    setBannerMessage(null);
    try {
      const res = await fetch("/api/intelligence/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          action: "approve",
          questionId,
          approvedAnswer,
        }),
      });
      if (res.ok) {
        setBannerMessage("Approved answer added to your business brain.");
        setAnswerDrafts((prev) => ({ ...prev, [questionId]: "" }));
        await loadDashboard();
      } else {
        const data = await res.json().catch(() => ({}));
        setBannerMessage(data.error || "Could not approve that answer.");
      }
    } catch {
      setBannerMessage("No connection — the answer was not saved.");
    }
  }

  async function handleAskMyBot(e: React.FormEvent) {
    e.preventDefault();
    const q = botQuestion.trim();
    if (!q || botTesting) return;
    setBotTesting(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          message: q,
          conversationId: botConversationId,
          preview: true,
          mode: "ask_my_bot",
        }),
      });
      const data = await res.json();
      if (data.conversationId) setBotConversationId(data.conversationId);
      setBotResult(data);
    } catch {
      setBotResult(null);
    } finally {
      setBotTesting(false);
    }
  }

  // Zeroed counters are only a placeholder while the first request is in flight; they are never
  // presented as this business's results (see the loading state below).
  const overview = useMemo(
    () =>
      dashboard?.overview || {
        conversationsCount: 0,
        ordersCreatedCount: 0,
        paidOrdersCount: 0,
        pendingPaymentsCount: 0,
        preordersCount: 0,
        humanEscalationsCount: 0,
        unansweredQuestionsCount: 0,
        topCustomerQuestions: [],
        topRequestedProducts: [],
        topDeliveryZones: [],
        conversionRate: 0,
      },
    [dashboard],
  );
  const controls = dashboard?.controls || null;
  const readiness = dashboard?.readiness;
  const qr = dashboard?.qr;

  const metrics = useMemo(
    () => [
      { label: "Conversations", value: overview.conversationsCount, hint: "Customer chats recorded" },
      { label: "Orders created", value: overview.ordersCreatedCount, hint: "From the front desk" },
      { label: "Paid orders", value: overview.paidOrdersCount, hint: "Payment confirmed" },
      { label: "Pending payment", value: overview.pendingPaymentsCount, hint: "Waiting on M-Pesa" },
      { label: "Pre-orders", value: overview.preordersCount, hint: "Restock requests" },
      { label: "Human handovers", value: overview.humanEscalationsCount, hint: "Needs your reply" },
      { label: "Unanswered", value: overview.unansweredQuestionsCount, hint: "Add the answer" },
    ],
    [overview],
  );

  return (
    <div className="ws-stack" data-admin={isAdmin ? "true" : undefined}>
      <WorkspaceSectionHead
        id="operations"
        title="Operations"
        meta={`${businessName} · recorded from the front desk · signed in as ${userEmail}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={statusLabel.tone}>{statusLabel.label}</StatusPill>
            {(publication?.state === "LIVE" || publication?.state === "PAUSED" || publication?.state === "MAINTENANCE") ? (
              publication.state === "LIVE" ? (
                <button
                  type="button"
                  onClick={() => handleStatusToggle("PAUSED")}
                  disabled={statusBusy}
                  className="jata-btn jata-btn-secondary jata-btn-sm"
                >
                  <Pause size={14} aria-hidden="true" /> Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleStatusToggle("LIVE")}
                  disabled={statusBusy}
                  className="jata-btn jata-btn-primary jata-btn-sm"
                >
                  <Play size={14} aria-hidden="true" /> Switch on
                </button>
              )
            ) : null}
            <Link href={`/b/${businessSlug}/ai?preview=true`} target="_blank" rel="noopener noreferrer" className="jata-btn jata-btn-ghost jata-btn-sm">
              <ExternalLink size={14} aria-hidden="true" /> Private preview
            </Link>
            <button type="button" onClick={() => void loadDashboard()} disabled={loading} className="jata-btn jata-btn-ghost jata-btn-sm">
              {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
              <span className="ml-1">{loading ? "Loading…" : "Refresh"}</span>
            </button>
          </div>
        }
      />

      {bannerMessage ? (
        <p role="status" className="jata-alert" data-tone="info">
          {bannerMessage}
        </p>
      ) : null}

      {loadError ? (
        <div className="jata-alert" data-tone="danger" role="alert">
          <div className="min-w-0">
            <p className="font-bold">We could not load the activity</p>
            <p className="mt-0.5">{loadError}</p>
          </div>
          <button type="button" onClick={() => void loadDashboard()} className="jata-btn jata-btn-secondary jata-btn-sm ml-auto shrink-0">
            Try again
          </button>
        </div>
      ) : null}

      {/* Section navigation — one rail, no second navigation bar. */}
      <nav aria-label="AI Front Desk sections" className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-current={active ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-full border px-3.5 text-xs font-bold transition"
              style={
                active
                  ? { borderColor: "var(--ws-ink)", background: "var(--ws-ink)", color: "var(--ws-on-ink)" }
                  : { borderColor: "var(--ws-line)", background: "var(--ws-paper)", color: "var(--ws-text)" }
              }
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {loading && !dashboard ? (
        <p role="status" className="ws-small ws-muted">
          Loading the front desk activity…
        </p>
      ) : null}

      {activeTab === "overview" ? (
        <div className="ws-stack">
          <div className="ws-stats ws-stats--5">
            {metrics.map((metric) => (
              <WorkspaceStat key={metric.label} label={metric.label} value={metric.value} hint={metric.hint} />
            ))}
          </div>

          <div className="ws-grid-2 md:grid-cols-3">
            <WorkspacePanel title="Top customer questions" meta="What people actually ask">
              <ul className="grid gap-1.5">
                {(overview.topCustomerQuestions || []).length > 0 ? (
                  overview.topCustomerQuestions.map((q: any, idx: number) => (
                    <li key={idx} className="flex items-start justify-between gap-2 border-b pb-1.5 text-xs" style={{ borderColor: "var(--ws-line-soft)" }}>
                      <span style={{ color: "var(--ws-text)" }}>{q.question}</span>
                      <span className="shrink-0 font-bold tabular-nums" style={{ color: "var(--ws-amber-deep)" }}>{q.count}</span>
                    </li>
                  ))
                ) : (
                  <li className="ws-small ws-muted">
                    No questions recorded yet. Once customers use the front desk, the recurring ones
                    appear here so you can add the answer.
                  </li>
                )}
              </ul>
            </WorkspacePanel>

            <WorkspacePanel title="Readiness checks" meta="What publication verifies">
              <ul className="grid gap-2">
                {(readiness?.checks || []).map((c: any) => (
                  <li key={c.id} className="flex items-start gap-2 text-xs">
                    <span aria-hidden="true" style={{ color: c.passed ? "var(--ws-jade)" : "var(--ws-amber-deep)" }}>
                      {c.passed ? "✓" : "•"}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold" style={{ color: "var(--ws-text)" }}>{c.label}</p>
                      <p className="ws-tiny ws-muted">{c.detail}</p>
                    </div>
                  </li>
                ))}
                {!readiness ? <li className="ws-small ws-muted">Readiness is checked when you publish from the setup steps above.</li> : null}
              </ul>
            </WorkspacePanel>

            <WorkspacePanel title="Counter & packaging QR" meta="Print it, or share the link">
              {qr ? (
                <div className="flex flex-col items-center text-center">
                  <p className="ws-tiny ws-muted break-all">{qr.shareUrl}</p>
                  <div className="mt-2 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} />
                </div>
              ) : (
                <p className="ws-small ws-muted">
                  Publish the front desk first — the QR code points at the live customer view, so it
                  is not issued for a draft.
                </p>
              )}
            </WorkspacePanel>
          </div>
        </div>
      ) : null}

      {activeTab === "conversations" ? (
        <WorkspacePanel title="Conversations" meta="Every customer chat, newest first">
          <div className="mb-3 flex flex-wrap gap-2">
            {["ALL", "ACTIVE", "WAITING_FOR_HUMAN", "CONVERTED", "ABANDONED"].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setConversationFilter(status)}
                aria-pressed={conversationFilter === status}
                className="inline-flex min-h-11 items-center rounded-full border px-3.5 text-[11px] font-bold"
                style={
                  conversationFilter === status
                    ? { borderColor: "var(--ws-amber-deep)", background: "var(--ws-amber-soft)", color: "var(--ws-amber-deep)" }
                    : { borderColor: "var(--ws-line)", background: "var(--ws-paper)", color: "var(--ws-muted)" }
                }
              >
                {status === "ALL" ? "All" : status.toLowerCase().replace(/_/g, " ")}
              </button>
            ))}
          </div>

          <div className="grid gap-2">
            {(dashboard?.conversations || []).length > 0 ? (
              dashboard.conversations.map((conv: any) => (
                <article key={conv.conversationId} className="rounded-[var(--ws-radius-md)] border p-3" style={{ borderColor: "var(--ws-line)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold">{conv.customerName || "Customer"}</span>
                    <span className="flex items-center gap-1.5">
                      <StatusPill tone={conv.status === "WAITING_FOR_HUMAN" ? "warning" : conv.status === "CONVERTED" ? "success" : "neutral"}>
                        {String(conv.status || "").toLowerCase().replace(/_/g, " ")}
                      </StatusPill>
                      <span className="ws-tiny ws-muted">{String(conv.channel || "").replace(/_/g, " ")}</span>
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs">
                    {(conv.turns || []).slice(-4).map((t: any, i: number) => (
                      <p key={i} style={{ color: t.role === "customer" ? "var(--ws-text)" : "var(--ws-muted)" }}>
                        <strong>{t.role === "customer" ? "Customer" : "Front desk"}:</strong> {t.text}
                      </p>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <p className="ws-small ws-muted flex items-center gap-2">
                <Inbox size={15} aria-hidden="true" />
                No conversations match this filter yet.
              </p>
            )}
          </div>
        </WorkspacePanel>
      ) : null}

      {activeTab === "orders" ? (
        <WorkspacePanel title="Orders & pre-orders" meta="Order status, payment status and notification status stay separate">
          <div className="grid gap-2">
            {(dashboard?.orders || []).length > 0 ? (
              dashboard.orders.map((ord: any) => (
                <article key={ord.id} className="rounded-[var(--ws-radius-md)] border p-3" style={{ borderColor: "var(--ws-line)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{ord.orderReference} — {ord.customerName || "Customer"}</p>
                      <p className="ws-tiny ws-muted">
                        KES {ord.totalKES} · {String(ord.fulfilmentType || "").toLowerCase()}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusPill tone="neutral">Order: {String(ord.orderStatus || "").toLowerCase()}</StatusPill>
                      <StatusPill tone={ord.paymentStatus === "PAID" ? "success" : "warning"}>
                        Payment: {String(ord.paymentStatus || "unpaid").toLowerCase()}
                      </StatusPill>
                      <StatusPill tone="info">Notification: {String(ord.notificationStatus || "").toLowerCase()}</StatusPill>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <p className="ws-small ws-muted flex items-center gap-2">
                <ShoppingBag size={15} aria-hidden="true" />
                No orders from the front desk yet.
              </p>
            )}
          </div>
        </WorkspacePanel>
      ) : null}

      {activeTab === "products" ? (
        <WorkspacePanel title="Products & stock" meta="Prices are the ones customers are quoted">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(dashboard?.products || []).map((p: any) => (
              <article key={p.id} className="rounded-[var(--ws-radius-md)] border p-3 text-xs" style={{ borderColor: "var(--ws-line)" }}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold" style={{ color: "var(--ws-text)" }}>{p.name}</span>
                  <StatusPill tone={p.stockStatus === "IN_STOCK" ? "success" : "warning"}>
                    {String(p.stockStatus || "").toLowerCase().replace(/_/g, " ")}
                  </StatusPill>
                </div>
                <p className="mt-1" style={{ color: "var(--ws-muted)" }}>
                  {p.priceKES != null ? `KES ${p.priceKES}` : "Price on request"}
                  {p.wasPriceKES != null ? ` (was KES ${p.wasPriceKES}, sale running)` : ""}
                  {typeof p.quantity === "number" ? ` · ${p.quantity} in stock` : ""}
                </p>
                {p.preOrderAllowed ? <p className="mt-0.5" style={{ color: "var(--ws-amber-deep)" }}>Pre-orders allowed</p> : null}
              </article>
            ))}
            {(dashboard?.products || []).length === 0 ? (
              <p className="ws-small ws-muted">No products saved yet. Add them to your business page and the front desk picks them up.</p>
            ) : null}
          </div>
        </WorkspacePanel>
      ) : null}

      {activeTab === "customers" ? (
        <WorkspacePanel title="Customers & leads" meta="People who asked to hear back">
          <div className="grid gap-2">
            {(dashboard?.customers || []).length > 0 ? (
              dashboard.customers.map((lead: any) => (
                <article key={lead.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--ws-radius-md)] border p-3" style={{ borderColor: "var(--ws-line)" }}>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {lead.customerName || "Customer"} {lead.customerPhone ? `· ${lead.customerPhone}` : ""}
                    </p>
                    <p className="ws-tiny ws-muted">{lead.summary}</p>
                  </div>
                  <StatusPill tone={lead.classification === "HUMAN_HANDOFF" ? "warning" : "neutral"}>
                    {String(lead.classification || "").toLowerCase().replace(/_/g, " ")}
                  </StatusPill>
                </article>
              ))
            ) : (
              <p className="ws-small ws-muted flex items-center gap-2">
                <Users size={15} aria-hidden="true" />
                No leads captured yet.
              </p>
            )}
          </div>
        </WorkspacePanel>
      ) : null}

      {activeTab === "knowledge" ? (
        <div className="ws-grid-2 md:grid-cols-2">
          <WorkspacePanel title="Questions waiting for an answer" meta="Approve once, answer forever">
            <div className="grid gap-2">
              {(dashboard?.knowledge?.unansweredQuestions || []).length > 0 ? (
                dashboard.knowledge.unansweredQuestions.map((uq: any) => (
                  <div key={uq.id} className="rounded-[var(--ws-radius-md)] border p-3" style={{ borderColor: "var(--ws-line)" }}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold" style={{ color: "var(--ws-text)" }}>{uq.question}</span>
                      <span className="ws-tiny ws-muted shrink-0">Asked {uq.askedCount}×</span>
                    </div>
                    {uq.isResolved ? (
                      <p className="ws-tiny mt-1" style={{ color: "var(--ws-jade)" }}>Approved answer: {uq.approvedAnswer}</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <label className="sr-only" htmlFor={`answer-${uq.id}`}>Answer for {uq.question}</label>
                        <input
                          id={`answer-${uq.id}`}
                          type="text"
                          value={answerDrafts[uq.id] || ""}
                          onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [uq.id]: e.target.value }))}
                          placeholder="Write the answer customers should get"
                          className="jata-input min-w-0 flex-1"
                        />
                        <button type="button" onClick={() => handleApproveAnswer(uq.id)} className="jata-btn jata-btn-primary jata-btn-sm">
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="ws-small ws-muted flex items-center gap-2">
                  <HelpCircle size={15} aria-hidden="true" />
                  Nothing waiting for review.
                </p>
              )}
            </div>
          </WorkspacePanel>

          <div className="grid content-start gap-3">
            <WorkspacePanel title="Missed demand" meta="Requests you could not serve">
              {(dashboard?.knowledge?.demandInsights || []).length > 0 ? (
                <ul className="grid gap-1.5">
                  {dashboard.knowledge.demandInsights.map((d: any) => (
                    <li key={d.id} className="flex items-start justify-between gap-2 border-b pb-1.5 text-xs" style={{ borderColor: "var(--ws-line-soft)" }}>
                      <span style={{ color: "var(--ws-text)" }}>
                        <span className="font-semibold">{String(d.insightType || "").toLowerCase().replace(/_/g, " ")}</span>: {d.subject}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums" style={{ color: "var(--ws-amber-deep)" }}>{d.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ws-small ws-muted">No missed-demand signals recorded yet.</p>
              )}
            </WorkspacePanel>

            {(dashboard?.knowledge?.conflicts || []).length > 0 ? (
              <div className="jata-alert" data-tone="warning">
                <div>
                  <p className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle size={14} aria-hidden="true" /> Conflicting information found
                  </p>
                  <ul className="mt-1 grid gap-1 text-xs">
                    {dashboard.knowledge.conflicts.map((c: any, idx: number) => (
                      <li key={idx}>
                        {c.productName} ({c.field}): the catalogue says <strong>{c.structuredValue}</strong>, but
                        “{c.sourceTitle}” says <strong>{c.conflictingValue}</strong>. The catalogue is used.
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "ask_my_bot" ? (
        <WorkspacePanel title="Ask my bot" meta="Private test console — nothing a customer sees">
          <div className="mb-2 flex items-start gap-2 rounded-[var(--ws-radius-md)] border p-2.5" style={{ borderColor: "rgba(180,83,9,0.3)", background: "var(--ws-amber-soft)" }}>
            <ClipboardList size={15} aria-hidden="true" style={{ color: "var(--ws-amber-deep)" }} />
            <p className="ws-small" style={{ color: "var(--ws-text)" }}>
              Test customer questions safely. Diagnostics show which information was found and what
              is missing from your configuration — never internal reasoning.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PREVIEW_TEST_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => setBotQuestion(question)}
                className="min-h-11 rounded-full border px-3.5 text-[11px] font-semibold"
                style={{ borderColor: "var(--ws-line)", background: "var(--ws-paper)", color: "var(--ws-text)" }}
              >
                {question}
              </button>
            ))}
          </div>

          <form onSubmit={handleAskMyBot} className="mt-3 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="ask-my-bot-input">Question to test</label>
            <input
              id="ask-my-bot-input"
              type="text"
              value={botQuestion}
              onChange={(e) => setBotQuestion(e.target.value)}
              placeholder="Ask a question a customer would ask"
              className="jata-input min-w-0 flex-1"
            />
            <button type="submit" disabled={botTesting || !botQuestion.trim()} className="jata-btn jata-btn-primary">
              {botTesting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Store size={15} aria-hidden="true" />}
              <span className="ml-1">{botTesting ? "Testing…" : "Test"}</span>
            </button>
          </form>

          {botResult && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-[var(--ws-radius-md)] border p-3" style={{ borderColor: "var(--ws-line)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusPill tone={botResult.responseType === "KNOWN" ? "success" : "warning"}>
                    {botResult.responseType === "KNOWN" ? "Answered from your data" : "Handed to a person"}
                  </StatusPill>
                  <span className="ws-tiny ws-muted">Source: {String(botResult.source || "").replace(/_/g, " ")} · confidence {botResult.confidence}</span>
                </div>
                <p className="mt-2 text-sm" style={{ color: "var(--ws-text)" }}>{botResult.reply}</p>
              </div>

              {botResult.diagnostics && (
                <div className="rounded-[var(--ws-radius-md)] border p-3" style={{ borderColor: "var(--ws-line)" }}>
                  <p className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: "var(--ws-muted)" }}>What this tells you</p>
                  <dl className="mt-1.5 grid gap-1 text-xs">
                    <div>
                      <dt className="font-semibold" style={{ color: "var(--ws-jade)" }}>Found</dt>
                      <dd className="ws-tiny ws-muted">{botResult.diagnostics.informationFound.join("; ") || "Nothing yet"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold" style={{ color: "var(--ws-amber-deep)" }}>Not found</dt>
                      <dd className="ws-tiny ws-muted">{botResult.diagnostics.informationNotFound.join("; ") || "None"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold" style={{ color: "var(--ws-text)" }}>Missing from your setup</dt>
                      <dd className="ws-tiny ws-muted">{botResult.diagnostics.missingInformation.join(" ") || "None"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold" style={{ color: "var(--ws-text)" }}>How to improve it</dt>
                      <dd className="ws-tiny ws-muted">{botResult.diagnostics.configurationImprovement.join(" ") || "Your configuration looks complete."}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          )}

          {controls ? (
            <p className="ws-tiny ws-muted mt-3">
              Answer settings in use: {controls.toneOfVoice} · {controls.languageBehavior}
              {controls.orderingAllowed ? " · ordering on" : " · ordering off"}
              {controls.bookingsAllowed ? " · bookings on" : " · bookings off"}
              {controls.pauseAllOrdering ? " · all ordering paused" : ""}
            </p>
          ) : null}
        </WorkspacePanel>
      ) : null}
    </div>
  );
}
