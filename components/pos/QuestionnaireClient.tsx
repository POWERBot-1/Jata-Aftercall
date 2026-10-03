"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { QuestionnaireView, SerializedQuestion } from "@/lib/pos/questionnaireView";
import type { AnswerValue, QuestionnaireAnswers } from "@/lib/pos/types";
import type { Terminology } from "@/lib/pos/terminology";
import type { SummaryGroup } from "@/lib/pos/configuration";
import type { ReadinessIssue } from "@/lib/pos/questionnaire";

/**
 * The adaptive questionnaire (§9, §40, §41, §42, §43).
 *
 * One question at a time, in plain language, on a phone. The server decides which questions
 * exist for the answers given so far; this component only renders them, collects the answer and
 * autosaves. Nothing about a business type is branched on here — the same screen asks a bakery
 * about bakes and a garage about job cards, because that is what the server sent.
 */

type Props = {
  businessId: string;
  basePath: string;
  view: QuestionnaireView;
  answers: QuestionnaireAnswers;
  summary: SummaryGroup[];
  headline: string;
  description: string[];
  terminology: Terminology;
  wordsEditable: boolean;
  ready: boolean;
  missing: ReadinessIssue[];
  status: string;
  lifecycleLabel: string;
  entitled: boolean;
  publishedVersion: number;
  draftVersion: number;
};

const WORD_KEYS: { key: keyof Terminology; label: string }[] = [
  { key: "customers", label: "The people who buy from you" },
  { key: "customer", label: "One of them" },
  { key: "products", label: "What you sell (plural)" },
  { key: "product", label: "One of them" },
  { key: "orders", label: "Work that comes in (plural)" },
  { key: "order", label: "One of them" },
  { key: "sales", label: "A completed sale (plural)" },
  { key: "sale", label: "One of them" },
  { key: "suppliers", label: "The people you buy from" },
  { key: "staff", label: "Your team" },
  { key: "stock", label: "What you keep" },
];

