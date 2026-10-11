"use client";

/**
 * Scroll reveal for one page section (Immersive Website Engine, Phase 2).
 *
 * Visual state is controlled entirely by CSS under `html[data-motion-ready]`, so in Lite mode
 * this wrapper is inert and the content is always visible. The element is marked `is-visible`
 * once it enters the viewport, or once the visitor has scrolled past it. Without
 * IntersectionObserver, or if the observer never fires, the content is revealed after a short
 * safety timeout, so nothing is ever left blank.
 *
 * When the JavaScript motion engine loads it takes over for sections that carry a
 * `data-eb-motion` recipe: the stylesheet then leaves this wrapper opaque and the engine owns the
 * entrance. The wrapper itself does not know or care whether that happened — the recipe is data,
 * and the CSS above is the fallback either way. This module never imports `motion`.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { sectionMotionMarkup } from "@/lib/experience/motion";
import type { MotionLevel } from "@/lib/experience/themes";

const SAFETY_REVEAL_MS = 4000;

export function MotionReveal({
  children,
  motionLevel = "subtle",
  recipe = null,
}: {
  children: ReactNode;
  motionLevel?: MotionLevel;
  /** Recipe key from `lib/experience/motion.ts`. Null keeps the section on CSS only. */
  recipe?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => el.classList.add("is-visible");

    if (typeof IntersectionObserver === "undefined") {
      reveal();
      return;
    }

    let observer: IntersectionObserver | null = null;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          // A block the visitor has already scrolled past (for example while scripts were still
          // loading) is above the viewport when the observer first attaches. It counts as seen, so
          // it is revealed now rather than waiting for the safety timer or a scroll back up.
          if (entries.some((entry) => entry.isIntersecting || entry.boundingClientRect.bottom < 0)) {
            reveal();
            observer?.disconnect();
          }
        },
        { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
      );
      observer.observe(el);
    } catch {
      reveal();
      return;
    }

    const safety = window.setTimeout(() => {
      reveal();
      observer?.disconnect();
    }, SAFETY_REVEAL_MS);

    return () => {
      window.clearTimeout(safety);
      observer?.disconnect();
    };
  }, []);

  const markup = sectionMotionMarkup({ motionLevel, recipe });

  return (
    <div ref={ref} className={markup.className || undefined} data-eb-motion={markup.recipe ?? undefined}>
      {children}
    </div>
  );
}
