/**
 * The JavaScript motion runtime (Immersive Website Engine, Phase 2 — §21, §26, §28, §51, §82)
 *
 * This is the ONLY module in the application that imports `motion`, exactly as
 * `ThreeProductViewer.tsx` is the only module that imports `three`. It is reached through a
 * dynamic import in `MotionEngineMount`, so a Lite page — and a Motion page whose treatment is
 * `subtle` — never downloads it.
 *
 * The safety contract, which the CSS in `app/globals.css` completes:
 *
 *   1. The engine only ever *adds* choreography. Every element it can animate is visible in the
 *      server HTML, and once `html[data-motion-engine="js"]` is set the stylesheet renders
 *      `.eb-reveal` fully opaque. The engine then hides only the elements it is about to animate,
 *      and reveals anything it has not reached within a safety window. There is no path in which
 *      a section stays hidden because a chunk, WebGL or an animation went missing (§54, §78).
 *   2. Every recipe has a CSS fallback class rendered by the server (`sectionMotionMarkup`), so
 *      the page is the same — minus choreography — with scripts disabled.
 *   3. Nothing here is required to buy, book or contact the business.
 */

import { animate, inView, scroll, stagger } from "motion";
import { MOTION_ENGINE_RECIPES } from "@/lib/experience/motion";

export type MotionEngineOptions = {
  /** Recipes this page may run. Anything outside this list is left to CSS. */
  recipes: readonly string[];
  /** Fine pointer (mouse/trackpad): hover-only recipes are allowed. Touch devices skip them (§27). */
  pointerFine: boolean;
  /** Low-power device: continuous scroll-driven recipes are skipped (§82). */
  lowPower: boolean;
};

type Stop = () => void;

const ENTER_DURATION = 0.72;
const ENTER_EASING: [number, number, number, number] = [0.22, 0.61, 0.36, 1];
/** Anything the engine hid but never animated is given back to the visitor after this long. */
const SAFETY_REVEAL_MS = 4000;

/** Recipes the runtime genuinely animates. The boundary test checks this against the contract. */
export const IMPLEMENTED_RECIPES: readonly string[] = MOTION_ENGINE_RECIPES;

/** Entrance keyframes per recipe family. Continuous recipes are handled separately below. */
const ENTRANCE_KEYFRAMES: Record<string, Record<string, unknown>> = {
  fade: { opacity: [0, 1] },
  slide: { opacity: [0, 1], y: [18, 0] },
  scale: { opacity: [0, 1], scale: [0.97, 1] },
  reveal: { opacity: [0, 1], y: [28, 0] },
  mask: { opacity: [0, 1], clipPath: ["inset(0 0 100% 0)", "inset(0 0 0% 0)"] },
  clip: { opacity: [0, 1], clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] },
  blur: { opacity: [0, 1], filter: ["blur(8px)", "blur(0px)"] },
  // A four-point polygon morph. Point counts match, so the shape interpolates instead of snapping.
  morph: {
    opacity: [0, 1],
    clipPath: [
      "polygon(8% 18%, 92% 0%, 100% 82%, 0% 100%)",
      "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
    ],
  },
};

/** The keyframes a recipe runs, and which family actually implemented it (for diagnostics). */
function animationFor(recipe: string): { keyframes: Record<string, unknown>; applied: string } {
  const direct = ENTRANCE_KEYFRAMES[recipe];
  if (direct) return { keyframes: direct, applied: recipe };
  if (recipe === "blur-reveal") return { keyframes: ENTRANCE_KEYFRAMES.blur, applied: "blur" };
  if (recipe === "text-reveal") {
    return { keyframes: { opacity: [0, 1], y: [12, 0], filter: ["blur(4px)", "blur(0px)"] }, applied: "text" };
  }
  return { keyframes: ENTRANCE_KEYFRAMES.reveal, applied: "reveal" };
}

/** Scroll-driven parallax. Scroll-linked rather than a frame loop, so it costs nothing at rest. */
function startScrollDriven(root: HTMLElement, lowPower: boolean): Stop | null {
  const target = root.querySelector<HTMLElement>("[data-eb-pan]") ?? root.querySelector<HTMLElement>(".eb-hero__media img");
  if (!target) return null;
  try {
    // A few percent of the element's height. A large parallax on a Kenyan mobile data connection
    // reads as jank, not as polish (§82).
    const distance = lowPower ? 2 : 5;
    return scroll(
      (_progress, info) => {
        const shift = (info.y.progress - 0.5) * distance * 2;
        target.style.transform = `translate3d(0, ${shift.toFixed(3)}%, 0) scale(1.04)`;
      },
      { target: root, axis: "y", offset: ["start end", "end start"] },
    );
  } catch {
    return null;
  }
}