export function QuestionnaireClient(props: Props) {
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(props.answers);
  const [view, setView] = useState<QuestionnaireView>(props.view);
  const [summary, setSummary] = useState<SummaryGroup[]>(props.summary);
  const [description, setDescription] = useState<string[]>(props.description);
  const [terminology, setTerminology] = useState<Terminology>(props.terminology);
  const [missing, setMissing] = useState<ReadinessIssue[]>(props.missing);
  const [ready, setReady] = useState(props.ready);
  const [draftVersion, setDraftVersion] = useState(props.draftVersion);

  const [currentId, setCurrentId] = useState<string | null>(props.view.nextId ?? props.view.questions[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [editingWords, setEditingWords] = useState(false);
  const [words, setWords] = useState<Record<string, string>>({});

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  const position = Math.max(0, view.questions.findIndex((question) => question.id === currentId));
  const current: SerializedQuestion | null = view.questions[position] ?? null;
  const nextQuestion = view.questions[position + 1] ?? null;
  const previousQuestion = position > 0 ? view.questions[position - 1] : null;
  const finished = !current || (current.answered && !nextQuestion);

  // A question can disappear when an earlier answer changes (§40). Never strand the owner.
  useEffect(() => {
    if (currentId && !view.questions.some((question) => question.id === currentId)) {
      setCurrentId(view.nextId ?? view.questions[0]?.id ?? null);
    }
  }, [view, currentId]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const send = useMemo(
    () => async (nextAnswers: QuestionnaireAnswers, nextWords?: Record<string, string>) => {
      if (inflight.current) return;
      inflight.current = true;
      setSaving(true);
      setError(null);
      try {
        const response = await fetch(`/api/pos/${encodeURIComponent(props.businessId)}/configuration`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(nextWords && Object.keys(nextWords).length ? { answers: nextAnswers, terminology: nextWords } : { answers: nextAnswers }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data?.error ?? "We couldn't save that answer. Please try again.");
          return;
        }
        setAnswers(data.view ? nextAnswers : nextAnswers);
        if (data.view) setView(data.view);
        if (data.summary) setSummary(data.summary);
        if (data.description) setDescription(data.description);
        if (data.terminology) setTerminology(data.terminology);
        if (data.readiness) {
          setReady(Boolean(data.readiness.ready));
          setMissing(data.readiness.missing ?? []);
        }
        if (data.draftVersion) setDraftVersion(data.draftVersion);
        setSavedLabel(new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }));
      } catch {
        setError("We couldn't reach JATA. Check your connection — your answer is still on this screen.");
      } finally {
        inflight.current = false;
        setSaving(false);
      }
    },
    [props.businessId],
  );

  function commit(nextAnswers: QuestionnaireAnswers, immediate: boolean) {
    setAnswers(nextAnswers);
    if (timer.current) clearTimeout(timer.current);
    if (immediate) {
      void send(nextAnswers);
      return;
    }
    timer.current = setTimeout(() => void send(nextAnswers), 600);
  }

  function setAnswer(question: SerializedQuestion, value: AnswerValue, immediate = true) {
    const next: QuestionnaireAnswers = { ...answers, [question.id]: value };
    commit(next, immediate);
    setCustomOpen(false);
    if (immediate && nextQuestion) setCurrentId(nextQuestion.id);
  }

  function toggleMulti(question: SerializedQuestion, optionId: string) {
    const currentValues = Array.isArray(answers[question.id]) ? (answers[question.id] as string[]) : [];
    const nextValues = currentValues.includes(optionId)
      ? currentValues.filter((entry) => entry !== optionId)
      : [...currentValues, optionId];
    setAnswer(question, nextValues, false);
  }

  function saveWords() {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(words)) {
      const text = String(value ?? "").trim();
      if (text) clean[key] = text.slice(0, 40);
    }
    setEditingWords(false);
    void send(answers, clean);
  }

  const selectedValues = current && Array.isArray(current.value) ? (current.value as string[]) : [];
  const currentValue = current?.value;

  return (
    <div className="pos-ask">
      <div>
        <div className="pos-toolbar">
          <p className="jata-kicker">
            {current ? current.sectionLabel : "Your setup"} · {view.progress.answered} of {view.progress.asked} answered
          </p>
          <p className="pos-note" aria-live="polite">
            {saving ? "Saving…" : savedLabel ? `Saved at ${savedLabel}` : "Answers save as you go"}
          </p>
        </div>
        <div className="pos-progress" role="progressbar" aria-valuenow={view.progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${Math.min(100, Math.max(4, view.progress.percent))}%` }} />
        </div>
      </div>

      {error ? (
        <p className="jata-error" role="alert">{error}</p>
      ) : null}

      {current && !finished ? (
        <section className="jata-card p-5">
          <h2 className="pos-question">{current.title}</h2>
          {current.help ? <p className="pos-help">{current.help}</p> : null}

          <div className="mt-4">
            {current.kind === "yesno" ? (
              <div className="pos-options">
                <button type="button" className="pos-option" data-selected={currentValue === true} onClick={() => setAnswer(current, true)}>
                  <strong>Yes</strong>
                </button>
                <button type="button" className="pos-option" data-selected={currentValue === false} onClick={() => setAnswer(current, false)}>
                  <strong>No</strong>
                </button>
              </div>
            ) : null}

            {current.kind === "choice" ? (
              <div className="pos-options">
                {(current.options ?? []).map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className="pos-option"
                    data-selected={currentValue === option.id}
                    onClick={() => setAnswer(current, option.id)}
                  >
                    <strong>{option.icon ? `${option.icon} ` : ""}{option.label}</strong>
                    {option.hint ? <small>{option.hint}</small> : null}
                  </button>
                ))}
                {current.allowCustom ? (
                  <button
                    type="button"
                    className="pos-option"
                    data-selected={customOpen || (typeof currentValue === "string" && !(current.options ?? []).some((option) => option.id === currentValue))}
                    onClick={() => setCustomOpen((open) => !open)}
                  >
                    <strong>{current.customLabel ?? "Something else"}</strong>
                    <small>Describe it in your own words</small>
                  </button>
                ) : null}
              </div>
            ) : null}

            {current.kind === "multi" ? (
              <>
                <div className="pos-options">
                  {(current.options ?? []).map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className="pos-option"
                      data-selected={selectedValues.includes(option.id)}
                      aria-pressed={selectedValues.includes(option.id)}
                      onClick={() => toggleMulti(current, option.id)}
                    >
                      <strong>{option.icon ? `${option.icon} ` : ""}{option.label}</strong>
                      {option.hint ? <small>{option.hint}</small> : null}
                    </button>
                  ))}
                </div>
                <div className="pos-form-actions mt-3">
                  <button type="button" className="jata-btn jata-btn-primary" onClick={() => void send(answers)}>
                    Done — continue
                  </button>
                </div>
              </>
            ) : null}

            {current.kind === "text" || current.kind === "number" || current.kind === "amount" ? (
              <div className="jata-field">
                <label className="jata-label" htmlFor={`q-${current.id}`}>
                  {current.kind === "amount" ? "Amount in Kenyan shillings" : current.kind === "number" ? `Number${current.unit ? ` (${current.unit})` : ""}` : "Your answer"}
                </label>
                <input
                  id={`q-${current.id}`}
                  className="jata-input"
                  type={current.kind === "text" ? "text" : "number"}
                  inputMode={current.kind === "text" ? "text" : "numeric"}
                  min={current.kind === "number" || current.kind === "amount" ? current.min ?? 0 : undefined}
                  max={current.kind === "number" || current.kind === "amount" ? current.max : undefined}
                  step={current.step}
                  placeholder={current.placeholder}
                  defaultValue={currentValue === undefined || currentValue === null ? "" : String(currentValue)}
                  onBlur={(event) => {
                    const raw = event.target.value.trim();
                    const value: AnswerValue = current.kind === "text"
                      ? raw
                      : raw === ""
                        ? ""
                        : Number(raw);
                    setAnswer(current, value, true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  }}
                />
                {current.help ? <p className="jata-hint">{current.help}</p> : null}
              </div>
            ) : null}

            {current.allowCustom && (customOpen || (typeof currentValue === "string" && currentValue !== "" && !(current.options ?? []).some((option) => option.id === currentValue))) ? (
              <div className="jata-field mt-3">
                <label className="jata-label" htmlFor={`q-${current.id}-custom`}>{current.customLabel ?? "Describe your business"}</label>
                <input
                  id={`q-${current.id}-custom`}
                  className="jata-input"
                  type="text"
                  placeholder={current.id === "business_type" ? "e.g. Water pump repairs" : current.placeholder}
                  defaultValue={typeof currentValue === "string" && !(current.options ?? []).some((option) => option.id === currentValue) ? currentValue : ""}
                  onBlur={(event) => setAnswer(current, event.target.value.trim(), true)}
                />
                <p className="jata-hint">JATA reads this to choose the right features for you.</p>
              </div>
            ) : null}
          </div>

          <div className="pos-form-actions mt-5">
            {previousQuestion ? (
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setCurrentId(previousQuestion.id)}>
                ← Back
              </button>
            ) : null}
            <button
              type="button"
              className="jata-btn jata-btn-secondary"
              onClick={() => {
                if (!current.answered && current.defaultValue !== undefined) setAnswer(current, current.defaultValue, true);
                else if (nextQuestion) setCurrentId(nextQuestion.id);
                else void send(answers);
              }}
            >
              {nextQuestion ? "Skip for now →" : "Finish →"}
            </button>
          </div>
        </section>
      ) : null}

      {ready || finished ? (
        <section className="jata-card p-5">
          <p className="jata-kicker">We&apos;ve configured your POS</p>
          <h2 className="text-lg font-bold">{props.headline}</h2>
          <ul className="mt-3 grid gap-1.5">
            {description.map((line) => (
              <li key={line} className="flex gap-2 text-sm">
                <span aria-hidden="true">✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          <div className="pos-summary mt-4">
            {summary.map((group) => (
              <div className="pos-summary-group" key={group.label}>
                <h3>{group.label}</h3>
                <dl>
                  <dd>{group.value}</dd>
                </dl>
              </div>
            ))}
          </div>

          {missing.length > 0 ? (
            <div className="mt-4">
              <p className="pos-note">Still to answer:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {missing.map((issue) => (
                  <button key={issue.questionId} type="button" className="pos-chip" onClick={() => setCurrentId(issue.questionId)}>
                    {issue.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="pos-form-actions mt-5">
            <Link href={`${props.basePath}/preview`} className="jata-btn jata-btn-secondary">Preview your POS</Link>
            {props.entitled ? (
              <Link href={`${props.basePath}/settings`} className="jata-btn jata-btn-primary">Publish changes</Link>
            ) : (
              <Link href={`${props.basePath}/plan`} className="jata-btn jata-btn-primary">Choose plan</Link>
            )}
            {props.wordsEditable ? (
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => { setEditingWords((open) => !open); setWords({}); }}>
                {editingWords ? "Close words" : "Use your own words"}
              </button>
            ) : null}
          </div>
          <p className="pos-note mt-3">
            Saved as draft version {draftVersion}. {props.publishedVersion > 0 ? `Version ${props.publishedVersion} is what your POS is running.` : "Nothing is live yet."}
          </p>
        </section>
      ) : null}

      {editingWords ? (
        <section className="jata-card p-5">
          <p className="jata-kicker">Your words</p>
          <h2 className="text-lg font-semibold">Call things whatever you like</h2>
          <p className="pos-help">These words replace ours everywhere in your POS. Nothing else changes.</p>
          <div className="pos-grid-2 mt-4">
            {WORD_KEYS.map((entry) => (
              <div className="jata-field" key={entry.key}>
                <label className="jata-label" htmlFor={`word-${entry.key}`}>{entry.label}</label>
                <input
                  id={`word-${entry.key}`}
                  className="jata-input"
                  type="text"
                  maxLength={40}
                  placeholder={terminology[entry.key]}
                  defaultValue={words[entry.key] ?? ""}
                  onChange={(event) => setWords((current) => ({ ...current, [entry.key]: event.target.value }))}
                />
                <p className="jata-hint">Now: {terminology[entry.key]}</p>
              </div>
            ))}
          </div>
          <div className="pos-form-actions mt-4">
            <button type="button" className="jata-btn jata-btn-primary" onClick={saveWords} disabled={saving}>Save words</button>
            <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setEditingWords(false)}>Cancel</button>
          </div>
        </section>
      ) : null}

      <section className="jata-card p-5">
        <div className="pos-toolbar">
          <div>
            <p className="jata-kicker">Your answers</p>
            <h2 className="text-base font-semibold">Change anything, any time</h2>
          </div>
          <span className="jata-status">{props.lifecycleLabel}</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {view.sections.map((section) => (
            <div key={section.key}>
              <p className="pos-note font-semibold">{section.label} · {section.answered}/{section.total}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {view.questions
                  .filter((question) => question.section === section.key)
                  .map((question) => (
                    <button
                      key={question.id}
                      type="button"
                      className="pos-chip"
                      data-on={question.answered}
                      onClick={() => setCurrentId(question.id)}
                    >
                      {shortAnswer(question)}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** The chip text: the question in short form plus what was answered (§42). */
function shortAnswer(question: SerializedQuestion): string {
  const value = question.value;
  if (Array.isArray(value)) {
    if (!value.length) return question.title;
    const labels = value
      .map((entry) => question.options?.find((option) => option.id === entry)?.label ?? String(entry))
      .slice(0, 2);
    return `${question.title.split("?")[0]}: ${labels.join(", ")}${value.length > 2 ? ` +${value.length - 2}` : ""}`;
  }
  if (typeof value === "boolean") return `${question.title.split("?")[0]}: ${value ? "Yes" : "No"}`;
  if (typeof value === "number" && value) return `${question.title.split("?")[0]}: ${value}`;
  if (typeof value === "string" && value) {
    const label = question.options?.find((option) => option.id === value)?.label ?? value;
    return `${question.title.split("?")[0]}: ${label}`;
  }
  return question.title;
}
