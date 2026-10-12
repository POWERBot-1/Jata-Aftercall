/**
 * Focused tests for the M11 pre-hydration MutationObserver ring-buffer diagnostic
 * (scripts/browser/hydration-mutation-probe.mjs). Issue #418 evidence tooling only —
 * these tests run in the node environment with minimal DOM shims (no new dependencies).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROBE_PROPERTY,
  probeInstallSource,
  formatProbeDump,
  PROBE_MAX_RECORDS,
} from "@/scripts/browser/hydration-mutation-probe.mjs";

// ─── minimal DOM shims ────────────────────────────────────────────────────────────

class FakeElement {
  nodeType = 1;
  id = "";
  className = "";
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  constructor(public nodeName: string, attrs: Record<string, string> = {}) {
    this.attributes = { ...attrs };
    this.id = attrs.id ?? "";
    this.className = attrs.class ?? "";
  }
  getAttribute(name: string): string | null {
    return name in this.attributes ? this.attributes[name] : null;
  }
  append(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  closest(selectorList: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node) {
      if (matchesSelector(node, selectorList)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

function matchesSelector(el: FakeElement, selectorList: string): boolean {
  return selectorList
    .split(",")
    .map((part) => part.trim())
    .some((part) => {
      if (part.startsWith("[") && part.endsWith("]")) return el.getAttribute(part.slice(1, -1)) !== null;
      if (part.startsWith(".")) return (el.className || "").split(/\s+/).includes(part.slice(1));
      return false;
    });
}

function collectMatches(root: FakeElement | FakeDocument, selectorList: string): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (node: FakeElement) => {
    if (matchesSelector(node, selectorList)) out.push(node);
    node.children.forEach(walk);
  };
  (root as FakeDocument).children.forEach(walk);
  return out;
}

class FakeText {
  nodeType = 3;
  constructor(public data: string) {}
}
class FakeComment {
  nodeType = 8;
  constructor(public data: string) {}
}

class FakeDocument {
  nodeType = 9;
  readyState = "loading";
  children: FakeElement[] = [];
  body: FakeElement | null = null;
  documentElement: FakeElement | null = null;
  querySelectorAll = (selectorList: string) => collectMatches(this, selectorList);
  private listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  /** Advance readyState and notify readystatechange listeners (parser done → interactive). */
  reach(state: "interactive" | "complete") {
    this.readyState = state;
    this.listeners.get("readystatechange")?.forEach((fn) => fn());
  }
}

class FakeMutationObserver {
  static last: FakeMutationObserver | null = null;
  observed: { root: unknown; options: Record<string, unknown> } | null = null;
  constructor(public callback: (records: Array<Record<string, unknown>>) => void) {
    FakeMutationObserver.last = this;
  }
  observe(root: unknown, options: Record<string, unknown>) {
    this.observed = { root, options };
  }
  trigger(records: Array<Record<string, unknown>>) {
    const filter = (this.observed?.options?.attributeFilter ?? null) as string[] | null;
    const allowed = records.filter((record) => {
      if (record.type !== "attributes" || !filter) return true;
      return filter.includes(String(record.attributeName));
    });
    if (allowed.length) this.callback(allowed);
  }
}

function installProbe(options: { maxRecords?: number; snapshotTail?: number; outlineLimit?: number; readyState?: "loading" | "interactive" | "complete" } = {}) {
  FakeMutationObserver.last = null;
  const document = new FakeDocument();
  if (options.readyState) document.readyState = options.readyState;
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const window: Record<string, unknown> = {
    self: null,
    top: null,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };
  window.self = window;
  window.top = window; // default same-origin top
  const location = { pathname: "/b/qa-fixture?preview=draft" };
  const performance = { now: () => 1234.5 };
  const source = probeInstallSource(options);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("window", "document", "MutationObserver", "performance", "location", source)(
    window,
    document,
    FakeMutationObserver,
    performance,
    location,
  );
  return { document, window, listeners, observer: FakeMutationObserver.last! };
}

