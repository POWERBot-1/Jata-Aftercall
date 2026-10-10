"use client";

/**
 * Chooses the presentation tier in the visitor's browser (Immersive Website Engine, Phase 1).
 *
 * The page is already complete HTML when it arrives, so this component only *upgrades* the
 * presentation by writing `data-render-mode` on <html>. If it never runs (no JavaScript,
 * an old WebView, a blocked script), the site simply stays in Lite. It never removes or
 * hides business content, and it never throws into the page.
 */

import { useEffect } from "react";
import { readCapabilitySignals, resolveRenderMode, type RenderPreference } from "@/lib/experience/renderMode";

export function RenderModeProbe({ preference }: { preference: RenderPreference }) {
  useEffect(() => {
    const root = document.documentElement;
    try {
      const decision = resolveRenderMode({ preference, signals: readCapabilitySignals(window) });
      root.dataset.renderMode = decision.mode;
      if (decision.mode === "lite") {
        delete root.dataset.motionReady;
      } else {
        root.dataset.motionReady = "true";
      }
    } catch {
      root.dataset.renderMode = "lite";
      delete root.dataset.motionReady;
    }
  }, [preference]);

  return null;
}
