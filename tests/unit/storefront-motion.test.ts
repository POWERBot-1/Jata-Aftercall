import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { readFileSync } from "node:fs";
import { motionEligibility, type MotionConstraints } from "@/lib/experience/motionPolicy";
import { MOTION_RECIPES, motionRecipeForSection } from "@/lib/experience/motionRecipes";
import { attachStorefrontMotion, MOTION_IMPORT_TIMEOUT_MS, type MiniAnimate } from "@/lib/experience/motionRuntime";
import { MotionReveal } from "@/components/storefront/MotionReveal";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";
import { motionFixture } from "@/app/dev/motion-preview/fixture";

const capable: MotionConstraints = { reducedMotion: false, saveData: false, effectiveType: "4g", deviceMemoryGB: 8, cores: 8, hidden: false, preferencesAvailable: true };

class Style {
  values = new Map<string, { value: string; priority: string }>();
  getPropertyValue(key: string) { return this.values.get(key)?.value || ""; }
  getPropertyPriority(key: string) { return this.values.get(key)?.priority || ""; }
  setProperty(key: string, value: string, priority = "") { this.values.set(key, { value, priority }); }
  removeProperty(key: string) { this.values.delete(key); }
}
function environment() {
  const media = Object.assign(new EventTarget(), { matches: false });
  const connection = Object.assign(new EventTarget(), { saveData: false, effectiveType: "4g" });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null as unknown, defaultView: null as unknown });
  const scope: any = { dataset: {}, isConnected: true, ownerDocument: doc };
  const target: any = { dataset: { motionRecipe: "slide" }, style: new Style(), isConnected: true, ownerDocument: doc, animate: () => {}, getAnimations: () => [], contains: (element: unknown) => element === target, closest: () => scope };
  const foreign: any = { dataset: { motionRecipe: "slide" }, style: new Style(), isConnected: true, closest: () => foreign };
  scope.querySelectorAll = () => [target, foreign];
  const observers: any[] = [];
  class Observer {
    callback: IntersectionObserverCallback;
    observed = new Set<HTMLElement>();
    disconnect = vi.fn(() => this.observed.clear());
    unobserve = vi.fn((element: HTMLElement) => this.observed.delete(element));
    observe = vi.fn((element: HTMLElement) => this.observed.add(element));
    constructor(callback: IntersectionObserverCallback) { this.callback = callback; observers.push(this); }
    enter(element = target, isIntersecting = true, bottom = 10) { this.callback([{ target: element, isIntersecting, boundingClientRect: { bottom } } as any], this as any); }
  }
  const win: any = { matchMedia: () => media, navigator: { hardwareConcurrency: 8, deviceMemory: 8, connection }, IntersectionObserver: Observer, setTimeout, clearTimeout };
  doc.defaultView = win;
  const cancel = vi.fn();
  const animate = vi.fn((element: any) => { element.style.setProperty("opacity", "0.94"); element.style.setProperty("transform", "translateY(10px)"); return { cancel, finished: new Promise(() => {}) }; });
  const loader = vi.fn(async () => animate as MiniAnimate);
  return { scope, target, foreign, win, doc, media, connection, observers, animate, loader, cancel };
}
const cleanups: Array<() => void> = [];
const mount = (env: ReturnType<typeof environment>, options: Record<string, unknown> = {}) => {
  const cleanup = attachStorefrontMotion(env.scope, { preference: "motion", win: env.win, loadMini: env.loader, ...options } as any);
  cleanups.push(cleanup);
  return cleanup;
};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.useRealTimers(); });