function childList(target: FakeElement | FakeDocument, added: unknown[] = [], removed: unknown[] = []) {
  return { type: "childList", target, addedNodes: added, removedNodes: removed };
}
function attr(target: FakeElement, attributeName: string) {
  return { type: "attributes", target, attributeName };
}
const recordSeqs = (window: Record<string, unknown>) =>
  ((window[PROBE_PROPERTY] as { records: () => Array<Array<unknown>> }).records() as Array<Array<unknown>>).map((r) => r[0]);

// ─── tests ────────────────────────────────────────────────────────────────────────

describe("hydration MutationObserver ring-buffer probe (M11 diagnostic)", () => {
  it("installs before hydration and preserves ordered mutation history", () => {
    const { document, window, observer } = installProbe();
    // Installed at document-start: nothing is observed yet while the parser is still building
    // the server HTML (parse mutations are noise, not divergence).
    expect(observer.observed).toBeNull();
    // The arm point is interactive — before deferred scripts and hydration run.
    document.reach("interactive");
    expect(observer.observed?.root).toBe(document);
    expect(observer.observed?.options).toMatchObject({ childList: true, subtree: true, attributes: true });

    // Simulated hydration: nodes appear in document order after the arm point.
    const html = new FakeElement("html");
    document.documentElement = html;
    const body = html.append(new FakeElement("body", { class: "min-h-screen" }));
    const scope = body.append(new FakeElement("div", { class: "eb-scope", "data-template-family": "marketplace" }));
    observer.trigger([childList(document, [html])]);
    observer.trigger([childList(body, [scope])]);
    const catalogue = scope.append(new FakeElement("div", { "data-catalogue-layout": "grid" }));
    observer.trigger([childList(scope, [catalogue])]);

    const records = (window[PROBE_PROPERTY] as { records: () => Array<Array<unknown>> }).records();
    expect(records.map((r) => r[0])).toEqual([0, 1, 2]); // monotonic, insertion order
    expect(records[0][2]).toBe("childList");
    expect(records[1][3]).toBe("body.min-h-screen");
    expect(records[2][6]).toBe("catalogue"); // zone classified from stable markers
  });

  it("bounds the ring buffer while keeping sequence continuity", () => {
    const { document, window, observer } = installProbe({ maxRecords: 5 });
    document.reach("interactive");
    const target = new FakeElement("div");
    for (let i = 0; i < 12; i += 1) observer.trigger([childList(target, [new FakeElement("span")])]);
    const state = (window[PROBE_PROPERTY] as { state: () => { seq: number; size: number; max: number } }).state();
    expect(state.size).toBe(5);
    expect(state.max).toBe(5);
    expect(state.seq).toBe(12);
    expect(recordSeqs(window)).toEqual([7, 8, 9, 10, 11]); // oldest dropped, no reuse
  });

  it("freezes a bounded snapshot on the first error and stops recording recovery churn", () => {
    const { document, window, observer, listeners } = installProbe({ maxRecords: 50, snapshotTail: 4 });
    document.reach("interactive");
    const body = new FakeElement("body");
    for (let i = 0; i < 6; i += 1) observer.trigger([childList(body, [new FakeElement("div")])]);
    // Error fires (window error capture runs before the runner's pageerror read).
    listeners.get("error")?.forEach((fn) => fn({ message: "Minified React error #418" }));
    const probe = window[PROBE_PROPERTY] as {
      snapshot: () => { reason: string; tail: unknown[]; counts: Record<string, number>; outline: string } | null;
      state: () => { frozen: boolean; size: number };
    };
    const snap = probe.snapshot();
    expect(snap?.reason).toContain("Minified React error #418");
    expect(snap?.tail).toHaveLength(4); // bounded snapshot tail
    expect(snap?.counts).toEqual({ catalogue: 0, motionRecipe: 0, motionStatic: 0 });
    // React recovery mutations after the error must not overwrite history.
    observer.trigger([childList(body, [new FakeElement("div")])]);
    expect(probe.state().frozen).toBe(true);
    expect(probe.state().size).toBe(6);
  });

  it("records only the narrow attribute filter and never mutates the DOM", () => {
    const { document, window, observer } = installProbe();
    document.reach("interactive");
    const target = new FakeElement("div", { "data-motion-recipe": "hero" });
    observer.trigger([attr(target, "class")]); // noise — ignored
    observer.trigger([attr(target, "data-motion-static")]); // candidate-cause marker — kept
    observer.trigger([attr(target, "hidden")]);
    const records = (window[PROBE_PROPERTY] as { records: () => Array<Array<unknown>> }).records();
    expect(records).toHaveLength(2);
    expect(records[0][2]).toBe("attr:data-motion-static");
    expect(records[1][2]).toBe("attr:hidden");
    // The observer callback only reads: the target node is unchanged.
    expect(target.getAttribute("class")).toBe(null);
    expect(target.getAttribute("data-motion-static")).toBe(null);
    expect(target.children).toHaveLength(0);
  });

  it("does not fail when the frame/top boundary is inaccessible (cross-origin iframe)", () => {
    const { document, window, observer } = installProbe();
    document.reach("interactive");
    Object.defineProperty(window, "top", { get: () => { throw new Error("Blocked a frame with origin"); } });
    const target = new FakeElement("div");
    expect(() => observer.trigger([childList(target, [new FakeElement("span")])])).not.toThrow();
    const state = (window[PROBE_PROPERTY] as { state: () => { frame: string } }).state();
    expect(state.frame).toBe("cross-origin:/b/qa-fixture?preview=draft");
  });

  it("arms immediately when the document is already past parsing", () => {
    const { document, observer } = installProbe({ readyState: "complete" });
    // readyState complete at install → observe() happens synchronously.
    expect(observer.observed?.root).toBe(document);
  });

  it("formatProbeDump compacts frozen and live frames and reports inaccessible ones", () => {
    const frozenDump = JSON.parse(
      formatProbeDump([
        {
          path: "/b/qa-retail-1",
          probe: {
            state: () => ({ seq: 10, size: 10, frozen: true, frame: "iframe:/b/qa-retail-1" }),
            snapshot: () => ({
              reason: "error:Minified React error #418",
              ready: "complete",
              frame: "iframe:/b/qa-retail-1",
              counts: { catalogue: 1, motionRecipe: 6, motionStatic: 6 },
              outline: "body>div.business-route-root>div.eb-scope",
              tail: [[0, 1, "childList", "body", "div", "", "app"]],
            }),
          },
        },
        { path: "/dashboard/x/preview", probe: null },
        { path: "about:blank", inaccessible: "cross-origin" },
      ]),
    );
    expect(frozenDump.frames).toHaveLength(3);
    expect(frozenDump.frames[0].frozen).toBe(true);
    expect(frozenDump.frames[0].reason).toContain("#418");
    expect(frozenDump.frames[0].counts.motionStatic).toBe(6);
    expect(frozenDump.frames[1].installed).toBe(false);
    expect(frozenDump.frames[2].inaccessible).toBe("cross-origin");
  });

  it("the runner installs the probe via evaluateOnNewDocument and ships no app-side telemetry", () => {
    const runner = readFileSync(path.join(process.cwd(), "scripts/browser/studio-authenticated.check.mjs"), "utf8");
    expect(runner).toContain("evaluateOnNewDocument(probeInstallSource())");
    const source = probeInstallSource();
    expect(source).toContain("MutationObserver");
    expect(source).toContain('addEventListener("error"');
    // The probe must never write to the DOM it observes.
    expect(source).not.toContain("appendChild");
    expect(source).not.toContain("setAttribute");
    expect(PROBE_MAX_RECORDS).toBeGreaterThan(100);
  });
});
