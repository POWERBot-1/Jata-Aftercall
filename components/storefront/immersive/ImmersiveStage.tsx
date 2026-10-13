"use client";

/**
 * The 3D integration boundary (Immersive Website Engine, Phase 5)
 *
 * This is the ONLY place the rest of the storefront may reach 3D. It guarantees:
 *   1. The Three.js viewer is loaded lazily, in its own chunk, and only when this stage is rendered.
 *   2. The static image is visible from the first paint. The 3D canvas mounts hidden and replaces
 *      the image only once its model has loaded, so a visitor never waits on a blank area.
 *   3. Any failure (loader error, WebGL refused, render exception) keeps the static image in place.
 *      The page never shows an empty canvas.
 *   4. The image carries the same accessible description as the 3D view.
 *
 * Nothing in this component is required for buying, booking or contacting the business.
 */

import dynamic from "next/dynamic";
import { Component, useCallback, useState, type ReactNode } from "react";

export type ImmersiveStageProps = {
  /** HTTPS model URL. Validated by lib/experience/immersive/policy.ts before this is rendered. */
  modelUrl: string;
  /** Plain-language description of the product shown in 3D. */
  alt: string;
  /** Static image shown first, and kept whenever 3D is unavailable. */
  fallbackImageUrl: string | null;
  reducedMotion?: boolean;
  /** Called when the model is on screen. */
  onReady?: () => void;
  /** Called when 3D is abandoned (load error, WebGL error). The static image stays. */
  onFailed?: () => void;
};

function StaticFallback({ alt, fallbackImageUrl }: { alt: string; fallbackImageUrl: string | null }) {
  if (!fallbackImageUrl) {
    return (
      <div className="eb-immersive eb-immersive--fallback" role="img" aria-label={alt}>
        <p className="eb-hint">{alt}</p>
      </div>
    );
  }
  return (
    <figure className="eb-immersive eb-immersive--fallback">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fallbackImageUrl} alt={alt} loading="lazy" decoding="async" />
    </figure>
  );
}

// No placeholder here: the static image above already fills the space while the viewer loads.
const ThreeProductViewer = dynamic(() => import("./ThreeProductViewer"), {
  ssr: false,
  loading: () => null,
});

/** Catches a render error inside the viewer and reports it, so the stage can keep the image. */
class ViewerBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function ImmersiveStage({ modelUrl, alt, fallbackImageUrl, reducedMotion = false, onReady: onReadyProp, onFailed }: ImmersiveStageProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => {
    setFailed(true);
    onFailed?.();
  }, [onFailed]);
  const onReady = useCallback(() => {
    setReady(true);
    onReadyProp?.();
  }, [onReadyProp]);

  const fallback = <StaticFallback alt={alt} fallbackImageUrl={fallbackImageUrl} />;
  if (failed) return fallback;

  return (
    <>
      {ready ? null : fallback}
      <ViewerBoundary onError={onFail}>
        <div hidden={!ready}>
          <ThreeProductViewer modelUrl={modelUrl} alt={alt} reducedMotion={reducedMotion} onReady={onReady} onFail={onFail} />
        </div>
      </ViewerBoundary>
    </>
  );
}
