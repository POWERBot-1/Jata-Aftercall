"use client";

/**
 * Website Studio — integrated prompt-first experience.
 *
 * Describe → understand → generate multiple distinct layouts → compare live previews →
 * refine conversationally or with the inspector → approve/save → publish.
 *
 * The legacy Studio remains available while this replacement is proven; this component
 * never bypasses JATA's draft/published separation, entitlement checks or tenant guards.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Check, Eye, Globe, Loader2, Monitor, RefreshCw, Send, Smartphone,
  Sparkles, Tablet, Undo2, Redo2, Save, UploadCloud, Wand2,
} from "lucide-react";
import { PublishPanel } from "@/components/dashboard/PublishPanel";
import { EntitlementBanner } from "@/components/dashboard/EntitlementBanner";
import { StatusPill } from "@/components/ui/StatusPill";
import { sectionLabel } from "@/lib/experience/sections";
import type { ExperienceDocument } from "@/lib/experience/types";
import type { PublishValidation } from "@/lib/experience/validate";
import type { EntitlementState } from "@/lib/experience/entitlement";
import type { StudioPreviewBase } from "@/lib/openpage/previewData";
import type { StudioCandidate } from "@/lib/openpage/generate";
import type { StudioRequirements } from "@/lib/openpage/requirements";
import { DESIGN_AUDIENCES, DESIGN_DENSITIES, DESIGN_GOALS, DESIGN_PERSONALITIES } from "@/lib/experience/templateFamilies";
import { StudioPreview, type StudioDevice } from "./StudioPreview";
import { StudioLayersPanel } from "./StudioLayers";
import { StudioProperties } from "./StudioProperties";
import { StudioThemePanel } from "./StudioThemePanel";

type ProviderInfo = { key: string; label: string; modelKey?: string | null; usedModel: boolean };
type Message = { id: number; role: "owner" | "studio"; text: string; details?: string[] };

type UnderstandResponse = {
  requirements: StudioRequirements;
  directionNote: string | null;
  provider: ProviderInfo;
  baseDraftVersion: number;
  hasExperience: boolean;
  counts: { products: number; services: number; media: number };
  saved: false;
};

type GenerateResponse = {
  candidates: StudioCandidate[];
  notes: string[];
  distinctCount: number;
  materiallyDistinct: boolean;
  layoutPlan: { id: string; name: string };
  baseDraftVersion: number;
  requirements: StudioRequirements;
  directionNote: string | null;
  provider: ProviderInfo;
  comparedWith: number;
  historyLimitation: string | null;
  reviewPolicy: string;
  saved: false;
};

type RefineResponse = {
  document: ExperienceDocument;
  reply: string;
  changes: string[];
  suggestions: string[];
  reviewNotes: string[];
  changed: boolean;
  intent: string;
  baseDraftVersion: number;
};

export type WebsiteStudioProps = {
  business: { id: string; name: string; slug: string; category: string; isPublished: boolean };
  initialDocument: ExperienceDocument;
  initialDraftVersion: number;
  publishedVersion: number;
  hasExperience: boolean;
  hasUnpublishedChanges: boolean;
  entitlement: EntitlementState;
  validation: PublishValidation;
  previewBase: StudioPreviewBase;
  publicUrl: string;
  examples: readonly string[];
};

function arraysEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.error === "string" ? data.error : "We couldn't complete that request.");
    (error as Error & { code?: string; status?: number }).code = data.code;
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return data as T;
}

const DEVICE_ICON = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const;

export function WebsiteStudio(props: WebsiteStudioProps) {
  const router = useRouter();
  const [stage, setStage] = useState<"describe" | "compare" | "editor">(props.hasExperience ? "editor" : "describe");
  const [prompt, setPrompt] = useState("");
  const [requirements, setRequirements] = useState<StudioRequirements | null>(null);
  const [candidates, setCandidates] = useState<StudioCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [workingDocument, setWorkingDocument] = useState<ExperienceDocument>(props.initialDocument);
  const [savedDocument, setSavedDocument] = useState<ExperienceDocument>(props.initialDocument);
  const [draftVersion, setDraftVersion] = useState(props.initialDraftVersion);
  const [busy, setBusy] = useState<"" | "understand" | "generate" | "refine" | "save">("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [directionNote, setDirectionNote] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderInfo>({ key: "jata-local", label: "JATA built-in", usedModel: false });
  const [notes, setNotes] = useState<string[]>([]);
  const [device, setDevice] = useState<StudioDevice>("desktop");
  const [panel, setPanel] = useState<"properties" | "theme">("properties");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(props.initialDocument.sections[0]?.id || null);
  const [undoStack, setUndoStack] = useState<ExperienceDocument[]>([]);
  const [redoStack, setRedoStack] = useState<ExperienceDocument[]>([]);
  const [refineMessage, setRefineMessage] = useState("");
  const [showPublish, setShowPublish] = useState(false);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const messageId = useRef(0);

  const dirty = !arraysEqual(workingDocument, savedDocument);
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) || null;

  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ block: "nearest" });
  }, [conversation.length]);

  function commit(next: ExperienceDocument) {
    setUndoStack((stack) => [...stack.slice(-49), workingDocument]);
    setRedoStack([]);
    setWorkingDocument(next);
    if (!next.sections.some((section) => section.id === selectedSectionId)) {
      setSelectedSectionId(next.sections[0]?.id || null);
    }
  }

  function undo() {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setRedoStack((redo) => [...redo, workingDocument]);
      setWorkingDocument(previous);
      return stack.slice(0, -1);
    });
  }

  function redo() {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((undoEntries) => [...undoEntries, workingDocument]);
      setWorkingDocument(next);
      return stack.slice(0, -1);
    });
  }

  function pushMessage(role: Message["role"], text: string, details?: string[]) {
    messageId.current += 1;
    setConversation((entries) => [...entries.slice(-19), { id: messageId.current, role, text, details }]);
  }

  async function understand() {
    if (prompt.trim().length < 8) return setError("Describe your business in at least one sentence.");
    setBusy("understand");
    setError(null);
    setNotice(null);
    try {
      const data = await postJson<UnderstandResponse>("/api/studio/openpage/understand", {
        businessId: props.business.id,
        prompt,
      });
      setRequirements(data.requirements);
      setDirectionNote(data.directionNote);
      setProvider(data.provider);
      setNotice("Requirements understood. Confirm the direction, then generate layouts.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function generate() {
    if (!requirements) return;
    setBusy("generate");
    setError(null);
    setNotice(null);
    try {
      const data = await postJson<GenerateResponse>("/api/studio/openpage/generate", {
        businessId: props.business.id,
        prompt,
        overrides: {
          goal: requirements.goal,
          personality: requirements.personality,
          audience: requirements.audience,
          density: requirements.density,
        },
      });
      setCandidates(data.candidates);
      setSelectedCandidateId(data.candidates[0]?.id || null);
      setRequirements(data.requirements);
      setNotes(data.notes);
      setDirectionNote(data.directionNote);
      setProvider(data.provider);
      setStage("compare");
      if (data.candidates.length === 0) setError("No distinct layout could be generated from this brief. Try describing the business differently.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  function applyCandidate(candidate: StudioCandidate) {
    commit(candidate.document);
    setSelectedCandidateId(candidate.id);
    setStage("editor");
    setShowPublish(false);
    pushMessage("studio", `Using the ${candidate.label} layout. Nothing is live until you save and publish.`, candidate.notes);
  }

  async function refine() {
    const message = refineMessage.trim();
    if (!message) return;
    setBusy("refine");
    setError(null);
    setNotice(null);
    pushMessage("owner", message);
    setRefineMessage("");
    try {
      const data = await postJson<RefineResponse>("/api/studio/openpage/refine", {
        businessId: props.business.id,
        message,
        prompt: prompt || undefined,
        requirements: requirements || undefined,
        document: workingDocument,
      });
      if (data.changed) commit(data.document);
      pushMessage("studio", data.reply, [...data.changes, ...data.reviewNotes]);
    } catch (caught) {
      const messageText = (caught as Error).message;
      setError(messageText);
      pushMessage("studio", messageText);
    } finally {
      setBusy("");
    }
  }

  async function saveDraft() {
    if (!dirty) {
      setNotice("Everything is already saved.");
      return;
    }
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/experience", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: props.business.id, document: workingDocument, expectedDraftVersion: draftVersion }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.code === "draft_version_conflict") {
          setError("Your website changed in another window, so this version was not saved. Reload to see the latest draft. Nothing was overwritten.");
          return;
        }
        setError(data.error || "We couldn't save this draft.");
        return;
      }
      const nextDocument = (data.document || workingDocument) as ExperienceDocument;
      setWorkingDocument(nextDocument);
      setSavedDocument(nextDocument);
      if (typeof data.experience?.draftVersion === "number") setDraftVersion(data.experience.draftVersion);
      setUndoStack([]);
      setRedoStack([]);
      setNotice(`Draft saved (version ${data.experience?.draftVersion ?? draftVersion + 1}). Customers still see version ${props.publishedVersion}.`);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Your draft was not saved.");
    } finally {
      setBusy("");
    }
  }

  function updateRequirement<K extends keyof Pick<StudioRequirements, "goal" | "personality" | "audience" | "density">>(key: K, value: StudioRequirements[K]) {
    setRequirements((current) => (current ? { ...current, [key]: value } : current));
  }

  const previewScale = device === "desktop" ? 0.48 : device === "tablet" ? 0.72 : 1;
  const thumbnailScale = device === "desktop" ? 0.27 : device === "tablet" ? 0.4 : 0.84;

  const publishChecks = useMemo(() => props.validation.checks, [props.validation]);
  const publishReady = props.validation.ready && !dirty;

  return (
    <div className="ws-stack">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="jata-kicker">Website Studio</p>
          <h1 className="text-xl font-bold">{props.business.name}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Describe the business. JATA generates distinct layouts, then you compare, refine and publish.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={props.business.isPublished ? "success" : "neutral"} icon={<Globe size={11} />}>
            {props.business.isPublished ? "Live" : "Draft"}
          </StatusPill>
          <StatusPill tone="neutral">Draft v{draftVersion}</StatusPill>
          {dirty || props.hasUnpublishedChanges ? <StatusPill tone="warning">Unpublished changes</StatusPill> : null}
          <a className="jata-btn jata-btn-secondary" href={props.publicUrl} target="_blank" rel="noopener noreferrer">
            <Eye size={14} /> View site
          </a>
          <Link className="jata-btn jata-btn-ghost" href={`/dashboard/businesses/${props.business.id}`}>
            Classic editor
          </Link>
        </div>
      </header>

      <EntitlementBanner businessId={props.business.id} entitlement={props.entitlement} isPublished={props.business.isPublished} />

      {error ? <p className="jata-error rounded-xl border border-red-200 bg-red-50 p-3 text-sm" role="alert">{error}</p> : null}
      {notice ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</p> : null}

      {stage === "describe" ? (
        <section className="jata-card" aria-label="Describe your business">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">What should this website do?</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Write it the way you would explain it to a designer. JATA reads it, states what it understood, then builds three genuinely different layouts.
              </p>
            </div>
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Sparkles size={14} /> {provider.label}{provider.usedModel ? " · model assisted" : " · deterministic"}
            </span>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold">Your brief</span>
            <textarea
              className="jata-input mt-1 min-h-32 w-full"
              maxLength={1200}
              placeholder="e.g. A warm nyama choma spot in Kitengela. Show the menu first, let people order on WhatsApp, and make it obvious we are open late."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={busy !== ""}
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {props.examples.map((example) => (
              <button
                key={example}
                type="button"
                className="rounded-full border border-[color:var(--ws-line)] px-2.5 py-1 text-left text-[11px] hover:border-[color:var(--ws-ink)]"
                onClick={() => setPrompt(example)}
                disabled={busy !== ""}
              >
                {example.length > 72 ? `${example.slice(0, 72)}…` : example}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="jata-btn jata-btn-primary" onClick={() => void understand()} disabled={busy !== "" || prompt.trim().length < 8}>
              {busy === "understand" ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Understand my business
            </button>
            {requirements ? (
              <button type="button" className="jata-btn jata-btn-secondary" onClick={() => void generate()} disabled={busy !== ""}>
                {busy === "generate" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Generate 3 layouts
              </button>
            ) : null}
            {props.hasExperience ? (
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setStage("editor")} disabled={busy !== ""}>
                <ArrowLeft size={14} /> Back to current draft
              </button>
            ) : null}
          </div>

          {requirements ? (
            <div className="mt-5 rounded-2xl border border-[color:var(--ws-line)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold">What JATA understood</h3>
                  <p className="mt-1 text-sm text-zinc-600">{requirements.summary}</p>
                </div>
                <StatusPill tone={requirements.confidence === "high" ? "success" : requirements.confidence === "medium" ? "warning" : "neutral"}>
                  {requirements.confidence} confidence
                </StatusPill>
              </div>

              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold text-zinc-500">Business type</dt>
                  <dd>{requirements.businessType.label}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-zinc-500">Layout plan</dt>
                  <dd>{requirements.plan.name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-zinc-500">Sections requested</dt>
                  <dd>{requirements.requestedSections.length > 0 ? requirements.requestedSections.map(sectionLabel).join(", ") : "The category defaults"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-zinc-500">Customer goal</dt>
                  <dd>{requirements.goal}</dd>
                </div>
              </dl>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-xs font-semibold">
                  Goal
                  <select className="jata-input mt-1 w-full text-sm" value={requirements.goal} onChange={(event) => updateRequirement("goal", event.target.value as StudioRequirements["goal"])}>
                    {DESIGN_GOALS.map((goal) => <option key={goal} value={goal}>{goal}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold">
                  Personality
                  <select className="jata-input mt-1 w-full text-sm" value={requirements.personality} onChange={(event) => updateRequirement("personality", event.target.value as StudioRequirements["personality"])}>
                    {DESIGN_PERSONALITIES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold">
                  Audience
                  <select className="jata-input mt-1 w-full text-sm" value={requirements.audience} onChange={(event) => updateRequirement("audience", event.target.value as StudioRequirements["audience"])}>
                    {DESIGN_AUDIENCES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold">
                  Density
                  <select className="jata-input mt-1 w-full text-sm" value={requirements.density} onChange={(event) => updateRequirement("density", event.target.value as StudioRequirements["density"])}>
                    {DESIGN_DENSITIES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>

              {directionNote ? <p className="mt-3 rounded-xl bg-[color:var(--ws-paper)] p-2.5 text-xs text-zinc-600">Art direction note: {directionNote}</p> : null}

              {requirements.missingInfo.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">What is still missing</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-600">
                    {requirements.missingInfo.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              ) : null}
              <div className="mt-3">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Protected facts</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-600">
                  {requirements.guardrails.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {stage === "compare" ? (
        <section className="space-y-3" aria-label="Compare generated layouts">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">Three ways this business could look</h2>
              <p className="text-sm text-zinc-600">
                {candidates.length} live preview{candidates.length === 1 ? "" : "s"} · {requirements?.plan.name || "layout"} plan · compared with {notes.length > 0 ? "your draft and these candidates" : "your draft"}.
                Nothing is saved or live.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {(["mobile", "tablet", "desktop"] as StudioDevice[]).map((value) => {
                const Icon = DEVICE_ICON[value];
                return (
                  <button key={value} type="button" className={`jata-btn ${device === value ? "jata-btn-primary" : "jata-btn-secondary"} !px-2`} aria-pressed={device === value} onClick={() => setDevice(value)}>
                    <Icon size={14} /> <span className="sr-only">{value}</span>
                  </button>
                );
              })}
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setStage("describe")} disabled={busy !== ""}>
                <ArrowLeft size={14} /> Change brief
              </button>
              <button type="button" className="jata-btn jata-btn-secondary" onClick={() => void generate()} disabled={busy !== ""}>
                {busy === "generate" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Regenerate
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {candidates.map((candidate) => {
              const selected = candidate.id === selectedCandidateId;
              return (
                <article key={candidate.id} className={`jata-card ${selected ? "ring-2 ring-[color:var(--ws-ink)]" : ""}`} aria-label={`${candidate.label} layout`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold">{candidate.label}</h3>
                      <p className="text-[11px] text-zinc-500">{candidate.summary}</p>
                    </div>
                    {selected ? <StatusPill tone="success" icon={<Check size={11} />}>Selected</StatusPill> : null}
                  </div>
                  <div className="mt-2">
                    <StudioPreview
                      base={props.previewBase}
                      document={candidate.document}
                      device={device}
                      scale={thumbnailScale}
                      height={420}
                      scroll={false}
                      label={`${candidate.label} live preview`}
                    />
                  </div>
                  <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-600">
                    {candidate.why.slice(0, 3).map((reason) => <li key={reason}>• {reason}</li>)}
                    <li>• Structure similarity to other options: {Math.round(candidate.similarityToOthers * 100)}%</li>
                    {candidate.mapping.unsupported > 0 ? <li>• {candidate.mapping.unsupported} OpenPage element(s) explicitly not imported</li> : null}
                  </ul>
                  {candidate.mapping.notices.some((notice) => notice.severity === "warning") ? (
                    <details className="mt-2 text-[11px] text-zinc-600">
                      <summary className="cursor-pointer font-semibold">What was not imported, and why</summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {candidate.mapping.notices.filter((notice) => notice.severity === "warning").map((notice, index) => (
                          <li key={`${notice.code}-${notice.blockId || index}`}>{notice.message}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="jata-btn jata-btn-primary" onClick={() => applyCandidate(candidate)}>
                      Use this layout
                    </button>
                    <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setSelectedCandidateId(candidate.id)} aria-pressed={selected}>
                      Select for comparison
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {notes.length > 0 ? (
            <ul className="rounded-xl border border-[color:var(--ws-line)] p-3 text-xs text-zinc-600">
              {notes.map((entry) => <li key={entry}>• {entry}</li>)}
            </ul>
          ) : null}
          <p className="text-xs text-zinc-500">
            Generated websites use your JATA Experience schema and are rendered by the same storefront components customers see. Prices, stock, contact details and opening hours come from your business records and are never generated.
          </p>
        </section>
      ) : null}

      {stage === "editor" ? (
        <>
          <section className="jata-card" aria-label="Refine your website">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold">Refine conversationally</h2>
                <p className="text-xs text-zinc-600">Preview only. Save when you are happy; publish when you are ready.</p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" className="jata-btn jata-btn-ghost !px-2" onClick={undo} disabled={undoStack.length === 0 || busy !== ""} aria-label="Undo"><Undo2 size={14} /></button>
                <button type="button" className="jata-btn jata-btn-ghost !px-2" onClick={redo} disabled={redoStack.length === 0 || busy !== ""} aria-label="Redo"><Redo2 size={14} /></button>
                <button type="button" className="jata-btn jata-btn-secondary" onClick={() => { setPrompt(prompt); setStage("describe"); }} disabled={busy !== ""}>
                  <Sparkles size={14} /> Generate new layouts
                </button>
                <button type="button" className="jata-btn jata-btn-primary" onClick={() => void saveDraft()} disabled={busy !== "" || !dirty}>
                  {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {dirty ? "Approve & save draft" : "Draft saved"}
                </button>
                <button type="button" className="jata-btn jata-btn-secondary" onClick={() => setShowPublish((value) => !value)} aria-expanded={showPublish}>
                  <UploadCloud size={14} /> Publish
                </button>
              </div>
            </div>

            {conversation.length > 0 ? (
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-[color:var(--ws-line)] p-2" aria-live="polite">
                {conversation.map((message) => (
                  <div key={message.id} className={`rounded-lg p-2 text-xs ${message.role === "owner" ? "bg-[color:var(--ws-paper)]" : ""}`}>
                    <p className="font-semibold">{message.role === "owner" ? "You" : "Website Studio"}</p>
                    <p className="text-zinc-600">{message.text}</p>
                    {message.details && message.details.length > 0 ? (
                      <ul className="mt-1 list-disc pl-4 text-[11px] text-zinc-500">
                        {message.details.map((detail) => <li key={detail}>{detail}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ))}
                <div ref={conversationEnd} />
              </div>
            ) : null}

            <div className="mt-2 flex gap-2">
              <input
                className="jata-input min-w-0 flex-1 text-sm"
                placeholder="e.g. Make it more premium, put the menu first, hide the gallery, use a darker theme"
                value={refineMessage}
                onChange={(event) => setRefineMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void refine();
                  }
                }}
                maxLength={800}
                disabled={busy !== ""}
              />
              <button type="button" className="jata-btn jata-btn-primary" onClick={() => void refine()} disabled={busy !== "" || !refineMessage.trim()}>
                {busy === "refine" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(selectedCandidate?.layoutPlan ? ["Make it more premium", "Make it shorter and clearer", "Put the menu first", "Show my gallery", "Use a darker theme"] : ["Make it more premium", "Make it shorter and clearer", "Show my gallery"]).map((suggestion) => (
                <button key={suggestion} type="button" className="rounded-full border border-[color:var(--ws-line)] px-2 py-0.5 text-[11px]" onClick={() => setRefineMessage(suggestion)} disabled={busy !== ""}>
                  {suggestion}
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
            <aside className="jata-card min-h-0 p-2" aria-label="Website sections">
              <StudioLayersPanel
                document={workingDocument}
                selectedId={selectedSectionId}
                onSelect={setSelectedSectionId}
                onChange={commit}
                disabled={busy !== ""}
              />
            </aside>

            <section className="jata-card min-w-0 p-2" aria-label="Live preview">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1">
                  {(["mobile", "tablet", "desktop"] as StudioDevice[]).map((value) => {
                    const Icon = DEVICE_ICON[value];
                    return (
                      <button key={value} type="button" className={`jata-btn ${device === value ? "jata-btn-primary" : "jata-btn-secondary"} !px-2 !py-1`} aria-pressed={device === value} onClick={() => setDevice(value)} title={value}>
                        <Icon size={13} /> <span className="sr-only">{value}</span>
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] text-zinc-500">
                  {dirty ? "Unsaved preview — save to keep these changes" : `Saved draft v${draftVersion}`}
                </span>
              </div>
              <StudioPreview
                base={props.previewBase}
                document={workingDocument}
                device={device}
                scale={previewScale}
                height={680}
                scroll
                fit
                label="Your website draft preview"
              />
              <p className="mt-2 px-1 text-[11px] text-zinc-500">
                Preview links are disabled. Use <a className="underline" href={`/dashboard/businesses/${props.business.id}/preview`}>the full preview</a> to test navigation, or <a className="underline" href={`/b/${props.business.slug}?preview=draft`} target="_blank" rel="noopener noreferrer">open the saved draft</a> in a new tab.
              </p>
            </section>

            <aside className="jata-card min-h-0 p-2" aria-label="Section properties">
              <div className="mb-2 flex gap-1">
                <button type="button" className={`jata-btn ${panel === "properties" ? "jata-btn-primary" : "jata-btn-secondary"} !px-2 !py-1 text-xs`} onClick={() => setPanel("properties")} aria-pressed={panel === "properties"}>Properties</button>
                <button type="button" className={`jata-btn ${panel === "theme" ? "jata-btn-primary" : "jata-btn-secondary"} !px-2 !py-1 text-xs`} onClick={() => setPanel("theme")} aria-pressed={panel === "theme"}>Theme</button>
              </div>
              {panel === "properties" ? (
                <StudioProperties document={workingDocument} sectionId={selectedSectionId} onChange={commit} disabled={busy !== ""} />
              ) : (
                <StudioThemePanel document={workingDocument} onChange={commit} disabled={busy !== ""} />
              )}
            </aside>
          </div>

          {showPublish ? (
            <section className="space-y-3" aria-label="Publish your website">
              {dirty ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
                  You have unsaved changes. Save the draft first; publishing always publishes the exact version you reviewed.
                  <button type="button" className="ml-2 font-semibold underline" onClick={() => void saveDraft()} disabled={busy !== ""}>Save now</button>
                </p>
              ) : (
                <PublishPanel
                  businessId={props.business.id}
                  ready={publishReady}
                  checks={publishChecks}
                  published={props.business.isPublished}
                  draftVersion={draftVersion}
                  publishedVersion={props.publishedVersion}
                  hasUnpublishedChanges={dirty || props.hasUnpublishedChanges}
                  entitled={props.entitlement.entitled}
                  publicUrl={props.publicUrl}
                />
              )}
              {!props.entitlement.entitled ? (
                <p className="text-sm text-zinc-600">
                  Your content is safe. Publishing requires an active Website Studio plan (KES 999 per 30 days); generation and saving remain available while you decide.
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
