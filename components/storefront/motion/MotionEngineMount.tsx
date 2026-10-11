"use client";

/**
 * Motion engine loader (Immersive Website Engine, Phase 2 — §21, §40, §41, §51, §54)
 *
 * This component decides whether a visitor's page may upgrade from CSS reveals to the JavaScript
 * motion engine, and loads that engine only if it may. It renders nothing and never touches
 * content: the page is already complete HTML when it arrives.
 *
 * The download is gated four times over, because on a Kenyan Android connection an unnecessary
 * 30 kB is a real cost (§82):
 *
 *   1. the capability detector's render tier must not be Lite;
 *   2. `prefers-reduced-motion` and Save-Data both refuse it outright (§51);
 *   3. the published theme's motion treatment must be `expressive` — a `subtle` theme is one CSS
 *      transition and does not justify a library (§39);
 *   4. if the dynamic import fails or is still in flight, the CSS reveal path is what runs, and
 *      the visitor never waits on a chunk (§54, §78).
 */

import { useEffect } from "react";
import { isLowPowerDevice, motionPlan } from "@/lib/experience/motion";
import { readCapabilitySignals, resolveRenderMode, type RenderPreference } from "@/lib/experience/renderMode";
import type { MotionLevel } from "@/lib/experience/themes";

function pointerIsFine(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
  } catch {
    return false;
  }
}

export function MotionEngineMount({
  motionLevel,
  seed,
  preference,
}: {
  motionLevel: MotionLevel;
  seed: string;
  preference: RenderPreference;
}) {
  useEffect(() => {
    const root = document.documentElement;
    let stop: (() => void) | null = null;
    let cancelled = false;

    try {
      const signals = readCapabilitySignals(window);
      const decision = resolveRenderMode({ preference, signals });
      const lowPower = isLowPowerDevice(signals);
      const plan = motionPlan({
        renderMode: decision.mode,
        motionLevel,
        reducedMotion: signals.reducedMotion,
        saveData: signals.saveData,
        lowPower,
      });

      // Recorded for the performance analytics of §57: which engine ran, and why. It is a
      // diagnostic attribute on <html>, never shown to the visitor.
      root.dataset.motionPlan = plan.reasons.length > 0 ? plan.reasons.join(" ") : plan.engine;
      if (plan.engine !== "motion-js") return;

      void import("./MotionRuntime")
        .then((mod) => {
          if (cancelled) return;
          // Set before the first animation so the stylesheet hands visibility control to the
          // engine in the same frame — never a frame where content is hidden with no owner.
          root.dataset.motionEngine = "js";
          stop = mod.startMotionEngine({ recipes: plan.recipes, pointerFine: pointerIsFine(), lowPower });
        })
        .catch(() => {
          // Chunk blocked, offline, old WebView: the CSS reveal stands. Nothing is hidden.
        });
    } catch {
      delete root.dataset.motionPlan;
    }

    return () => {
      cancelled = true;
      try {
        stop?.();
      } catch {
        /* ignore */
      }
      delete root.dataset.motionEngine;
      delete root.dataset.motionPlan;
    };
  }, [motionLevel, seed, preference]);

  return null;
}
