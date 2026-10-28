"use client";

/**
 * Studio Canvas (§4, §14, §16, §22, §63, §64, §89)
 *
 * The editing surface that was missing. Before this, an owner edited one form page, navigated
 * to a different "Preview" tab, and reloaded to see the result — three contexts for one change.
 * The Canvas puts the outline, the live preview and the inspector on one screen:
 *
 *   outline (what the page is made of) | preview (what customers see) | inspector (what to change)
 *
 * Every edit is an optimistic local change followed by a write through the existing versioned
 * `/api/experience` draft path, so nothing here is a new source of truth and Undo still works.
 * The preview iframe is refreshed on the save revision, which kills the "I saved it and nothing
 * changed" browser-cache problem.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ExperienceDocument, ExperienceSection } from "@/lib/experience/types";
import { addableSectionsFor, sectionLabel } from "@/lib/experience/sections";
import type { DesignDirection } from "@/lib/studio/designDirections";
import {
  CANVAS_DEVICES,
  buildSummary,
  canvasOutline,
  canvasPreviewSrc,
  directionApplyPayload,
  directionSwatches,
  fieldValueFor,
  inspectorFieldsFor,
  isSaveShortcut,
  patchForField,
  moveSectionTo,
  readSaveResponse,
  resolveCanvasDevice,
  saveStatusText,
  saveStatusTone,
  setSectionVisible,
  type CanvasDeviceKey,
  type CanvasSaveState,
} from "@/lib/studio/canvas";

type ThemeChoice = { key: string; name: string; description: string; swatches: string[] };

export type StudioCanvasProps = {
  businessId: string;
  slug: string;
  businessName: string;
  categoryLabel: string;
  document: ExperienceDocument;
  draftVersion: number | null;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  directions: DesignDirection[];
  themes: ThemeChoice[];
  currentDirectionKey: string | null;
  currentThemeKey: string;
  publicUrl: string;
  /** Open straight on the Design tab, so a deep link can land on it. */
  initialPanel?: PanelTab;
  /** Demo: no network writes. Every edit stays in this tab. Used only by the labelled preview build. */
  demo?: boolean;
};

type PanelTab = "section" | "design";
type MobilePane = "outline" | "preview" | "edit";

