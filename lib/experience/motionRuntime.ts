/**
 * One bounded controller per storefront. The real motion/mini library is loaded on the first
 * eligible intersection, never on a Lite/reduced-motion/Save-Data page. No WebGL probe needed.
 * No hidden SSR state: import, observer, animation and old-WebView failures retain readable HTML.
 */
import type { RenderPreference } from "./renderMode";
import { isMotionRecipe, MOTION_RECIPES, type MotionRecipe } from "./motionRecipes";
import { motionEligibility, type MotionConstraints } from "./motionPolicy";

export const MOTION_IMPORT_TIMEOUT_MS = 2000;
const MAX_ACTIVE_REVEALS = 8;
export type MiniControls = { cancel(): void; finished?: Promise<unknown> };
export type MiniAnimate = (element: HTMLElement, frames: MotionRecipe["keyframes"], options: { duration: number; ease: "easeOut" }) => MiniControls;
type MotionConnection = EventTarget & { effectiveType?: string; saveData?: boolean };

// This is the application's only runtime motion import; bundlers put it in a separate async chunk.
const loadMini = async (): Promise<MiniAnimate> => (await import(/* webpackChunkName: "website-studio-motion-mini" */ "motion/mini")).animate as MiniAnimate;

export function attachStorefrontMotion(scope: HTMLElement, options: {
  preference: RenderPreference;
  enabled?: boolean;
  /** Injected only by unit tests. Real browser checks use the actual mini import. */
  loadMini?: () => Promise<MiniAnimate>;
  win?: Window;
}): () => void {
  const win = options.win || scope.ownerDocument.defaultView;
  if (!win) return () => {};
  const doc = scope.ownerDocument;
  let disposed = false;
  let eligible = false;
  let epoch = 0;
  let observer: IntersectionObserver | null = null;
  let library: Promise<MiniAnimate> | null = null;
  let loadTimer: number | undefined;
  let libraryFailed = false;
  let media: MediaQueryList | null = null;
  let connection: MotionConnection | null = null;
  let subscriptionsAvailable = true;
  const seen = new WeakSet<HTMLElement>();
  const pending = new Set<HTMLElement>();
  // Bounded by targets (40); entries are removed if they leave the viewport.
  const queued = new Set<HTMLElement>();
  const active = new Map<HTMLElement, () => void>();
  const listeners: Array<() => void> = [];
  const targets = Array.from(scope.querySelectorAll<HTMLElement>("[data-motion-recipe]"))
    .filter((element) => element.closest(".eb-scope, .jata-public") === scope && isMotionRecipe(element.dataset.motionRecipe)).slice(0, 40);

  try { media = win.matchMedia("(prefers-reduced-motion: reduce)"); } catch { /* static when preference cannot be read */ }
  try { connection = (win.navigator as Navigator & { connection?: MotionConnection }).connection || null; } catch { /* unknown network */ }

  const constraints = (): MotionConstraints => {
    try {
      const nav = win.navigator as Navigator & { deviceMemory?: number; connection?: MotionConnection };
      const net = nav.connection;
      return {
        reducedMotion: media?.matches ?? true, preferencesAvailable: Boolean(media) && subscriptionsAvailable,
        saveData: Boolean(net?.saveData), effectiveType: typeof net?.effectiveType === "string" ? net.effectiveType : null,
        deviceMemoryGB: typeof nav.deviceMemory === "number" && Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null,
        cores: typeof nav.hardwareConcurrency === "number" && Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
        hidden: doc.visibilityState === "hidden",
      };
    } catch {
      return { reducedMotion: true, preferencesAvailable: false, saveData: false, effectiveType: null, deviceMemoryGB: null, cores: null, hidden: false };
    }
  };
  const allowedNow = () => !disposed && scope.isConnected && motionEligibility(options.preference, constraints(), options.enabled).allowed;
  const cancelActive = () => { for (const cancel of [...active.values()]) cancel(); };
  const reset = (reason: string) => {
    epoch += 1;
    eligible = false;
    queued.clear();
    // Guard only owned targets: independently controlled nested storefronts are not ours.
    for (const element of targets) element.dataset.motionStatic = "true";
    observer?.disconnect();
    observer = null;
    cancelActive();
    scope.dataset.renderMode = "lite";
    scope.dataset.motionEngine = "static";
    scope.dataset.motionReason = reason;
  };
  const getMini = () => {
    if (!library) {
      scope.dataset.motionEngine = "loading";
      library = new Promise<MiniAnimate>((resolve, reject) => {
        loadTimer = win.setTimeout(() => { libraryFailed = true; reject(new Error("motion import timeout")); }, MOTION_IMPORT_TIMEOUT_MS);
        Promise.resolve().then(options.loadMini || loadMini).then(
          (animate) => { win.clearTimeout(loadTimer); resolve(animate); },
          (error) => { win.clearTimeout(loadTimer); libraryFailed = true; reject(error); },
        );
      });
    }
    return library;
  };

  const cssReveal = (element: HTMLElement, duration: number) => {
    element.dataset.motionCss = element.dataset.motionRecipe;
    element.dataset.motionPlayed = "css";
    scope.dataset.motionEngine = "css";
    const timer = win.setTimeout(() => finish(), duration * 1000 + 100);
    const finish = () => { win.clearTimeout(timer); delete element.dataset.motionCss; active.delete(element); drainQueue(); };
    active.set(element, finish);
  };

  const reveal = async (element: HTMLElement) => {
    const generation = epoch;
    if (pending.size + active.size >= MAX_ACTIVE_REVEALS) return;
    pending.add(element);
    const key = element.dataset.motionRecipe;
    if (!isMotionRecipe(key)) { pending.delete(element); return; }
    const recipe = MOTION_RECIPES[key];
    const stillEligible = () => generation === epoch && allowedNow() && element.isConnected && element.closest(".eb-scope, .jata-public") === scope && !element.contains(doc.activeElement);
    const animationsOnTarget = (): Animation[] | null => {
      try {
        if (typeof element.getAnimations !== "function") return null;
        const animations = element.getAnimations();
        return Array.isArray(animations) ? animations : null;
      } catch { return null; }
    };
    try {
      if (!stillEligible()) return;
      if (typeof element.animate !== "function" || animationsOnTarget() === null || libraryFailed) {
        cssReveal(element, recipe.duration);
        return;
      }
      let animate: MiniAnimate;
      try { animate = await getMini(); } catch {
        if (stillEligible()) cssReveal(element, recipe.duration);
        return;
      }
      if (!stillEligible()) return; // preference/network/unmount changed while chunk loaded
      const previous = ["opacity", "transform"].map((property) => ({ property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) }));
      const currentAnimations = animationsOnTarget();
      if (currentAnimations === null) { cssReveal(element, recipe.duration); return; }
      const priorAnimations = new Set(currentAnimations);
      let controls: MiniControls | undefined;
      let timer: number | undefined;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        win.clearTimeout(timer);
        try { controls?.cancel(); } catch { /* restore even if native cancel fails */ }
        for (const { property, value, priority } of previous) {
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        }
        active.delete(element);
        drainQueue();
      };
      try {
        // Element references only — no global selector, generated code, arbitrary timeline or price edits.
        controls = animate(element, { ...recipe.keyframes, opacity: [...recipe.keyframes.opacity], ...(recipe.keyframes.transform ? { transform: [...recipe.keyframes.transform] } : {}) }, { duration: recipe.duration, ease: "easeOut" });
        active.set(element, finish);
        element.dataset.motionPlayed = "mini";
        scope.dataset.motionEngine = "mini";
        timer = win.setTimeout(finish, recipe.duration * 1000 + 150);
        controls.finished?.then(finish, finish);
      } catch {
        // A broken WAAPI implementation can throw after creating the first property animation.
        // Cancel only animations started by this attempt, never unrelated effects on the element.
        for (const animation of animationsOnTarget() || []) {
          if (!priorAnimations.has(animation)) { try { animation.cancel(); } catch { /* Lite CSS guard remains */ } }
        }
        finish();
        libraryFailed = true;
        if (stillEligible()) cssReveal(element, recipe.duration);
      }
    } finally { pending.delete(element); drainQueue(); }
  };

  function drainQueue() {
    if (!eligible || !allowedNow()) return;
    while (queued.size && pending.size + active.size < MAX_ACTIVE_REVEALS) {
      const element = queued.values().next().value as HTMLElement;
      queued.delete(element);
      if (seen.has(element) || !element.isConnected || element.closest(".eb-scope, .jata-public") !== scope) continue;
      seen.add(element);
      observer?.unobserve(element);
      void reveal(element);
    }
  }

  const update = () => {
    if (disposed) return;
    const decision = motionEligibility(options.preference, constraints(), options.enabled);
    if (!decision.allowed) { reset(decision.reason); return; }
    if (eligible) return;
    const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    if (!Observer) { reset("observer-unavailable"); return; }
    try {
      observer = new Observer((entries) => {
        if (!eligible || !allowedNow()) return;
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          if (seen.has(element)) continue;
          if (entry.isIntersecting) {
            queued.add(element);
          } else {
            queued.delete(element);
            // Already scrolled past content needs no decoration and is never hidden.
            if (entry.boundingClientRect.bottom < 0) { seen.add(element); observer?.unobserve(element); }
          }
        }
        drainQueue();
      }, { threshold: 0.08, rootMargin: "0px 0px -4% 0px" });
      eligible = true;
      for (const element of targets) delete element.dataset.motionStatic;
      scope.dataset.renderMode = "motion";
      scope.dataset.motionEngine = "idle";
      scope.dataset.motionReason = "eligible";
      for (const element of targets) if (!seen.has(element)) observer.observe(element);
    } catch { reset("observer-failed"); }
  };

  const listen = (target: EventTarget | null, event: string) => {
    try {
      if (!target) return true;
      if (typeof target.addEventListener !== "function") return false;
      target.addEventListener(event, update);
      listeners.push(() => target.removeEventListener(event, update));
      return true;
    } catch { return false; }
  };
  // If a user tabs into a section while its reveal is running, immediately restore that
  // section instead of moving an active control under the keyboard or assistive technology.
  // This applies to both the mini engine and the CSS fallback; pending imports already
  // re-check document.activeElement before starting.
  const stopFocusedReveal = (event: Event) => {
    const focused = event.target;
    if (!focused) return;
    for (const [element, cancel] of [...active]) {
      if (element.contains(focused as Node)) cancel();
    }
  };
  try {
    scope.addEventListener("focusin", stopFocusedReveal);
    listeners.push(() => scope.removeEventListener("focusin", stopFocusedReveal));
  } catch {
    // If focus changes cannot be observed, do not animate interactive storefront content.
    subscriptionsAvailable = false;
  }
  if (media) {
    if (typeof media.addEventListener === "function") subscriptionsAvailable = listen(media, "change") && subscriptionsAvailable;
    else if (typeof media.addListener === "function") {
      try { media.addListener(update); listeners.push(() => media?.removeListener(update)); } catch { media = null; }
    } else media = null; // cannot honor live preferences: stay Lite
  }
  subscriptionsAvailable = listen(connection, "change") && subscriptionsAvailable;
  subscriptionsAvailable = listen(doc, "visibilitychange") && subscriptionsAvailable;
  update();

  return () => {
    if (disposed) return;
    reset("unmounted");
    disposed = true;
    win.clearTimeout(loadTimer);
    for (const remove of listeners) { try { remove(); } catch { /* old WebView */ } }
  };
}
