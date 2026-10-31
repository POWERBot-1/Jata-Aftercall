"use client";

/** A scoped progressive enhancement controller; never writes global <html> presentation state. */
import { useEffect, useRef } from "react";
import type { RenderPreference } from "@/lib/experience/renderMode";
import { attachStorefrontMotion } from "@/lib/experience/motionRuntime";

export function RenderModeProbe({ preference, enabled = true }: { preference: RenderPreference; enabled?: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const scope = marker.current?.closest<HTMLElement>(".eb-scope, .jata-public");
    if (!scope) return;
    return attachStorefrontMotion(scope, { preference, enabled });
  }, [preference, enabled]);
  return <span ref={marker} hidden aria-hidden="true" data-motion-probe="" />;
}