export function StudioCanvas(props: StudioCanvasProps) {
  const router = useRouter();
  const {
    businessId, slug, businessName, categoryLabel, publishedVersion,
    directions, themes, currentDirectionKey, currentThemeKey, publicUrl, demo = false,
  } = props;

  const [document, setDocument] = useState<ExperienceDocument>(props.document);
  const [version, setVersion] = useState<number | null>(props.draftVersion);
  const [dirty, setDirty] = useState(props.hasUnpublishedChanges);
  const [selectedId, setSelectedId] = useState<string | null>(props.document.sections[0]?.id ?? null);
  const [device, setDevice] = useState<CanvasDeviceKey>("phone");
  const [mode, setMode] = useState<"draft" | "live">("draft");
  const [revision, setRevision] = useState(0);
  const [panel, setPanel] = useState<PanelTab>(props.initialPanel ?? "section");
  const [pane, setPane] = useState<MobilePane>("preview");
  const [save, setSave] = useState<CanvasSaveState>("idle");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [addType, setAddType] = useState("");
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  // One save at a time. Two overlapping writes would both send the same expectedDraftVersion;
  // the second would be refused (409) and its optimistic change rolled back for no reason.
  const inFlight = useRef(false);

  // The server is the source of truth after a `router.refresh()` or a conflict. Adjusting state
  // during render (rather than in an effect) re-renders once, immediately, and keeps the editor
  // from flashing a stale draft for a frame.
  const [serverSnapshot, setServerSnapshot] = useState({
    document: props.document,
    draftVersion: props.draftVersion,
    dirty: props.hasUnpublishedChanges,
  });
  if (
    serverSnapshot.document !== props.document ||
    serverSnapshot.draftVersion !== props.draftVersion ||
    serverSnapshot.dirty !== props.hasUnpublishedChanges
  ) {
    setServerSnapshot({ document: props.document, draftVersion: props.draftVersion, dirty: props.hasUnpublishedChanges });
    setDocument(props.document);
    setVersion(props.draftVersion);
    setDirty(props.hasUnpublishedChanges);
  }

  const activeDevice = resolveCanvasDevice(device);
  const outline = useMemo(() => canvasOutline(document), [document]);
  const selected = document.sections.find((section) => section.id === selectedId) ?? null;
  const fields = useMemo(() => inspectorFieldsFor(selected), [selected]);
  const summary = useMemo(() => buildSummary(document), [document]);
  const previewSrc = canvasPreviewSrc({ slug, mode, revision });

  /** One write path for every edit: optimistic local change, then the versioned draft save. */
  const persist = useCallback(
    async (payload: Record<string, unknown>, optimistic: (doc: ExperienceDocument) => ExperienceDocument) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const before = document;
      setDocument((current) => optimistic(current));
      setDirty(true);
      setMessage(null);

      if (demo) {
        inFlight.current = false;
        setSave("saved");
        setRevision((value) => value + 1);
        return;
      }

      setSave("saving");
      try {
        const response = await fetch("/api/experience", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId, ...payload, expectedDraftVersion: version }),
        });
        const saved = readSaveResponse(response.ok, await response.json().catch(() => ({})));
        if (!saved.ok) {
          setDocument(before); // never leave an unsaved change looking saved
          setSave("error");
          const conflict = saved.code === "draft_version_conflict";
          setMessage({
            tone: "error",
            text: conflict
              ? "Your website changed in another window. Reloading the latest draft — nothing was overwritten."
              : saved.error || "We couldn’t save that change. Your previous version is still live.",
          });
          if (conflict) router.refresh();
          return;
        }
        if (saved.document) setDocument(saved.document);
        // The authoritative new version must advance here, or the next edit sends a stale
        // expectedDraftVersion and is refused with a 409.
        if (saved.draftVersion !== null) setVersion(saved.draftVersion);
        setSave("saved");
        setDirty(true);
        setRevision((value) => value + 1);
      } catch {
        setDocument(before);
        setSave("error");
        setMessage({ tone: "error", text: "We couldn’t reach the server. Check your connection and try again — nothing was lost." });
      } finally {
        inFlight.current = false;
      }
    },
    [businessId, demo, document, router, version],
  );

  const moveTo = (id: string, index: number) => persist({ op: "reorder", sectionId: id, toIndex: index }, (doc) => moveSectionTo(doc, id, index));
  const step = (id: string, index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= document.sections.length) return;
    moveTo(id, target);
  };
  const toggleVisible = (id: string) => {
    const section = document.sections.find((entry) => entry.id === id);
    if (!section) return;
    const next = section.visible === false;
    void persist({ op: "toggle", sectionId: id }, (doc) => setSectionVisible(doc, id, next));
  };
  const removeSectionById = (id: string) =>
    void persist({ op: "remove", sectionId: id }, (doc) => ({ ...doc, sections: doc.sections.filter((entry) => entry.id !== id) }));
  const duplicateSectionById = (id: string) => void persist({ op: "duplicate", sectionId: id }, (doc) => ({ ...doc, sections: duplicateAfter(doc, id) }));
  const addSection = (type: string) => {
    if (!type) return;
    setAddType("");
    void persist({ op: "add", type }, (doc) => doc);
  };
  /** Commit one inspector field through the persistable-key contract (dotted keys included). */
  const commitField = (section: ExperienceSection, key: string, value: unknown) => {
    const patch = patchForField(section, key, value);
    if (!patch) return;
    patchSection(section.id, patch);
  };
  const patchSection = (id: string, patch: Partial<ExperienceSection>) =>
    void persist({ op: "update", sectionId: id, patch }, (doc) => ({
      ...doc,
      sections: doc.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)),
    }));
  const applyDirection = (direction: DesignDirection) =>
    void persist(directionApplyPayload(direction), (doc) => ({
      ...doc,
      themeKey: direction.themeKey,
      designDirectionKey: direction.key,
      brand: { ...doc.brand, ...direction.brand },
    }));
  const applyTheme = (themeKey: string) => void persist({ themeKey }, (doc) => ({ ...doc, themeKey }));

  // Cmd/Ctrl+S is the reflex for "save my work"; saves are immediate, so it confirms instead.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isSaveShortcut(event)) {
        event.preventDefault();
        setSave((state) => (state === "saving" ? state : "saved"));
        statusRef.current?.focus?.();
      }
      if (event.key === "Escape") setPane("preview");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const statusText = saveStatusText(save, dirty);
  const statusTone = saveStatusTone(save, dirty);

  return (
    <div className="jc-root" data-demo={demo ? "true" : undefined}>
      {demo ? (
        <p className="jc-demo-notice" role="note">
          <strong>Preview build.</strong> Sample business, sample content, nothing is saved and no real customer data is shown.
        </p>
      ) : null}

      <header className="jc-topbar">
        <div className="jc-topbar__id">
          <p className="jc-eyebrow">{categoryLabel} · Website studio</p>
          <h1 className="jc-title">{businessName}</h1>
        </div>

        <div className="jc-topbar__status">
          <span className={`jc-pill jc-pill--${statusTone}`} aria-live="polite" aria-atomic="true" ref={statusRef} tabIndex={-1}>
            {statusText}
          </span>
          <span className="jc-pill jc-pill--neutral">
            Draft v{version ?? 1} · live v{publishedVersion}
          </span>
        </div>

        <div className="jc-topbar__actions">
          <a className="jc-btn jc-btn--quiet" href={publicUrl} target="_blank" rel="noopener noreferrer">Open live site</a>
          <Link className="jc-btn jc-btn--primary" href={`/dashboard/businesses/${businessId}#publish`}>Review &amp; publish</Link>
        </div>
      </header>

      {/* A segmented control rather than a tablist: the three regions are already visible
          landmarks, and claiming role="tab" without a tabpanel misleads screen readers. */}
      <div className="jc-mobile-panes" role="group" aria-label="Which pane to show">
        {(["outline", "preview", "edit"] as MobilePane[]).map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={pane === entry}
            className="jc-segment"
            onClick={() => setPane(entry)}
          >
            {entry === "outline" ? "Sections" : entry === "preview" ? "Preview" : "Edit"}
          </button>
        ))}
      </div>

      <div className="jc-grid" data-pane={pane}>
        {/* ------------------------------- outline ------------------------------- */}
        <section className="jc-outline" aria-label="Page sections">
          <div className="jc-outline__head">
            <h2 className="jc-h2">Page sections</h2>
            <p className="jc-muted">{summary.visible} visible · {summary.hidden} hidden</p>
          </div>

          <ol className="jc-list">
            {outline.map((row) => {
              const isActive = row.id === selectedId;
              return (
                <li key={row.id} className="jc-row" data-active={isActive ? "true" : undefined} data-hidden={row.visible ? undefined : "true"}>
                  <button
                    type="button"
                    className="jc-row__select"
                    aria-pressed={isActive}
                    onClick={() => { setSelectedId(row.id); setPanel("section"); setPane("edit"); }}
                  >
                    <span className="jc-row__index" aria-hidden="true">{String(row.index + 1).padStart(2, "0")}</span>
                    <span className="jc-row__text">
                      <span className="jc-row__label">{row.label}</span>
                      <span className="jc-row__title">{row.hiddenNote ?? row.title}</span>
                    </span>
                  </button>
                  <div className="jc-row__actions">
                    <button type="button" className="jc-icon" aria-label={`Move ${row.label} up`} disabled={row.index === 0} onClick={() => step(row.id, row.index, -1)}>↑</button>
                    <button type="button" className="jc-icon" aria-label={`Move ${row.label} down`} disabled={row.index === outline.length - 1} onClick={() => step(row.id, row.index, 1)}>↓</button>
                    <button type="button" className="jc-icon" aria-label={row.visible ? `Hide ${row.label}` : `Show ${row.label}`} aria-pressed={!row.visible} onClick={() => toggleVisible(row.id)}>{row.visible ? "◉" : "◌"}</button>
                    {row.removable ? (
                      <>
                        <button type="button" className="jc-icon" aria-label={`Duplicate ${row.label}`} onClick={() => duplicateSectionById(row.id)}>⧉</button>
                        <button type="button" className="jc-icon jc-icon--danger" aria-label={`Remove ${row.label}`} onClick={() => removeSectionById(row.id)}>✕</button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="jc-add">
            <label className="jc-label" htmlFor="jc-add-section">Add a section</label>
            <div className="jc-add__row">
              <select
                id="jc-add-section"
                className="jc-input"
                value={addType}
                onChange={(event) => setAddType(event.target.value)}
              >
                <option value="">Choose…</option>
                {addableSectionsFor(document.categoryKey).map((definition) => (
                  <option key={definition.type} value={definition.type}>{definition.label}</option>
                ))}
              </select>
              <button type="button" className="jc-btn jc-btn--primary" disabled={!addType} onClick={() => addSection(addType)}>Add</button>
            </div>
          </div>
        </section>

        {/* ------------------------------- preview ------------------------------- */}
        <section className="jc-stage" aria-label="Live preview">
          <div className="jc-stage__bar">
            <div className="jc-devices" role="group" aria-label="Preview width">
              {CANVAS_DEVICES.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="jc-chip"
                  aria-pressed={device === entry.key}
                  onClick={() => setDevice(entry.key)}
                  title={entry.hint}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="jc-devices" role="group" aria-label="Which version to show">
              <button type="button" className="jc-chip" aria-pressed={mode === "draft"} onClick={() => setMode("draft")}>Draft</button>
              <button type="button" className="jc-chip" aria-pressed={mode === "live"} onClick={() => setMode("live")}>Live</button>
            </div>
            <button type="button" className="jc-chip" onClick={() => setRevision((value) => value + 1)} aria-label="Refresh preview">↻ Refresh</button>
          </div>

          <div className="jc-frame" data-device={activeDevice.key}>
            <div className="jc-frame__chrome" aria-hidden="true">
              <span className="jc-frame__notch" />
              <span className="jc-frame__url">{slug}.jata.site · {activeDevice.width} px</span>
            </div>
            <iframe
              key={`${mode}-${device}-${revision}`}
              className="jc-frame__iframe"
              title={`${mode === "draft" ? "Draft" : "Live"} preview of ${businessName} at ${activeDevice.label.toLowerCase()} width`}
              src={previewSrc}
              style={{ width: Math.min(activeDevice.width, 1440) }}
              height={activeDevice.height}
              loading="lazy"
            />
          </div>
          <p className="jc-muted jc-stage__note">
            {mode === "draft"
              ? "This is your unpublished draft. Customers still see the live version until you publish."
              : "This is what customers see right now."}
          </p>
        </section>

        {/* ------------------------------ inspector ------------------------------ */}
        <section className="jc-inspector" aria-label="Editing panel">
          <div className="jc-tabs" role="group" aria-label="Editing panel sections">
            <button type="button" aria-pressed={panel === "section"} className="jc-tab" onClick={() => setPanel("section")}>This section</button>
            <button type="button" aria-pressed={panel === "design"} className="jc-tab" onClick={() => setPanel("design")}>Design</button>
          </div>

          {message ? (
            <p className={message.tone === "error" ? "jc-alert jc-alert--error" : "jc-alert"} role="status">{message.text}</p>
          ) : null}

          {panel === "section" ? (
            selected ? (
              <div className="jc-panel">
                <div className="jc-panel__head">
                  <h2 className="jc-h2">{sectionLabel(selected.type)}</h2>
                  <span className="jc-tag">{selected.visible === false ? "Hidden" : "Visible"}</span>
                </div>

                {fields.length === 0 ? (
                  <p className="jc-muted">
                    This section shows live business data, so there is nothing to type here. Edit the{" "}
                    <Link className="jc-link" href={`/dashboard/businesses/${businessId}/items`}>products and services</Link>{" "}
                    and they appear on the page immediately.
                  </p>
                ) : (
                  fields.map((field) => (
                    <div className="jc-field" key={field.key}>
                      <label className="jc-label" htmlFor={`jc-field-${field.key}`}>{field.label}</label>
                      {field.type === "textarea" ? (
                        <textarea
                          id={`jc-field-${field.key}`}
                          className="jc-input jc-input--area"
                          defaultValue={String(fieldValueFor(selected, field.key))}
                          placeholder={field.placeholder}
                          maxLength={field.maxLength}
                          onBlur={(event) => {
                            if (event.target.value !== String(fieldValueFor(selected, field.key))) {
                              commitField(selected, field.key, event.target.value);
                            }
                          }}
                        />
                      ) : field.type === "select" ? (
                        <select
                          id={`jc-field-${field.key}`}
                          className="jc-input"
                          value={String(fieldValueFor(selected, field.key))}
                          onChange={(event) => commitField(selected, field.key, event.target.value)}
                        >
                          <option value="">Default</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : field.type === "number" ? (
                        <input
                          id={`jc-field-${field.key}`}
                          className="jc-input"
                          type="number"
                          min={field.min}
                          max={field.max}
                          defaultValue={Number(fieldValueFor(selected, field.key)) || ""}
                          onBlur={(event) => {
                            const parsed = Number(event.target.value);
                            if (Number.isFinite(parsed)) commitField(selected, field.key, parsed);
                          }}
                        />
                      ) : field.type === "toggle" ? (
                        <input
                          id={`jc-field-${field.key}`}
                          type="checkbox"
                          className="jc-checkbox"
                          defaultChecked={Boolean(fieldValueFor(selected, field.key))}
                          onChange={(event) => commitField(selected, field.key, event.target.checked)}
                        />
                      ) : (
                        <input
                          id={`jc-field-${field.key}`}
                          className="jc-input"
                          defaultValue={String(fieldValueFor(selected, field.key))}
                          placeholder={field.placeholder}
                          maxLength={field.maxLength}
                          onBlur={(event) => {
                            if (event.target.value !== String(fieldValueFor(selected, field.key))) {
                              commitField(selected, field.key, event.target.value);
                            }
                          }}
                        />
                      )}
                      {field.help ? <p className="jc-help">{field.help}</p> : null}
                    </div>
                  ))
                )}

                <div className="jc-panel__actions">
                  <button type="button" className="jc-btn jc-btn--quiet" onClick={() => toggleVisible(selected.id)}>
                    {selected.visible === false ? "Show this section" : "Hide this section"}
                  </button>
                  <button type="button" className="jc-btn jc-btn--quiet" onClick={() => moveTo(selected.id, 0)}>Move to top</button>
                </div>
              </div>
            ) : (
              <p className="jc-muted">Choose a section on the left to edit it.</p>
            )
          ) : (
            <div className="jc-panel">
              <h2 className="jc-h2">Design direction</h2>
              <p className="jc-help">Each direction restyles the whole page — palette, type, buttons and photography language — in one change.</p>
              <ul className="jc-directions">
                {directions.map((direction) => {
                  const active = currentDirectionKey === direction.key || document.designDirectionKey === direction.key;
                  return (
                    <li key={direction.key}>
                      <button
                        type="button"
                        className="jc-direction"
                        aria-pressed={active}
                        onClick={() => applyDirection(direction)}
                      >
                        <span className="jc-swatches" aria-hidden="true">
                          {directionSwatches(direction).map((colour, index) => (
                            <span key={`${direction.key}-${index}`} className="jc-swatch" style={{ background: colour }} />
                          ))}
                        </span>
                        <span className="jc-direction__text">
                          <span className="jc-direction__name">{direction.name}{active ? " · in use" : ""}</span>
                          <span className="jc-direction__desc">{direction.description}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <h2 className="jc-h2 jc-mt">Base theme</h2>
              <div className="jc-themes">
                {themes.map((theme) => {
                  const active = (document.themeKey || currentThemeKey) === theme.key;
                  return (
                    <button
                      key={theme.key}
                      type="button"
                      className="jc-chip jc-chip--theme"
                      aria-pressed={active}
                      onClick={() => applyTheme(theme.key)}
                      title={theme.description}
                    >
                      <span className="jc-swatches" aria-hidden="true">
                        {theme.swatches.slice(0, 4).map((colour, index) => (
                          <span key={`${theme.key}-${index}`} className="jc-swatch jc-swatch--sm" style={{ background: colour }} />
                        ))}
                      </span>
                      {theme.name}
                    </button>
                  );
                })}
              </div>

              <p className="jc-help jc-mt">
                <Link className="jc-link" href={`/dashboard/businesses/${businessId}/canvas?tab=design`}>Open the full design studio →</Link>
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className="jc-footer">
        <p className="jc-muted">
          {summary.sections} sections · {summary.visible} visible. Edits save to your draft; the live site changes only when you publish.
        </p>
        <Link className="jc-btn jc-btn--quiet" href={`/dashboard/businesses/${businessId}`}>Back to overview</Link>
      </footer>
    </div>
  );
}

/** Local-only duplicate used for the optimistic preview; the server replaces it with the real copy. */
function duplicateAfter(document: ExperienceDocument, id: string): ExperienceSection[] {
  const index = document.sections.findIndex((section) => section.id === id);
  if (index < 0) return document.sections;
  const copy: ExperienceSection = { ...document.sections[index], id: `${document.sections[index].id}-copy-${Date.now()}` };
  const sections = [...document.sections];
  sections.splice(index + 1, 0, copy);
  return sections;
}

export default StudioCanvas;
