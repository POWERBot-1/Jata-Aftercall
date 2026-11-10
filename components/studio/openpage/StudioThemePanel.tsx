"use client";

/**
 * Theme chooser.
 *
 * Two layers, both honest:
 *   • JATA's approved category themes are the ones that actually render.
 *   • OpenPage's ten presets are shown as palette inspiration; selecting one applies the
 *     closest approved JATA theme (never raw CSS from the browser).
 */

import { useMemo } from "react";
import { themesForCategory } from "@/lib/experience/themes";
import { themeBridgeForCategory } from "@/lib/openpage/themeBridge";
import type { ExperienceDocument } from "@/lib/experience/types";

export function StudioThemePanel({
  document,
  onChange,
  disabled = false,
}: {
  document: ExperienceDocument;
  onChange: (next: ExperienceDocument) => void;
  disabled?: boolean;
}) {
  const themes = useMemo(() => themesForCategory(document.categoryKey), [document.categoryKey]);
  const bridge = useMemo(() => themeBridgeForCategory(document.categoryKey), [document.categoryKey]);

  function setTheme(key: string) {
    onChange({ ...document, themeKey: key });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">Approved themes</p>
        <div className="mt-2 grid gap-2">
          {themes.map((theme) => {
            const active = theme.key === document.themeKey;
            return (
              <button
                key={theme.key}
                type="button"
                disabled={disabled}
                onClick={() => setTheme(theme.key)}
                aria-pressed={active}
                className={`rounded-xl border p-2.5 text-left transition ${active ? "border-[color:var(--ws-ink)] bg-[color:var(--ws-paper)]" : "border-[color:var(--ws-line)] hover:border-[color:var(--ws-ink)]"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{theme.name}</span>
                  <span className="flex gap-1" aria-hidden="true">
                    {[theme.palette.bg, theme.palette.surface, theme.palette.primary, theme.palette.accent].map((color) => (
                      <span key={color} className="h-4 w-4 rounded-full border border-black/10" style={{ background: color }} />
                    ))}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-[color:var(--ws-muted)]">{theme.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[color:var(--ws-muted)]">OpenPage palette inspiration</p>
        <p className="mt-1 text-xs text-[color:var(--ws-muted)]">Each palette applies the closest approved JATA theme; no external CSS is injected.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {bridge.map((option) => {
            const active = option.jataThemeKey === document.themeKey;
            return (
              <button
                key={option.presetId}
                type="button"
                disabled={disabled}
                onClick={() => setTheme(option.jataThemeKey)}
                aria-pressed={active}
                title={`${option.presetName} → ${option.jataThemeName}`}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold ${active ? "border-[color:var(--ws-ink)]" : "border-[color:var(--ws-line)] hover:border-[color:var(--ws-ink)]"}`}
              >
                <span className="flex" aria-hidden="true">
                  {option.swatches.slice(0, 3).map((color) => (
                    <span key={color} className="h-3 w-3 rounded-full border border-black/10" style={{ background: color }} />
                  ))}
                </span>
                {option.presetName}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
