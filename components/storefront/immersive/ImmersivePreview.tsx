"use client";

/**
 * Opt-in 3D preview for one product (Immersive Website Engine, Phase 5)
 *
 * Decides, in the visitor's browser, whether to show the 3D view. It never blocks the static
 * image: the image is rendered on the server and on first paint, and stays in place for every
 * reason to skip 3D. The chosen or skipped reason is written to `data-immersive-reason` so the
 * decision is visible to tests and to the owner's preview.
 *
 * Three gates, all required:
 *   1. The owner opted in for this page (`preference === "immersive"`).
 *   2. The caller enabled the preview (`enabled`). Visitor-facing pages pass the server flag
 *      (`immersiveFeatureEnabled()`), which is false in any deployment without durable storage.
 *   3. `immersiveEligibility` passes for this visitor's device, connection and motion settings.
 */

import { useCallback, useEffect, useState } from "react";
import { immersiveEligibility, type ImmersiveAsset } from "@/lib/experience/immersive/policy";
import { readCapabilitySignals, type RenderPreference } from "@/lib/experience/renderMode";
import { ImmersiveStage } from "./ImmersiveStage";

export type ImmersivePreviewProps = {
  preference: RenderPreference;
  enabled: boolean;
  asset: ImmersiveAsset | null;
  alt: string;
  fallbackImageUrl: string | null;
};

type Decision = { use3d: boolean; reason: string; reducedMotion: boolean };

export function ImmersivePreview({ preference, enabled, asset, alt, fallbackImageUrl }: ImmersivePreviewProps) {
  // null until the browser has answered. The static image is what renders until then.
  const [decision, setDecision] = useState<Decision | null>(null);

  useEffect(() => {
    let next: Decision;
    try {
      const signals = readCapabilitySignals(window);
      if (preference !== "immersive") {
        next = { use3d: false, reason: "not-opted-in", reducedMotion: signals.reducedMotion };
      } else {
        const result = immersiveEligibility({ enabled, signals, asset });
        next = { use3d: result.eligible, reason: result.reason, reducedMotion: signals.reducedMotion };
      }
    } catch {
      next = { use3d: false, reason: "probe-failed", reducedMotion: false };
    }
    setDecision(next);
  }, [preference, enabled, asset]);

  const staticView = fallbackImageUrl ? (
    <figure className="eb-immersive eb-immersive--fallback">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fallbackImageUrl} alt={alt} loading="lazy" decoding="async" />
    </figure>
  ) : (
    <div className="eb-immersive eb-immersive--fallback" role="img" aria-label={alt}>
      <p className="eb-hint">{alt}</p>
    </div>
  );

  // Reported after the fact, so the attribute matches what the visitor actually sees.
  const markFailed = useCallback(() => {
    setDecision((current) => (current ? { ...current, use3d: false, reason: "model-load-failed" } : current));
  }, []);

  const reason = decision?.reason ?? "pending";
  return (
    <div data-immersive-reason={reason} data-immersive-mode={decision?.use3d ? "3d" : "static"}>
      {decision?.use3d && asset ? (
        <ImmersiveStage
          modelUrl={asset.url}
          alt={alt}
          fallbackImageUrl={fallbackImageUrl}
          reducedMotion={decision.reducedMotion}
          onFailed={markFailed}
        />
      ) : (
        staticView
      )}
    </div>
  );
}
