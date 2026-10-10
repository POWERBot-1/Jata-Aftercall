"use client";

/**
 * Scroll reveal for one page section (Immersive Website Engine, Phase 2).
 *
 * Visual state is controlled entirely by CSS under `html[data-motion-ready]`, so in Lite mode
 * this wrapper is inert and the content is always visible. The element is marked `is-visible`
 * once it enters the viewport, or once the visitor has scrolled past it. Without
 * IntersectionObserver, or if the observer never fires, the content is revealed after a short
 * safety timeout, so nothing is ever left blank.
 */

import { useEffect, useRef, type ReactNode } from "react";

const SAFETY_REVEAL_MS = 4000;

export function MotionReveal({ children, expressive = false }: { children: ReactNode; expressive?: boolean }) {
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

  return <div ref={ref} className={expressive ? "eb-reveal eb-reveal--expressive" : "eb-reveal"}>{children}</div>;
}
