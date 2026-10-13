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
  serverHtmlDigest,
  serverHtmlOrder,
  patchHydrationThrowDiagnostics,
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
  appendChild(child: FakeElement) {
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

function installProbe(options: { maxRecords?: number; snapshotTail?: number; outlineLimit?: number; readyState?: "loading" | "interactive" | "complete"; nodeCtor?: unknown; elementCtor?: unknown; documentCtor?: unknown } = {}) {
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
  new Function("window", "document", "MutationObserver", "performance", "location", "Node", "Element", "Document", source)(
    window,
    document,
    FakeMutationObserver,
    performance,
    location,
    options.nodeCtor,
    options.elementCtor,
    options.documentCtor,
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
    // Installed at document-start and armed immediately: the Fizz $RC/$RV boundary swap
    // mutates the DOM even mid-parse and must never be missed.
    expect(observer.observed?.root).toBe(document);
    expect(observer.observed?.options).toMatchObject({ childList: true, subtree: true, attributes: true, characterData: true });

    // Simulated hydration: nodes appear in document order after parsing completes.
    document.reach("interactive");
    const html = new FakeElement("html");
    document.documentElement = html;
    const body = html.append(new FakeElement("body", { class: "min-h-screen" }));
    const scope = body.append(new FakeElement("div", { class: "eb-scope", "data-template-family": "marketplace" }));
    observer.trigger([childList(document, [html])]);
    observer.trigger([childList(body, [scope])]);
    const catalogue = scope.append(new FakeElement("div", { "data-catalogue-layout": "grid" }));
    observer.trigger([childList(scope, [catalogue])]);

    const records = (window[PROBE_PROPERTY] as { records: () => Array<Array<unknown>> }).records();
    expect(records.map((r) => r[0])).toEqual([0, 1, 2, 3]); // monotonic, insertion order
    expect(records[0][2]).toBe("rs:interactive"); // readyState timeline marker
    expect(records[1][2]).toBe("childList");
    expect(records[2][3]).toBe("body.min-h-screen");
    expect(records[3][6]).toBe("catalogue"); // zone classified from stable markers
  });

  it("bounds the ring buffer while keeping sequence continuity", () => {
    const { document, window, observer } = installProbe({ maxRecords: 5 });
    document.reach("interactive");
    const target = new FakeElement("div");
    for (let i = 0; i < 12; i += 1) observer.trigger([childList(target, [new FakeElement("span")])]);
    const state = (window[PROBE_PROPERTY] as { state: () => { seq: number; size: number; max: number } }).state();
    expect(state.size).toBe(5);
    expect(state.max).toBe(5);
    expect(state.seq).toBe(13); // 1 readyState marker + 12 mutations
    expect(recordSeqs(window)).toEqual([8, 9, 10, 11, 12]); // oldest dropped, no reuse
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
    expect(probe.state().size).toBe(7); // 1 readyState marker + 6 mutations
  });

  it("records only the narrow attribute filter and never mutates the DOM", () => {
    const { document, window, observer } = installProbe();
    document.reach("interactive");
    const target = new FakeElement("div", { "data-motion-recipe": "hero" });
    observer.trigger([attr(target, "class")]); // noise — ignored
    observer.trigger([attr(target, "data-motion-static")]); // candidate-cause marker — kept
    observer.trigger([attr(target, "hidden")]);
    const records = (window[PROBE_PROPERTY] as { records: () => Array<Array<unknown>> }).records();
    expect(records).toHaveLength(3); // readyState marker + the two kept attribute changes
    expect(records[1][2]).toBe("attr:data-motion-static");
    expect(records[2][2]).toBe("attr:hidden");
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

  it("records Fizz boundary swaps during parse but skips ordinary parse insertions", () => {
    const { document, window, observer } = installProbe();
    // readyState is "loading": plain parser insertions are the server HTML (noise).
    observer.trigger([childList(document, [new FakeElement("div", { class: "jata-page" })])]);
    // Boundary holders/slots and marker comments ARE recorded even mid-parse ($RC/$RV).
    observer.trigger([childList(document, [new FakeElement("div", { hidden: "", id: "S:1" })])]);
    observer.trigger([childList(document, [new FakeElement("template", { id: "B:1" })])]);
    const afterParse = (window[PROBE_PROPERTY] as { records: () => Array<Array<unknown>> }).records();
    expect(afterParse).toHaveLength(2);
    expect(afterParse[0][4]).toContain("div#S:1");
    expect(afterParse[1][4]).toContain("template#B:1");
    const probe = window[PROBE_PROPERTY] as { state: () => { parseDropped: number; parseSamples: string[] } };
    expect(probe.state().parseDropped).toBe(1); // the ordinary insertion was counted, not recorded
    expect(probe.state().parseSamples[0]).toContain("div.jata-page");
    // Post-parse everything is recorded (plus the readyState timeline marker).
    document.reach("interactive");
    observer.trigger([childList(document, [new FakeElement("div")])]);
    expect((window[PROBE_PROPERTY] as { records: () => Array<Array<unknown>> }).records()).toHaveLength(4);
  });

  it("records comment-marker flips ($? to $~) and ignores text characterData", () => {
    const { document, window, observer } = installProbe();
    document.reach("interactive");
    const boundaryComment = new FakeComment("$?");
    boundaryComment.data = "$~";
    observer.trigger([{ type: "characterData", target: boundaryComment, oldValue: "$?" }]);
    const text = new FakeText("hello");
    observer.trigger([{ type: "characterData", target: text, oldValue: "hell" }]);
    const records = (window[PROBE_PROPERTY] as { records: () => Array<Array<unknown>> }).records();
    expect(records).toHaveLength(2); // readyState marker + the comment flip (text changes are noise)
    expect(String(records[1][2])).toBe("cdata:$?>$~");
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

  it("serverHtmlDigest summarizes the server body structure for the error-time diff", () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body class="min-h-screen">
      <div hidden id="S:0"></div>
      <div class="business-route-root"><div class="eb-scope" data-template-family="marketplace">
      <!--$?--><template id="B:0"></template><!--/$-->
      <script>self.__next_f.push([1,"noise"])</script>
      <main id="main"><h2 class="eb-h3">Services</h2></main></div></div></body></html>`;
    const digest = serverHtmlDigest(html);
    expect(digest).toContain("body.min-h-screen");
    expect(digest).toContain("div#S:0");
    expect(digest).toContain("div.business-route-root");
    expect(digest).toContain("template#B:0");
    expect(digest).toContain("main#main");
    expect(digest).toContain("h2.eb-h3");
    expect(digest).not.toContain("noise"); // script bodies stripped
  });

  it("patchHydrationThrowDiagnostics instruments the throw site without altering behavior", () => {
    const chunk = 'var x=1;function rD(e){var n=Error(i(418,1<arguments.length&&void 0!==arguments[1]&&arguments[1]?"text":"HTML",""));throw rU(rd(n,e)),rF}function rO(e){}';
    const { patched, source } = patchHydrationThrowDiagnostics(chunk);
    expect(patched).toBe(true);
    expect(source).toContain("window.__m418last=");
    expect(source).toContain('var n=Error(i(418'); // throw construction preserved
    expect(source).toContain("throw rU(rd(n,e)),rF"); // throw preserved
    expect(patchHydrationThrowDiagnostics("function rD(e){var n=Error(i(999))}").patched).toBe(false);
    expect(patchHydrationThrowDiagnostics(chunk).source).toContain("function rO(e){}"); // neighbors untouched
  });

  it("the runner installs the probe via evaluateOnNewDocument and ships no app-side telemetry", () => {
    const runner = readFileSync(path.join(process.cwd(), "scripts/browser/studio-authenticated.check.mjs"), "utf8");
    expect(runner).toContain("evaluateOnNewDocument(probeInstallSource())");
    const source = probeInstallSource();
    expect(source).toContain("MutationObserver");
    expect(source).toContain('addEventListener("error"');
    // The probe must never write to the DOM it observes: it creates nothing, sets no
    // attributes, and every wrapped mutation API only delegates to the original method.
    expect(source).not.toContain("createElement");
    expect(source).not.toContain("setAttribute");
    expect(source).not.toMatch(/document\.write\(/);
    expect(source).toContain("orig.apply(this, arguments)");
    expect(PROBE_MAX_RECORDS).toBeGreaterThan(100);
  });
});

describe("M14 mutation-API stack capture (names the client mover; parser inserts carry no stack)", () => {
  class FakeScriptElement extends FakeElement {}
  const makeDom = () => {
    // The install wraps these exact prototypes; instances look methods up there.
    // FakeElement already defines appendChild (append semantics) for the wrap to delegate to.
    const nodeProto = FakeElement.prototype as unknown as Record<string, unknown>;
    const documentProto = FakeDocument.prototype as unknown as Record<string, unknown>;
    if (typeof documentProto.write !== "function") documentProto.write = () => {};
    return { nodeCtor: { prototype: nodeProto }, elementCtor: { prototype: {} }, documentCtor: { prototype: documentProto } };
  };
  const probeCalls = (window: Record<string, unknown>) =>
    (window[PROBE_PROPERTY] as { calls: () => Record<string, unknown> }).calls();

  it("wraps the insertion APIs and records a bounded stack for the first script insert", () => {
    const dom = makeDom();
    const { window, document } = installProbe({ nodeCtor: dom.nodeCtor, elementCtor: dom.elementCtor, documentCtor: dom.documentCtor });
    const body = new FakeElement("BODY");
    document.body = body;
    const script = new FakeScriptElement("SCRIPT");
    body.appendChild(script);
    const calls = probeCalls(window);
    expect(String(calls.firstScriptInsert)).toContain("appendChild");
    expect(String(calls.firstScriptInsert)).toContain("|"); // at least one captured frame
    expect((calls.api as Record<string, number>).appendChild).toBe(1);
  });

  it("distinguishes moves from inserts and names the first body-level reorder", () => {
    const dom = makeDom();
    const { window, document } = installProbe({ nodeCtor: dom.nodeCtor, elementCtor: dom.elementCtor, documentCtor: dom.documentCtor });
    const body = new FakeElement("BODY");
    document.body = body;
    const script = new FakeScriptElement("SCRIPT");
    body.appendChild(script); // insert
    body.appendChild(script); // re-append of an attached node = move
    const calls = probeCalls(window);
    expect(String(calls.firstScriptInsert)).toContain("appendChild");
    expect(String(calls.firstScriptMove)).toContain("appendChild");
    expect(String(calls.firstBodyReorder)).toContain("appendChild");
  });

  it("records document.write as a first-write signature with its stack", () => {
    const dom = makeDom();
    const { window, document } = installProbe({ nodeCtor: dom.nodeCtor, elementCtor: dom.elementCtor, documentCtor: dom.documentCtor });
    const body = new FakeElement("BODY");
    document.body = body;
    (document as unknown as { write: (s: string) => void }).write("x");
    const calls = probeCalls(window);
    expect(String(calls.firstWrite)).toContain("write");
  });

  it("snapshots the call signatures at freeze and formatProbeDump surfaces them", () => {
    const dom = makeDom();
    const { window, document, listeners } = installProbe({ nodeCtor: dom.nodeCtor, elementCtor: dom.elementCtor, documentCtor: dom.documentCtor });
    const body = new FakeElement("BODY");
    document.body = body;
    body.appendChild(new FakeScriptElement("SCRIPT"));
    listeners.get("error")?.forEach((fn) => fn({ message: "Minified React error #418" }));
    const dump = JSON.parse(formatProbeDump([{ path: "/b/qa", probe: window[PROBE_PROPERTY] }]));
    expect(dump.frames[0].calls.firstScriptInsert).toContain("appendChild");
  });
});

describe("M12 raw server-response ordering evidence (serverHtmlOrder)", () => {
  const monoHtml = [
    "<html><head><title>T</title></head>",
    '<body class="min-h-screen">',
    '<div hidden=""><!--$?--><template id="B:0"></template><!--/$--></div>',
    '<div class="product-theme-root"><div class="business-route-root" data-catalogue-layout="grid"><main>ok</main></div></div>',
    '<script>requestAnimationFrame(function(){$RT=performance.now()});</script>',
    '<script src="/_next/static/chunks/webpack-x.js" id="_R_" async=""></script>',
    "<script>self.__next_f.push([1,\"x\"])</script>",
    "</body></html>",
  ].join("");
  const invertedHtml = [
    "<html><head><title>T</title></head>",
    '<body class="min-h-screen">',
    '<script>requestAnimationFrame(function(){$RT=performance.now()});</script>',
    '<script src="/_next/static/chunks/webpack-x.js" id="_R_" async=""></script>',
    "<script>self.__next_f.push([1,\"x\"])</script>",
    '<div hidden=""><!--$?--><template id="B:0"></template><!--/$--></div>',
    '<div class="product-theme-root"><div class="business-route-root" data-catalogue-layout="grid"><main>ok</main></div></div>',
    "</body></html>",
  ].join("");

  it("records marker byte-order for a content-first (mono) response", () => {
    const { order, offsets } = serverHtmlOrder(monoHtml);
    const names = order.split(",");
    expect(names[0]).toBe("body");
    expect(names.indexOf("route-root")).toBeLessThan(names.indexOf("r-script"));
    expect(names.indexOf("r-script")).toBeLessThan(names.indexOf("nextF"));
    for (const pair of offsets.split(" ")) {
      expect(pair).toMatch(/^[a-z$?@-]+@-?\d+$/i);
    }
  });

  it("records the inverted order when the bootstrap scripts lead the body (issue #418 signature)", () => {
    const { order } = serverHtmlOrder(invertedHtml);
    const names = order.split(",");
    expect(names.indexOf("r-script")).toBeLessThan(names.indexOf("state-div"));
    expect(names.indexOf("nextF")).toBeLessThan(names.indexOf("route-root"));
  });

  it("is bounded and leaks no element content", () => {
    const noisy = monoHtml.replace("<main>ok</main>", "<main>SECRET-CUSTOMER-TEXT</main>");
    const { order, offsets } = serverHtmlOrder(noisy, { maxMarkers: 4 });
    expect(order.split(",").length).toBeLessThanOrEqual(4);
    expect(offsets).not.toContain("SECRET");
    expect(order).not.toContain("SECRET");
  });

  it("distinguishes the two orders without inspecting the DOM", () => {
    expect(serverHtmlOrder(monoHtml).order).not.toBe(serverHtmlOrder(invertedHtml).order);
  });
});

describe("M12 parse-phase hoistable visibility", () => {
  it("keeps parse-phase script insertions instead of dropping them into parseDropped", async () => {
    // The probe keeps <script> insertions even while readyState is "loading": an inline
    // script hoisting bootstrap scripts during parse must be visible in the ring buffer.
    const source = probeInstallSource();
    expect(source).toContain("involvesHoistable");
    expect(source).toContain('name === "SCRIPT"');
    // Ordinary parser markup insertions are still dropped (bounded noise).
    expect(source).toContain("parseDropped += 1");
  });
});
