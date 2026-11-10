"use client";

/**
 * Properties inspector (adapted from OpenPage's PropertiesPanel).
 *
 * Fields come from JATA's section registry, so the inspector can only write fields the
 * schema supports. Commercial and contact facts are absent from that registry: prices,
 * stock and phone/WhatsApp live on the business/catalogue records and are never editable
 * through a website block.
 */

import { Plus, Trash2 } from "lucide-react";
import { sectionDefinition, sectionLabel, type SectionField } from "@/lib/experience/sections";
import { mappedVariantsForSection } from "@/lib/openpage/layoutVariants";
import type { ExperienceDocument, ExperienceSection } from "@/lib/experience/types";

function valueFor(section: ExperienceSection, key: string): string {
  if (key === "cta.label") return section.cta?.label || "";
  const raw = (section as unknown as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
}

function patchFor(section: ExperienceSection, key: string, value: string): Partial<ExperienceSection> {
  if (key === "cta.label") return { cta: { label: value.slice(0, 40), href: section.cta?.href || "#contact" } };
  if (key === "limit") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return {};
    return { limit: Math.max(1, Math.min(24, Math.round(parsed))) };
  }
  if (key === "imageUrl") return { imageUrl: value };
  return { [key]: value } as Partial<ExperienceSection>;
}

function ItemsEditor({
  section,
  field,
  disabled,
  onItems,
}: {
  section: ExperienceSection;
  field: SectionField;
  disabled: boolean;
  onItems: (items: Array<Record<string, string>>) => void;
}) {
  const items = section.items || [];
  const fields = field.itemFields || [];
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="rounded-lg border border-[color:var(--ws-line)] p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">
              {(field.itemLabel || "Item")} {index + 1}
            </span>
            <button
              type="button"
              className="rounded-sm p-1 hover:bg-[color:var(--ws-paper)]"
              aria-label={`Remove ${field.itemLabel || "item"} ${index + 1}`}
              disabled={disabled}
              onClick={() => onItems(items.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 size={12} />
            </button>
          </div>
          {fields.map((itemField) => (
            <label key={itemField.key} className="mb-1 block">
              <span className="block text-[10px] text-[color:var(--ws-muted)]">{itemField.label}</span>
              {itemField.type === "textarea" ? (
                <textarea
                  className="jata-input mt-0.5 w-full text-xs"
                  rows={2}
                  maxLength={itemField.maxLength}
                  value={item[itemField.key] || ""}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = [...items];
                    next[index] = { ...item, [itemField.key]: event.target.value };
                    onItems(next);
                  }}
                />
              ) : (
                <input
                  className="jata-input mt-0.5 w-full text-xs"
                  maxLength={itemField.maxLength}
                  value={item[itemField.key] || ""}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = [...items];
                    next[index] = { ...item, [itemField.key]: event.target.value };
                    onItems(next);
                  }}
                />
              )}
            </label>
          ))}
        </div>
      ))}
      <button
        type="button"
        className="jata-btn jata-btn-ghost !px-2 !py-1 text-xs"
        disabled={disabled || items.length >= 12}
        onClick={() => onItems([...items, {}])}
      >
        <Plus size={12} /> Add {field.itemLabel || "item"}
      </button>
    </div>
  );
}

export function StudioProperties({
  document,
  sectionId,
  onChange,
  disabled = false,
}: {
  document: ExperienceDocument;
  sectionId: string | null;
  onChange: (next: ExperienceDocument) => void;
  disabled?: boolean;
}) {
  const section = document.sections.find((entry) => entry.id === sectionId) || null;
  const definition = section ? sectionDefinition(section.type) : null;
  const variants = section ? mappedVariantsForSection(section.type) : [];

  function updateSection(patch: Partial<ExperienceSection>) {
    if (!section) return;
    onChange({
      ...document,
      sections: document.sections.map((entry) => (entry.id === section.id ? { ...entry, ...patch } : entry)),
    });
  }

  if (!section || !definition) {
    return (
      <div className="p-3 text-xs text-[color:var(--ws-muted)]">
        Select a section to edit its words and layout. Prices, stock and contact details are managed in your business settings and appear on the site automatically.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">Editing</p>
        <h2 className="text-sm font-bold">{sectionLabel(section.type)}</h2>
        <p className="text-xs text-[color:var(--ws-muted)]">{definition.description}</p>
      </div>

      {variants.length > 0 ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">Layout variant</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {variants.map((variant) => {
              const active = section.layout === variant.jataLayout;
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => updateSection({ layout: variant.jataLayout })}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${active ? "border-[color:var(--ws-ink)]" : "border-[color:var(--ws-line)] hover:border-[color:var(--ws-ink)]"}`}
                >
                  {variant.variant}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {definition.fields.map((field) => {
        if (field.type === "items") {
          return (
            <div key={field.key}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">{field.label}</p>
              <ItemsEditor
                section={section}
                field={field}
                disabled={disabled}
                onItems={(items) => updateSection({ items })}
              />
            </div>
          );
        }
        if (field.type === "image") {
          return (
            <label key={field.key} className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">{field.label}</span>
              <input
                className="jata-input mt-1 w-full text-xs"
                placeholder="https://… or /uploads/…"
                value={valueFor(section, field.key)}
                disabled={disabled}
                onChange={(event) => updateSection(patchFor(section, field.key, event.target.value))}
              />
              {field.help ? <span className="mt-0.5 block text-[10px] text-[color:var(--ws-muted)]">{field.help}</span> : null}
            </label>
          );
        }
        if (field.type === "select") {
          return (
            <label key={field.key} className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">{field.label}</span>
              <select
                className="jata-input mt-1 w-full text-xs"
                value={valueFor(section, field.key)}
                disabled={disabled}
                onChange={(event) => updateSection(patchFor(section, field.key, event.target.value))}
              >
                {(field.options || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={field.key} className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">{field.label}</span>
            {field.type === "textarea" ? (
              <textarea
                className="jata-input mt-1 w-full text-xs"
                rows={3}
                maxLength={field.maxLength}
                value={valueFor(section, field.key)}
                disabled={disabled}
                onChange={(event) => updateSection(patchFor(section, field.key, event.target.value))}
              />
            ) : (
              <input
                className="jata-input mt-1 w-full text-xs"
                maxLength={field.maxLength}
                type={field.type === "number" ? "number" : "text"}
                min={field.min}
                max={field.max}
                value={valueFor(section, field.key)}
                disabled={disabled}
                onChange={(event) => updateSection(patchFor(section, field.key, event.target.value))}
              />
            )}
            {field.help ? <span className="mt-0.5 block text-[10px] text-[color:var(--ws-muted)]">{field.help}</span> : null}
          </label>
        );
      })}

      <div className="rounded-lg border border-[color:var(--ws-line)] p-2 text-[11px] text-[color:var(--ws-muted)]">
        Data sections (catalogue, hours, location, contact) render live business records. Editing their heading here changes the label only; the records themselves stay in your catalogue and settings.
      </div>
    </div>
  );
}
