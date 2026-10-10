"use client";

/**
 * Section editor (§16, §51)
 *
 * Owners move, hide, duplicate, edit and add sections — never HTML and never code. Each
 * section type exposes a small field set, so the same editor serves all sixteen categories.
 * Every change is a save to the draft; nothing touches the live site until publish.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExperienceDocument, ExperienceSection } from "@/lib/experience/types";
import { addableSectionsFor, sectionDefinition, sectionLabel, type SectionField } from "@/lib/experience/sections";
import { MediaPicker } from "./MediaPicker";

type SaveState = { tone: "idle" | "saving" | "saved" | "error"; text?: string };

export function SectionEditor({
  businessId,
  document: initial,
  draftVersion,
}: {
  businessId: string;
  document: ExperienceDocument;
  /** The draft version this document was read at. Every change sends it back (409 if the draft has moved on). */
  draftVersion?: number | null;
}) {
  const router = useRouter();
  const [document, setDocument] = useState<ExperienceDocument>(initial);
  const [version, setVersion] = useState<number | null>(draftVersion ?? null);
  // After a refresh the server's document and version replace the local copy, so a conflict never leaves stale sections on screen.
  useEffect(() => setDocument(initial), [initial]);
  useEffect(() => setVersion(draftVersion ?? null), [draftVersion]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>({ tone: "idle" });
  const [addType, setAddType] = useState("");

  const editing = document.sections.find((section) => section.id === editingId) || null;
  const addable = addableSectionsFor(document.categoryKey);

  async function op(payload: Record<string, unknown>) {
    setState({ tone: "saving" });
    try {
      const response = await fetch("/api/experience", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, ...payload, ...(version ? { expectedDraftVersion: version } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState({ tone: "error", text: data.error || "We couldn’t save that change." });
        if (data.code === "draft_version_conflict") router.refresh();
        return false;
      }
      setDocument(data.document as ExperienceDocument);
      if (typeof data.experience?.draftVersion === "number") setVersion(data.experience.draftVersion);
      setState({ tone: "saved" });
      router.refresh();
      return true;
    } catch {
      setState({ tone: "error", text: "We couldn’t reach the server. Please try again." });
      return false;
    }
  }

  function patchSection(sectionId: string, patch: Partial<ExperienceSection>) {
    return op({ op: "update", sectionId, patch });
  }

  return (
    <div className="space-y-4">
      <div className="jata-toolbar">
        <p className="text-sm text-zinc-600">
          {document.sections.filter((section) => section.visible !== false).length} of {document.sections.length} sections
          visible to customers.
        </p>
        <p className="text-sm" role="status" aria-live="polite">
          {state.tone === "saving" ? "Saving…" : state.tone === "saved" ? "Saved ✓" : state.tone === "error" ? "" : ""}
        </p>
      </div>

      {state.tone === "error" ? <p className="jata-error text-sm" role="alert">{state.text}</p> : null}

      <ul className="space-y-2">
        {document.sections.map((section, index) => {
          const definition = sectionDefinition(section.type);
          const hidden = section.visible === false;
          return (
            <li key={section.id} className={`jata-section-row ${hidden ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {sectionLabel(section.type)}
                  {hidden ? <span className="ml-2 text-xs font-normal text-zinc-500">Hidden</span> : null}
                </p>
                {section.title ? <p className="truncate text-xs text-zinc-600">{section.title}</p> : null}
                {definition?.description ? <p className="truncate text-xs text-zinc-500">{definition.description}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button className="jata-icon-btn" aria-label={`Move ${sectionLabel(section.type)} up`} disabled={index === 0} onClick={() => op({ op: "move", sectionId: section.id, direction: "up" })}>↑</button>
                <button className="jata-icon-btn" aria-label={`Move ${sectionLabel(section.type)} down`} disabled={index === document.sections.length - 1} onClick={() => op({ op: "move", sectionId: section.id, direction: "down" })}>↓</button>
                <button className="jata-icon-btn" aria-label={hidden ? `Show ${sectionLabel(section.type)}` : `Hide ${sectionLabel(section.type)}`} aria-pressed={!hidden} onClick={() => op({ op: "toggle", sectionId: section.id })}>{hidden ? "🚫" : "👁"}</button>
                {definition?.fields.length ? (
                  <button className="jata-icon-btn" aria-label={`Edit ${sectionLabel(section.type)}`} onClick={() => setEditingId(section.id)}>✎</button>
                ) : (
                  <span className="px-1 text-xs text-zinc-400">Auto</span>
                )}
                {definition?.removable !== false ? (
                  <>
                    <button className="jata-icon-btn" aria-label={`Duplicate ${sectionLabel(section.type)}`} onClick={() => op({ op: "duplicate", sectionId: section.id })}>⧉</button>
                    <button className="jata-icon-btn" aria-label={`Remove ${sectionLabel(section.type)}`} onClick={() => op({ op: "remove", sectionId: section.id })}>🗑</button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <div className="jata-field">
          <label className="jata-label" htmlFor="add-section">Add a section</label>
          <select
            id="add-section"
            className="jata-input"
            value={addType}
            onChange={(event) => setAddType(event.target.value)}
          >
            <option value="">Choose…</option>
            {addable.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {definition.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="jata-btn jata-btn-primary"
          disabled={!addType}
          onClick={async () => {
            if (await op({ op: "add", type: addType })) setAddType("");
          }}
        >
          Add section
        </button>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Edit ${sectionLabel(editing.type)}`}>
          <button className="jata-sheet-scrim" aria-label="Close editor" onClick={() => setEditingId(null)} />
          <div className="jata-sheet">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold">{sectionLabel(editing.type)}</h2>
              <button className="jata-icon-btn" aria-label="Close editor" onClick={() => setEditingId(null)}>✕</button>
            </div>
            <p className="mt-1 text-sm text-zinc-600">{sectionDefinition(editing.type)?.description}</p>

            <div className="mt-4 space-y-3">
              <div className="jata-field">
                <label className="jata-label" htmlFor={`section-title-${editing.id}`}>Heading</label>
                <input
                  id={`section-title-${editing.id}`}
                  className="jata-input"
                  value={editing.title || ""}
                  onChange={(event) => setDocument((current) => withSection(current, editing.id, { title: event.target.value }))}
                  onBlur={(event) => patchSection(editing.id, { title: event.target.value })}
                />
              </div>
              <div className="jata-field">
                <label className="jata-label" htmlFor={`section-subtitle-${editing.id}`}>Sub-heading</label>
                <input
                  id={`section-subtitle-${editing.id}`}
                  className="jata-input"
                  value={editing.subtitle || ""}
                  onChange={(event) => setDocument((current) => withSection(current, editing.id, { subtitle: event.target.value }))}
                  onBlur={(event) => patchSection(editing.id, { subtitle: event.target.value })}
                />
              </div>

              {(sectionDefinition(editing.type)?.fields || [])
                .filter((field) => field.type !== "items")
                .map((field) => (
                  <SectionFieldControl
                    key={field.key}
                    field={field}
                    businessId={businessId}
                    value={fieldValue(editing, field.key)}
                    onChange={(value) => {
                      setDocument((current) => withSection(current, editing.id, { [field.key]: value }));
                      patchSection(editing.id, { [field.key]: value });
                    }}
                    onBlurCommit={(value) => patchSection(editing.id, { [field.key]: value })}
                  />
                ))}

              {(sectionDefinition(editing.type)?.fields || [])
                .filter((field) => field.type === "items")
                .map((field) => (
                  <ItemListEditor
                    key={field.key}
                    field={field}
                    items={editing.items || []}
                    onChange={(items) => {
                      setDocument((current) => withSection(current, editing.id, { items }));
                      patchSection(editing.id, { items });
                    }}
                  />
                ))}
            </div>

            <div className="mt-5 flex gap-2">
              <button className="jata-btn jata-btn-primary" onClick={() => setEditingId(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function withSection(document: ExperienceDocument, id: string, patch: Partial<ExperienceSection>): ExperienceDocument {
  return {
    ...document,
    sections: document.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)),
  };
}

function fieldValue(section: ExperienceSection, key: string): unknown {
  const record = section as unknown as Record<string, unknown>;
  if (key in record) return record[key];
  return (section.config || {})[key];
}

function SectionFieldControl({
  field,
  businessId,
  value,
  onChange,
  onBlurCommit,
}: {
  field: SectionField;
  businessId: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlurCommit: (value: unknown) => void;
}) {
  if (field.type === "image") {
    return (
      <MediaPicker
        businessId={businessId}
        label={field.label}
        value={typeof value === "string" ? value : ""}
        onChange={(url) => onChange(url)}
      />
    );
  }
  if (field.type === "toggle") {
    return (
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <div className="jata-field">
        <label className="jata-label" htmlFor={`field-${field.key}`}>{field.label}</label>
        <select
          id={`field-${field.key}`}
          className="jata-input"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Default</option>
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {field.help ? <p className="jata-hint">{field.help}</p> : null}
      </div>
    );
  }
  if (field.type === "number") {
    return (
      <div className="jata-field">
        <label className="jata-label" htmlFor={`field-${field.key}`}>{field.label}</label>
        <input
          id={`field-${field.key}`}
          type="number"
          className="jata-input"
          min={field.min}
          max={field.max}
          value={typeof value === "number" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          onBlur={(event) => onBlurCommit(event.target.value === "" ? null : Number(event.target.value))}
        />
        {field.help ? <p className="jata-hint">{field.help}</p> : null}
      </div>
    );
  }
  if (field.type === "textarea") {
    return (
      <div className="jata-field">
        <label className="jata-label" htmlFor={`field-${field.key}`}>{field.label}</label>
        <textarea
          id={`field-${field.key}`}
          className="jata-input min-h-24"
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onBlurCommit(event.target.value)}
        />
        {field.help ? <p className="jata-hint">{field.help}</p> : null}
      </div>
    );
  }
  return (
    <div className="jata-field">
      <label className="jata-label" htmlFor={`field-${field.key}`}>{field.label}</label>
      <input
        id={`field-${field.key}`}
        className="jata-input"
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onBlurCommit(event.target.value)}
      />
      {field.help ? <p className="jata-hint">{field.help}</p> : null}
    </div>
  );
}

function ItemListEditor({
  field,
  items,
  onChange,
}: {
  field: SectionField;
  items: Array<Record<string, string>>;
  onChange: (items: Array<Record<string, string>>) => void;
}) {
  const fields = field.itemFields || [];
  return (
    <div className="jata-field">
      <span className="jata-label">{field.label}</span>
      {field.help ? <p className="jata-hint">{field.help}</p> : null}
      <ul className="mt-2 space-y-3">
        {items.map((item, index) => (
          <li key={index} className="rounded-xl border p-3">
            {fields.map((subField) => (
              <div className="jata-field" key={subField.key}>
                <label className="jata-label" htmlFor={`${field.key}-${index}-${subField.key}`}>{subField.label}</label>
                {subField.type === "textarea" ? (
                  <textarea
                    id={`${field.key}-${index}-${subField.key}`}
                    className="jata-input"
                    value={item[subField.key] || ""}
                    maxLength={subField.maxLength}
                    onChange={(event) =>
                      onChange(items.map((entry, position) => (position === index ? { ...entry, [subField.key]: event.target.value } : entry)))
                    }
                  />
                ) : (
                  <input
                    id={`${field.key}-${index}-${subField.key}`}
                    className="jata-input"
                    value={item[subField.key] || ""}
                    maxLength={subField.maxLength}
                    onChange={(event) =>
                      onChange(items.map((entry, position) => (position === index ? { ...entry, [subField.key]: event.target.value } : entry)))
                    }
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              className="jata-btn jata-btn-ghost"
              onClick={() => onChange(items.filter((_, position) => position !== index))}
            >
              Remove {field.itemLabel?.toLowerCase() || "entry"}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="jata-btn jata-btn-secondary mt-3"
        onClick={() => onChange([...items, Object.fromEntries(fields.map((subField) => [subField.key, ""]))])}
      >
        Add {field.itemLabel?.toLowerCase() || "entry"}
      </button>
    </div>
  );
}