describe("safe finite recipes and full SSR", () => {
  it("keeps actual storefront text, prices and contact/shop links in readable server HTML", () => {
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { bfcacheId: "qa-router-fixture", push: () => {}, replace: () => {}, back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => {} } }, createElement(ExperienceSite, { data: motionFixture() })));
    expect(html).toContain("Fresh coastal dishes");
    expect(html).toContain("Coastal lunch (fixture)");
    expect(html).toContain("KES 149");
    expect(html).toContain('href="/b/motion-fixture/shop"');
    expect(html).toContain('href="tel:0700000000"');
    expect(html).not.toMatch(/style="[^"]*opacity:0(?:;|")/);
    expect(html).not.toContain("<canvas");
  });
  it("recipe wrapper never hides content or adds inline animation state during SSR", () => {
    const html = renderToStaticMarkup(createElement(MotionReveal, { expressive: true, children: createElement("button", null, "Order now") }));
    expect(html).toContain('data-motion-recipe="reveal"');
    expect(html).toContain("Order now");
    expect(html).not.toMatch(/hidden|aria-hidden|style=|opacity/);
  });
  it("all presets are finite, fully readable and compositor-only", () => {
    for (const recipe of Object.values(MOTION_RECIPES)) {
      expect(recipe.duration).toBeGreaterThan(0);
      expect(recipe.duration).toBeLessThanOrEqual(0.6);
      expect(recipe.keyframes.opacity.every((value) => value >= 0.9 && value <= 1)).toBe(true);
      expect(Object.keys(recipe.keyframes).every((key) => ["opacity", "transform"].includes(key))).toBe(true);
    }
    expect(motionRecipeForSection("contact", true)).toBe("fade");
    expect(motionRecipeForSection("gallery")).toBe("scale");
  });
  it("uses only a dynamic mini import and removes the global hidden-state CSS", () => {
    const source = readFileSync(new URL("../../lib/experience/motionRuntime.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(source).toMatch(/import\([^)]*"motion\/mini"\)/);
    expect(source).not.toMatch(/from ["']motion|three|requestAnimationFrame/);
    expect(css).not.toContain("html[data-motion-ready]");
    expect(css).toContain(".eb-scope.eb-nav--sticky > .eb-nav");
    expect(css).not.toMatch(/\.eb-nav--sticky\s*\{/);
    expect(css).toContain(".eb-scope.eb-btn--upper .eb-btn");
    expect(css).not.toMatch(/\.eb-btn--upper\s*\{/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe("presentation constraints", () => {
  it.each([
    [{ reducedMotion: true }, "reduced-motion"], [{ saveData: true }, "save-data"],
    [{ effectiveType: "2g" }, "slow-connection"], [{ effectiveType: "3g" }, "slow-connection"],
    [{ hidden: true }, "background"], [{ deviceMemoryGB: 1 }, "low-resources"],
    [{ cores: 2 }, "low-resources"], [{ preferencesAvailable: false }, "preferences-unavailable"],
  ])("refuses decoration for constrained visitors: %j", (patch, reason) => {
    expect(motionEligibility("motion", { ...capable, ...patch })).toEqual({ allowed: false, reason });
  });
  it("honors owner Lite/none and does not invent a score for unknown hardware", () => {
    expect(motionEligibility("lite", capable).allowed).toBe(false);
    expect(motionEligibility("motion", capable, false).allowed).toBe(false);
    expect(motionEligibility("auto", { ...capable, cores: null, deviceMemoryGB: null }).allowed).toBe(true);
  });
});

describe("scoped lazy controller (unit doubles, not browser evidence)", () => {
  it("loads only on intersection, only animates owned elements and restores original styles on finish", async () => {
    vi.useFakeTimers();
    const env = environment();
    env.target.style.setProperty("opacity", "0.98", "important");
    mount(env);
    expect(env.loader).not.toHaveBeenCalled();
    expect(env.observers[0].observed.has(env.foreign)).toBe(false);
    env.observers[0].enter(); await flush();
    expect(env.loader).toHaveBeenCalledTimes(1);
    expect(env.animate).toHaveBeenCalledTimes(1);
    expect(env.animate.mock.calls[0][0]).toBe(env.target);
    expect(env.scope.dataset.motionEngine).toBe("mini");
    await vi.advanceTimersByTimeAsync(800);
    expect(env.target.style.getPropertyValue("opacity")).toBe("0.98");
    expect(env.target.style.getPropertyPriority("opacity")).toBe("important");
    expect(env.target.style.getPropertyValue("transform")).toBe("");
    expect(env.cancel).toHaveBeenCalledTimes(1);
  });
  it("does not load in owner Lite or initially reduced motion", () => {
    const lite = environment(); mount(lite, { preference: "lite" });
    const reduced = environment(); reduced.media.matches = true; mount(reduced);
    expect(lite.observers).toHaveLength(0);
    expect(reduced.observers).toHaveLength(0);
    expect(lite.loader).not.toHaveBeenCalled();
    expect(reduced.loader).not.toHaveBeenCalled();
  });
  it("cancels immediately on a live reduced-motion change", async () => {
    const env = environment(); mount(env); env.observers[0].enter(); await flush();
    env.media.matches = true; env.media.dispatchEvent(new Event("change"));
    expect(env.cancel).toHaveBeenCalledTimes(1);
    expect(env.scope.dataset.renderMode).toBe("lite");
    expect(env.scope.dataset.motionReason).toBe("reduced-motion");
    expect(env.target.style.getPropertyValue("transform")).toBe("");
  });
  it("ignores a pending import after preferences change or the scope unmounts", async () => {
    const env = environment(); let release: (value: MiniAnimate) => void;
    env.loader.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const cleanup = mount(env); env.observers[0].enter(); await flush();
    env.media.matches = true; env.media.dispatchEvent(new Event("change")); cleanup();
    release!(env.animate as MiniAnimate); await flush();
    expect(env.animate).not.toHaveBeenCalled();
    expect(env.scope.dataset.renderMode).toBe("lite");
  });
  it("reacts to live Save-Data, network and tab-visibility changes", async () => {
    const env = environment(); mount(env); env.observers[0].enter(); await flush();
    env.connection.saveData = true; env.connection.dispatchEvent(new Event("change"));
    expect(env.cancel).toHaveBeenCalledTimes(1);
    expect(env.scope.dataset.motionReason).toBe("save-data");
    env.connection.saveData = false; env.connection.effectiveType = "3g"; env.connection.dispatchEvent(new Event("change"));
    expect(env.scope.dataset.motionReason).toBe("slow-connection");
    env.connection.effectiveType = "4g"; env.connection.dispatchEvent(new Event("change"));
    expect(env.scope.dataset.renderMode).toBe("motion");
    env.doc.visibilityState = "hidden"; env.doc.dispatchEvent(new Event("visibilitychange"));
    expect(env.scope.dataset.motionReason).toBe("background");
  });
  it("falls back to finite CSS if the mini chunk fails", async () => {
    vi.useFakeTimers();
    const env = environment(); env.loader.mockRejectedValue(new Error("blocked chunk"));
    mount(env); env.observers[0].enter(); await flush();
    expect(env.animate).not.toHaveBeenCalled();
    expect(env.scope.dataset.motionEngine).toBe("css");
    expect(env.target.dataset.motionCss).toBe("slide");
    await vi.advanceTimersByTimeAsync(800);
    expect(env.target.dataset.motionCss).toBeUndefined();
  });
  it("does not wait forever for a hung chunk and content was never hidden", async () => {
    vi.useFakeTimers(); const env = environment(); env.loader.mockImplementation(() => new Promise(() => {}));
    mount(env); env.observers[0].enter(); await flush();
    expect(env.target.style.getPropertyValue("opacity")).toBe("");
    await vi.advanceTimersByTimeAsync(MOTION_IMPORT_TIMEOUT_MS + 1);
    expect(env.scope.dataset.motionEngine).toBe("css");
  });
  it("old WebViews without WAAPI use CSS without loading the library", async () => {
    const env = environment(); env.target.animate = undefined; mount(env); env.observers[0].enter(); await flush();
    expect(env.loader).not.toHaveBeenCalled();
    expect(env.target.dataset.motionPlayed).toBe("css");
  });
  it("missing/failed observers retain static content and never load mini", () => {
    const missing = environment(); missing.win.IntersectionObserver = undefined; mount(missing);
    const broken = environment(); broken.win.IntersectionObserver = class { constructor() { throw new Error("observer failed"); } }; mount(broken);
    expect(missing.scope.dataset.motionReason).toBe("observer-unavailable");
    expect(broken.scope.dataset.motionReason).toBe("observer-failed");
    expect(missing.loader).not.toHaveBeenCalled(); expect(broken.loader).not.toHaveBeenCalled();
  });
  it("never animates a focused interaction or an already-passed section", async () => {
    const focused = environment(); focused.doc.activeElement = focused.target; mount(focused); focused.observers[0].enter();
    const passed = environment(); mount(passed); passed.observers[0].enter(passed.target, false, -10);
    await flush();
    expect(focused.loader).not.toHaveBeenCalled(); expect(passed.loader).not.toHaveBeenCalled();
  });
  it("supports legacy media-query listeners and refuses a broken live-preference subscription", async () => {
    const env = environment(); let changed: () => void;
    const legacy = { matches: false, addListener: (callback: () => void) => { changed = callback; }, removeListener: vi.fn() };
    env.win.matchMedia = () => legacy;
    mount(env); env.observers[0].enter(); await flush(); legacy.matches = true; changed!();
    expect(env.cancel).toHaveBeenCalledTimes(1);
    expect(env.scope.dataset.motionReason).toBe("reduced-motion");
    const broken = environment(); (broken.media as any).addEventListener = () => { throw new Error("blocked listener"); };
    mount(broken);
    expect(broken.scope.dataset.renderMode).toBe("lite");
    expect(broken.loader).not.toHaveBeenCalled();
  });
  it("bounds simultaneous reveals even when many sections enter while mini loads", async () => {
    const env = environment();
    const many = Array.from({ length: 30 }, () => ({ ...env.target, dataset: { motionRecipe: "slide" }, style: new Style() }));
    env.scope.querySelectorAll = () => many;
    mount(env); for (const target of many) env.observers[0].enter(target); await flush();
    expect(env.loader).toHaveBeenCalledTimes(1);
    expect(env.animate).toHaveBeenCalledTimes(8);
  });
  it("ignores unknown/prototype recipe names instead of accepting executable animation config", () => {
    const env = environment(); env.target.dataset.motionRecipe = "__proto__"; mount(env);
    expect(env.observers[0].observed.size).toBe(0);
    expect(env.loader).not.toHaveBeenCalled();
  });
  it("rolls back a partial native animation failure without cancelling unrelated animations", async () => {
    const env = environment(); const original = { cancel: vi.fn() }, partial = { cancel: vi.fn() };
    let animations = [original]; env.target.getAnimations = () => animations;
    env.animate.mockImplementation(() => { animations = [original, partial]; throw new Error("partial WAAPI failure"); });
    mount(env); env.observers[0].enter(); await flush();
    expect(partial.cancel).toHaveBeenCalledTimes(1);
    expect(original.cancel).not.toHaveBeenCalled();
    expect(env.scope.dataset.motionEngine).toBe("css");
    expect(env.target.style.getPropertyValue("transform")).toBe("");
  });
  it("static guards only mark owned targets, including when another scope is nested", () => {
    const env = environment(); const other = { ...env.target, dataset: { motionRecipe: "fade" }, closest: () => ({}) };
    env.scope.querySelectorAll = () => [env.target, other]; mount(env, { preference: "lite" });
    expect(env.target.dataset.motionStatic).toBe("true");
    expect((other.dataset as any).motionStatic).toBeUndefined();
    expect(readFileSync("app/globals.css", "utf8")).not.toMatch(/\[data-render-mode="lite"\]\s+\[data-motion/);
  });
  it("a missing or throwing animation-enumeration API uses CSS without fetching mini", () => {
    for (const getAnimations of [undefined, () => { throw new Error("broken API"); }]) {
      const env = environment(); env.target.getAnimations = getAnimations as any; mount(env); env.observers[0].enter();
      expect(env.scope.dataset.motionEngine).toBe("css"); expect(env.loader).not.toHaveBeenCalled();
    }
  });
  it("cleanup disconnects observers/listeners and cancels owned controls, without touching foreign styles", async () => {
    const env = environment(); env.foreign.style.setProperty("transform", "scale(2)");
    const cleanup = mount(env); env.observers[0].enter(); await flush(); cleanup();
    const count = env.observers.length;
    env.media.dispatchEvent(new Event("change")); env.connection.dispatchEvent(new Event("change"));
    expect(env.observers).toHaveLength(count);
    expect(env.observers[0].disconnect).toHaveBeenCalled();
    expect(env.cancel).toHaveBeenCalledTimes(1);
    expect(env.foreign.style.getPropertyValue("transform")).toBe("scale(2)");
  });
});
