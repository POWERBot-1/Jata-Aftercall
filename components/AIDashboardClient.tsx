"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import DashboardNav from "@/components/DashboardNav";
import { PREVIEW_TEST_QUESTIONS } from "@/lib/ai-grounding";

type SectionTab =
  | "overview"
  | "conversations"
  | "orders"
  | "products"
  | "customers"
  | "knowledge"
  | "ask_my_bot";

export default function AIDashboardClient({
  businessId,
  businessName,
  businessSlug,
  userEmail,
  isAdmin,
}: {
  businessId: string;
  businessName: string;
  businessSlug: string;
  userEmail: string;
  isAdmin?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<SectionTab>("overview");
  const [conversationFilter, setConversationFilter] = useState<string>("ALL");
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

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
    try {
      const res = await fetch(
        `/api/ai/dashboard?businessId=${encodeURIComponent(businessId)}&conversationStatus=${encodeURIComponent(conversationFilter)}`,
      );
      const data = await res.json();
      if (res.ok) {
        setDashboard(data);
      }
    } catch {
      // Keep existing state
    } finally {
      setLoading(false);
    }
  }, [businessId, conversationFilter]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleStatusToggle(
    nextStatus?: "LIVE" | "PAUSED" | "MAINTENANCE",
    nextPauseOrdering?: boolean,
  ) {
    setBannerMessage(null);
    try {
      const res = await fetch("/api/ai/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          ...(nextStatus ? { operationalStatus: nextStatus } : {}),
          ...(nextPauseOrdering !== undefined ? { pauseAllOrdering: nextPauseOrdering } : {}),
        }),
      });
      if (res.ok) {
        setBannerMessage("Operational status updated.");
        await loadDashboard();
      }
    } catch {
      setBannerMessage("Failed to update operational status.");
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
        setBannerMessage("Approved answer promoted into Business Brain knowledge.");
        setAnswerDrafts((prev) => ({ ...prev, [questionId]: "" }));
        await loadDashboard();
      }
    } catch {
      setBannerMessage("Could not approve answer.");
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

  async function handlePublish() {
    setBannerMessage(null);
    try {
      const res = await fetch("/api/ai/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBannerMessage(data.error || "Readiness or subscription check not yet met.");
      } else {
        setBannerMessage(`AI Business Front Desk published live at ${data.sharePath}`);
        await loadDashboard();
      }
    } catch {
      setBannerMessage("Publish failed.");
    }
  }

  const overview = dashboard?.overview || {
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
  };
  const controls = dashboard?.controls || {
    operationalStatus: "LIVE",
    pauseAllOrdering: false,
  };
  const readiness = dashboard?.readiness;
  const qr = dashboard?.qr;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <DashboardNav isAdmin={Boolean(isAdmin)} />

      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Top Header + Emergency Controls (§44, §45) */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                AI Business Front Desk • {controls.operationalStatus}
              </span>
              {readiness?.subscription && (
                <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300">
                  Subscription: {readiness.subscription.status} (KES {readiness.subscription.priceKES}/mo)
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-bold text-white">{businessName}</h1>
            <p className="text-xs text-slate-300">
              Shareable AI Link:{" "}
              <Link href={`/b/${businessSlug}/ai`} className="text-emerald-300 underline">
                /b/{businessSlug}/ai
              </Link>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={controls.operationalStatus}
              onChange={(e) =>
                handleStatusToggle(e.target.value as "LIVE" | "PAUSED" | "MAINTENANCE", undefined)
              }
              aria-label="Operational Status"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
            >
              <option value="LIVE">Status: LIVE</option>
              <option value="PAUSED">Status: PAUSED</option>
              <option value="MAINTENANCE">Status: MAINTENANCE</option>
            </select>

            <button
              type="button"
              onClick={() => handleStatusToggle(undefined, !controls.pauseAllOrdering)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                controls.pauseAllOrdering
                  ? "bg-amber-500 text-slate-950"
                  : "border border-amber-500/50 bg-amber-500/10 text-amber-300"
              }`}
            >
              {controls.pauseAllOrdering ? "Ordering Paused (Resume)" : "PAUSE ALL ORDERING"}
            </button>

            <Link
              href={`/b/${businessSlug}/ai?preview=true`}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
            >
              Preview Mode
            </Link>

            <Link
              href={`/onboarding/ai?businessId=${businessId}`}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
            >
              Configure AI
            </Link>

            <button
              type="button"
              onClick={handlePublish}
              className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Publish Live
            </button>
          </div>
        </header>

        {bannerMessage && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
            {bannerMessage}
          </div>
        )}

        {/* Section Navigation (§33) */}
        <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-3" aria-label="AI Dashboard sections">
          {(
            [
              ["overview", "1. Overview"],
              ["conversations", "2. Conversations"],
              ["orders", "3. Orders & Pre-Orders"],
              ["products", "4. Products & Stock"],
              ["customers", "5. Customers & Leads"],
              ["knowledge", "6. Knowledge & Demand"],
              ["ask_my_bot", "Ask My Bot (Test Console)"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                activeTab === id
                  ? "bg-emerald-600 text-white"
                  : "border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {loading && !dashboard ? (
          <p className="text-sm text-slate-300">Loading synchronized AI Business Front Desk metrics...</p>
        ) : null}

        {/* 1. OVERVIEW (§33, §34) */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {[
                ["Conversations", overview.conversationsCount],
                ["Orders Created", overview.ordersCreatedCount],
                ["Paid Orders", overview.paidOrdersCount],
                ["Pending Payments", overview.pendingPaymentsCount],
                ["Pre-Orders", overview.preordersCount],
                ["Human Escalations", overview.humanEscalationsCount],
                ["Unanswered Qs", overview.unansweredQuestionsCount],
              ].map(([label, val]) => (
                <div key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                  <p className="text-xs text-slate-300">{label}</p>
                  <p className="mt-1 text-2xl font-bold text-white">{val}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {/* Top Customer Questions (§34) */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <h2 className="text-sm font-semibold text-white">Top Customer Questions</h2>
                <ul className="mt-3 space-y-2 text-xs">
                  {(overview.topCustomerQuestions || []).length > 0 ? (
                    overview.topCustomerQuestions.map((q: any, idx: number) => (
                      <li key={idx} className="flex justify-between gap-2 border-b border-slate-800 pb-1.5">
                        <span className="text-slate-200">{q.question}</span>
                        <span className="font-mono font-semibold text-emerald-300">{q.count}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-slate-300">No recurring questions recorded yet.</li>
                  )}
                </ul>
              </div>

              {/* AI Readiness Gate Checklist (§30) */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <h2 className="text-sm font-semibold text-white">AI Readiness Gate</h2>
                <ul className="mt-3 space-y-2 text-xs">
                  {(readiness?.checks || []).map((c: any) => (
                    <li key={c.id} className="flex items-start gap-2">
                      <span className={c.passed ? "text-emerald-400" : "text-amber-400"}>
                        {c.passed ? "✓" : "•"}
                      </span>
                      <div>
                        <p className="font-medium text-slate-100">{c.label}</p>
                        <p className="text-[11px] text-slate-300">{c.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Shareable Link & QR Code (§44) */}
              {qr && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 flex flex-col items-center text-center">
                  <h2 className="text-sm font-semibold text-white">Counter & Packaging QR Code</h2>
                  <p className="mt-1 text-xs text-slate-300">{qr.shareUrl}</p>
                  <div
                    className="mt-3 rounded-xl bg-white p-2"
                    dangerouslySetInnerHTML={{ __html: qr.qrSvg }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. CONVERSATIONS (§33) */}
        {activeTab === "conversations" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {["ALL", "ACTIVE", "WAITING_FOR_HUMAN", "CONVERTED", "ABANDONED"].map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setConversationFilter(status)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    conversationFilter === status
                      ? "bg-emerald-600 text-white"
                      : "border border-slate-800 bg-slate-900 text-slate-200"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {(dashboard?.conversations || []).length > 0 ? (
                dashboard.conversations.map((conv: any) => (
                  <div key={conv.conversationId} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">
                        {conv.customerName || "Customer"} ({conv.conversationId})
                      </span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-emerald-300">
                        {conv.status} • {conv.channel}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-slate-200">
                      {(conv.turns || []).slice(-4).map((t: any, i: number) => (
                        <p key={i}>
                          <strong className="text-slate-100">{t.role}:</strong> {t.text}
                        </p>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-300">No conversations matching filter {conversationFilter}.</p>
              )}
            </div>
          </div>
        )}

        {/* 3. ORDERS & PRE-ORDERS (§16, §19, §33, §37) */}
        {activeTab === "orders" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-white">
              Orders (Separate Order Status, Payment Status & Notification Status)
            </h2>
            <div className="space-y-2">
              {(dashboard?.orders || []).length > 0 ? (
                dashboard.orders.map((ord: any) => (
                  <div
                    key={ord.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-white">
                        {ord.orderReference} — {ord.customerName || "Customer"}
                      </p>
                      <p className="text-slate-300">
                        Total: KES {ord.totalKES} • Fulfilment: {ord.fulfilmentType}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded bg-slate-800 px-2.5 py-1 text-slate-100">
                        Order: {ord.orderStatus}
                      </span>
                      <span
                        className={`rounded px-2.5 py-1 font-semibold ${
                          ord.paymentStatus === "PAID"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        Payment: {ord.paymentStatus}
                      </span>
                      <span className="rounded bg-indigo-500/20 px-2.5 py-1 text-indigo-300">
                        Notification: {ord.notificationStatus}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-300">No orders recorded yet.</p>
              )}
            </div>
          </div>
        )}

        {/* 4. PRODUCTS & STOCK (§18, §33) */}
        {activeTab === "products" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(dashboard?.products || []).map((p: any) => (
              <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">{p.name}</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-emerald-300">{p.stockStatus}</span>
                </div>
                <p className="text-slate-200">
                  Price: KES {p.basePriceKES ?? p.variantPriceKES ?? 0}
                  {typeof p.quantity === "number" ? ` • Qty: ${p.quantity}` : ""}
                </p>
                {p.preOrderAllowed && <p className="text-indigo-300">Pre-Order Enabled</p>}
              </div>
            ))}
          </div>
        )}

        {/* 5. CUSTOMERS & LEADS (§20, §33, §49) */}
        {activeTab === "customers" && (
          <div className="space-y-3">
            {(dashboard?.customers || []).length > 0 ? (
              dashboard.customers.map((lead: any) => (
                <div
                  key={lead.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs"
                >
                  <div>
                    <p className="font-semibold text-white">
                      {lead.customerName || "Customer"} {lead.customerPhone ? `(${lead.customerPhone})` : ""}
                    </p>
                    <p className="text-slate-300">{lead.summary}</p>
                  </div>
                  <span className="rounded bg-emerald-500/20 px-2.5 py-1 font-semibold text-emerald-300">
                    {lead.classification}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-300">No transactional leads captured yet.</p>
            )}
          </div>
        )}

        {/* 6. KNOWLEDGE, UNANSWERED QUESTIONS & DEMAND INTELLIGENCE (§7, §35, §36) */}
        {activeTab === "knowledge" && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Unanswered Questions -> Approve into Business Brain (§35) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white">
                Unanswered Customer Questions (Approve into Business Brain)
              </h2>
              {(dashboard?.knowledge?.unansweredQuestions || []).length > 0 ? (
                dashboard.knowledge.unansweredQuestions.map((uq: any) => (
                  <div key={uq.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="font-medium text-white">{uq.question}</span>
                      <span className="text-slate-300">Asked {uq.askedCount}x</span>
                    </div>
                    {uq.isResolved ? (
                      <p className="text-emerald-300">Approved Answer: {uq.approvedAnswer}</p>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={answerDrafts[uq.id] || ""}
                          onChange={(e) =>
                            setAnswerDrafts((prev) => ({ ...prev, [uq.id]: e.target.value }))
                          }
                          placeholder="Write authoritative answer..."
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleApproveAnswer(uq.id)}
                          className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                        >
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-300">No unanswered questions pending review.</p>
              )}
            </div>

            {/* Missed-Demand Intelligence & Knowledge Conflicts (§7, §36) */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                <h2 className="text-sm font-semibold text-white">Missed-Demand Intelligence</h2>
                {(dashboard?.knowledge?.demandInsights || []).length > 0 ? (
                  dashboard.knowledge.demandInsights.map((d: any) => (
                    <div key={d.id} className="flex justify-between border-b border-slate-800 pb-1.5 text-xs">
                      <span className="text-slate-200">
                        [{d.insightType}] {d.subject}
                      </span>
                      <span className="font-semibold text-amber-300">{d.count} requests</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-300">No missed-demand signals recorded yet.</p>
                )}
              </div>

              {(dashboard?.knowledge?.conflicts || []).length > 0 && (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
                  <h2 className="text-sm font-semibold text-amber-200">
                    Knowledge Conflicts Detected (Structured Data Wins)
                  </h2>
                  {dashboard.knowledge.conflicts.map((c: any, idx: number) => (
                    <p key={idx} className="text-xs text-amber-100">
                      {c.productName} ({c.field}): Catalogue is <strong>{c.structuredValue}</strong>, but document &ldquo;
                      {c.sourceTitle}&rdquo; says <strong>{c.conflictingValue}</strong>.
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 7. OWNER "ASK MY BOT" TESTING CONSOLE (§28, §29) */}
        {activeTab === "ask_my_bot" && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                Owner &ldquo;Ask My Bot&rdquo; Diagnostic Console (Isolated Preview Mode)
              </h2>
              <p className="text-xs text-slate-300">
                Test customer questions safely. Shows operational diagnostics (information found, missing info, configuration recommendations) without exposing internal chain-of-thought.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {PREVIEW_TEST_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => {
                    setBotQuestion(question);
                  }}
                  className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs text-emerald-200"
                >
                  {question}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              Answers come from this business&apos;s saved products, prices, zones, payment instructions and rules. Follow-up questions stay in the same preview conversation.
            </p>

            <form onSubmit={handleAskMyBot} className="flex gap-2">
              <input
                type="text"
                value={botQuestion}
                onChange={(e) => setBotQuestion(e.target.value)}
                placeholder="Ask a customer question using this business's configured products and zones"
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
              />
              <button
                type="submit"
                disabled={botTesting || !botQuestion.trim()}
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {botTesting ? "Testing..." : "Test Bot"}
              </button>
            </form>

            {botResult && (
              <div className="grid gap-4 lg:grid-cols-2 pt-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-emerald-300">AI Response ({botResult.responseType})</span>
                    <span className="text-slate-300">
                      Source: {botResult.source} • Confidence: {botResult.confidence}
                    </span>
                  </div>
                  <p className="text-sm text-white">{botResult.reply}</p>
                </div>

                {botResult.diagnostics && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs">
                    <h3 className="font-semibold text-white">Operational Diagnostics</h3>
                    <p className="text-emerald-300">
                      <strong>Information Found:</strong>{" "}
                      {botResult.diagnostics.informationFound.join("; ") || "None"}
                    </p>
                    <p className="text-amber-300">
                      <strong>Information Not Found:</strong>{" "}
                      {botResult.diagnostics.informationNotFound.join("; ") || "None"}
                    </p>
                    <p className="text-slate-200">
                      <strong>Missing Business Configuration:</strong>{" "}
                      {botResult.diagnostics.missingInformation.join(" ") || "None"}
                    </p>
                    <p className="text-indigo-300">
                      <strong>How to Improve Configuration:</strong>{" "}
                      {botResult.diagnostics.configurationImprovement.join(" ") || "Configuration looks complete."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
