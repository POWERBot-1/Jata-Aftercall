"use client";

/**
 * Section layers (adapted from OpenPage's LayersPanel, without the @dnd-kit dependency).
 *
 * The list is the authoritative JATA section order. Movement is explicit up/down so it
 * works with a keyboard and a phone. Each row also shows the OpenPage block/variant that
 * represents the section in the adapter, making the mapping visible to the owner.
 */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { addSection, addableSections, duplicateSection, moveSection, removeSection, updateSection } from "@/lib/experience/document";
import { sectionDefinition, sectionLabel } from "@/lib/experience/sections";
import { blockMetadata } from "@/lib/openpage/blockMetadata";
import { experienceToSiteConfig } from "@/lib/openpage/adapter";
import type { ExperienceDocument } from "@/lib/experience/types";

export function StudioLayersPanel({
  document,
  selectedId,
  onSelect,
  onChange,
  disabled = false,
}: {
  document: ExperienceDocument;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (next: ExperienceDocument) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const mapping = useMemo(() => experienceToSiteConfig(document), [document]);
  const bySection = useMemo(() => new Map(mapping.mapped.map((entry) => [entry.sectionId, entry])), [mapping]);
  const addable = useMemo(() => addableSections(document), [document]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">Sections</h2>
        <button
          type="button"
          className="jata-btn jata-btn-ghost !px-2 !py-1 text-xs"
          onClick={() => setAdding((value) => !value)}
          disabled={disabled}
          aria-expanded={adding}
        >
          <Plus size={13} aria-hidden="true" /> Add
        </button>
      </div>

      {adding ? (
        <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-[color:var(--ws-line)] p-1">
          {addable.map((definition) => (
            <button
              key={definition.type}
              type="button"
              className="block w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-[color:var(--ws-paper)]"
              disabled={disabled}
              onClick={() => {
                onChange(addSection(document, definition.type));
                setAdding(false);
              }}
            >
              {definition.label}
            </button>
          ))}
        </div>
      ) : null}

      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Website sections">
        {document.sections.map((section, index) => {
          const definition = sectionDefinition(section.type);
          const mapped = bySection.get(section.id);
          const blockLabel = mapped ? blockMetadata.find((block) => block.type === mapped.blockType)?.label : null;
          const active = selectedId === section.id;
          return (
            <li key={section.id}>
              <div
                className={`rounded-lg border px-2 py-1.5 ${active ? "border-[color:var(--ws-ink)] bg-[color:var(--ws-paper)]" : "border-transparent hover:border-[color:var(--ws-line)]"}`}
                data-section-type={section.type}
                data-section-id={section.id}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(section.id)}
                    aria-current={active ? "true" : undefined}
                    disabled={disabled}
                  >
                    <span className="block truncate text-xs font-semibold">{sectionLabel(section.type)}</span>
                    <span className="block truncate text-[10px] text-[color:var(--ws-muted)]">
                      {blockLabel ? `${blockLabel} · ${mapped?.variant}` : "JATA section"}
                      {section.visible ? "" : " · hidden"}
                    </span>
                  </button>
                  {!definition?.removable ? <span className="text-[9px] uppercase text-[color:var(--ws-muted)]">core</span> : null}
                </div>
                <div className="mt-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded-sm p-1 hover:bg-[color:var(--ws-paper)]"
                    aria-label={`Move ${sectionLabel(section.type)} up`}
                    disabled={disabled || index === 0}
                    onClick={() => onChange(moveSection(document, section.id, "up"))}
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    className="rounded-sm p-1 hover:bg-[color:var(--ws-paper)]"
                    aria-label={`Move ${sectionLabel(section.type)} down`}
                    disabled={disabled || index === document.sections.length - 1}
                    onClick={() => onChange(moveSection(document, section.id, "down"))}
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button
                    type="button"
                    className="rounded-sm p-1 hover:bg-[color:var(--ws-paper)]"
                    aria-label={section.visible ? `Hide ${sectionLabel(section.type)}` : `Show ${sectionLabel(section.type)}`}
                    disabled={disabled}
                    onClick={() => onChange(updateSection(document, section.id, { visible: !section.visible }))}
                  >
                    {section.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm p-1 hover:bg-[color:var(--ws-paper)]"
                    aria-label={`Duplicate ${sectionLabel(section.type)}`}
                    disabled={disabled}
                    onClick={() => onChange(duplicateSection(document, section.id))}
                  >
                    <Copy size={12} />
                  </button>
                  {definition?.removable ? (
                    <button
                      type="button"
                      className="rounded-sm p-1 hover:bg-[color:var(--ws-paper)]"
                      aria-label={`Remove ${sectionLabel(section.type)}`}
                      disabled={disabled}
                      onClick={() => onChange(removeSection(document, section.id))}
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