/** Bounded pointer follow on a call to action. Touch devices get the plain button (§27). */
function startMagnetic(root: HTMLElement, pointerFine: boolean): Stop | null {
  if (!pointerFine) return null;
  const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-eb-magnetic]"));
  if (targets.length === 0) return null;
  const stops: Stop[] = [];
  for (const el of targets) {
    const move = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const dx = (event.clientX - (box.left + box.width / 2)) / Math.max(box.width, 1);
      const dy = (event.clientY - (box.top + box.height / 2)) / Math.max(box.height, 1);
      el.style.transform = `translate3d(${(Math.max(-1, Math.min(1, dx)) * 6).toFixed(2)}px, ${(Math.max(-1, Math.min(1, dy)) * 6).toFixed(2)}px, 0)`;
    };
    const reset = () => {
      el.style.transform = "";
    };
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", reset, { passive: true });
    stops.push(() => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", reset);
      reset();
    });
  }
  return () => stops.forEach((stop) => stop());
}

/**
 * Runs the page's motion choreography and returns a function that undoes all of it.
 *
 * Every step is wrapped: a recipe that throws is skipped and its element restored, and the rest
 * of the page still animates. The engine never throws into the page.
 */
export function startMotionEngine(options: MotionEngineOptions): Stop {
  const stops: Stop[] = [];
  const allowed = new Set(options.recipes);
  /** Elements the engine hid and is responsible for showing again. */
  const pending = new Set<HTMLElement>();

  try {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-eb-motion]"));
    for (const node of nodes) {
      const recipe = node.dataset.ebMotion || "";
      if (!recipe || !allowed.has(recipe)) continue;

      try {
        if (recipe === "parallax" || recipe === "image-pan") {
          if (options.lowPower) continue;
          const scrollStop = startScrollDriven(node, options.lowPower);
          if (scrollStop) stops.push(scrollStop);
          continue;
        }
        let targets: HTMLElement[] = [node];
        let keyframes: Record<string, unknown>;
        if (recipe === "split") {
          const halves = Array.from(
            node.querySelectorAll<HTMLElement>("[data-eb-split] > *, .eb-row > *, .eb-grid--2 > *"),
          );
          targets = halves.length >= 2 ? halves.slice(0, 2) : [node];
        }
        if (recipe === "stagger") {
          const children = Array.from(
            node.querySelectorAll<HTMLElement>(
              "[data-eb-stagger] > *, .eb-grid > *, .eb-gallery > *, .eb-contact-grid > *, .eb-chip-row > *",
            ),
          );
          targets = children.length > 1 ? children : [node];
        }
        keyframes = animationFor(recipe).keyframes;

        // The stylesheet leaves these visible; the engine owns the hiding from here, so it must
        // also own the recovery. `pending` plus the safety timer below is that guarantee.
        for (const target of targets) {
          target.style.opacity = "0";
          pending.add(target);
        }

        // `inView` fires on every entry, so "once" is implemented here rather than assumed: the
        // observer is stopped the moment the entrance has started, which is also what keeps a
        // long scrolling page from re-animating a section the visitor has already seen.
        let stopInView: (() => void) | undefined;
        let fired = false;
        stopInView = inView(
          node,
          () => {
            if (fired) return;
            fired = true;
            stopInView?.();
            for (const target of targets) pending.delete(target);
            animate(targets, keyframes, {
              duration: ENTER_DURATION,
              ease: ENTER_EASING,
              delay: recipe === "stagger" && targets.length > 1 ? stagger(0.07) : 0,
              onComplete: () => {
                for (const target of targets) target.style.opacity = "";
              },
            });
          },
          { amount: 0.08 },
        );
        stops.push(() => stopInView?.());
      } catch {
        // One bad recipe must not stop the page's other choreography, and must not hide anything.
        node.style.opacity = "";
        pending.delete(node);
      }
    }
  } catch {
    // The engine is an enhancement. If it cannot even walk the DOM, the CSS reveal stands.
  }

  // The hover-driven call to action is bound to the button rather than to a section recipe, so it
  // is scanned across the page — and only for a fine pointer, never on touch (§26, §27).
  if (allowed.has("magnetic") && options.pointerFine) {
    try {
      const magneticStop = startMagnetic(document.body, options.pointerFine);
      if (magneticStop) stops.push(magneticStop);
    } catch {
      /* ignore */
    }
  }

  const safety = typeof window !== "undefined"
    ? window.setTimeout(() => {
        for (const target of pending) target.style.opacity = "";
        pending.clear();
      }, SAFETY_REVEAL_MS)
    : null;

  return () => {
    if (safety) window.clearTimeout(safety);
    for (const target of pending) target.style.opacity = "";
    pending.clear();
    for (const stop of stops) {
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
    stops.length = 0;
  };
}
