/**
 * Pre-hydration MutationObserver ring-buffer diagnostic (issue #418, M11).
 *
 * Test/debug-only: the source returned by `probeInstallSource()` is injected with Puppeteer's
 * `evaluateOnNewDocument` by the browser-check runner, before any document script executes
 * (including same-origin child frames such as the draft-preview storefront iframe). It is never
 * imported by application code and never ships in the production bundle.
 *
 * Contract:
 * - Observes the whole document for child-list changes (adds/removes) and a narrow attribute
 *   filter (`hidden`, `data-motion-*`, `data-render-mode`) — enough to distinguish candidate
 *   causes without page noise.
 * - Keeps a bounded ring buffer of recent mutation records with monotonic sequence numbers.
 * - Freezes a structural snapshot synchronously on the first error/unhandled rejection, before
 *   React's delete-then-regenerate recovery can overwrite the useful history.
 * - Never mutates the observed DOM, never reads cookies/headers/form contents, and never throws
 *   into the page (the whole install is wrapped in try/catch).
 */

export const PROBE_PROPERTY = "__hydrationMutationProbe418";

/** Ring-buffer capacity inside the page. */
export const PROBE_MAX_RECORDS = 600;
/** Mutation records kept inside the frozen snapshot. */
export const PROBE_SNAPSHOT_TAIL = 30;
/** Bounded outline length (characters) inside the frozen snapshot. */
export const PROBE_OUTLINE_LIMIT = 500;
/** Live tail kept for frames that were not the erroring document. */
export const PROBE_LIVE_TAIL = 15;

/**
 * Browser-side installer. Returns the source string for `page.evaluateOnNewDocument`.
 * Must stay ES5-compatible (runs at document-start in every frame of the target).
 */
export function probeInstallSource(options = {}) {
  const maxRecords = options.maxRecords ?? PROBE_MAX_RECORDS;
  const snapshotTail = options.snapshotTail ?? PROBE_SNAPSHOT_TAIL;
  const outlineLimit = options.outlineLimit ?? PROBE_OUTLINE_LIMIT;
  return `(() => {
  try {
    if (window.${PROBE_PROPERTY}) return;
    var MAX = ${maxRecords}, SNAPSHOT_TAIL = ${snapshotTail}, OUTLINE_LIMIT = ${outlineLimit};
    var seq = 0, frozen = false, snapshot = null, records = [];
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    function now() {
      return Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0);
    }
    function zoneOf(node) {
      try {
        if (!node || node.nodeType !== 1) return "text";
        if (node.closest("[data-catalogue-layout], [data-business-recipe], [data-recipe-presentation], [data-recipe-item]")) return "catalogue";
        if (node.closest("[data-motion-recipe], [data-motion-probe]")) return "motion";
        if (node.closest(".eb-preview-banner, .jata-preview-frame, [data-dashboard-preview]")) return "preview";
        return "app";
      } catch (e) { return "unknown"; }
    }
    function summarize(node) {
      if (!node) return "-";
      if (node.nodeType === 3) return "#text(" + String(node.data || "").length + ")";
      if (node.nodeType === 8) return "#c(" + String(node.data || "").slice(0, 8) + ")";
      if (node.nodeType !== 1) return "#n" + node.nodeType;
      var out = String(node.nodeName || "").toLowerCase();
      if (node.id) out += "#" + node.id;
      try {
        var cls = typeof node.className === "string" && node.className ? "." + node.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
        out += cls;
      } catch (e) {}
      try {
        var keys = ["data-catalogue-layout", "data-business-recipe", "data-recipe-presentation", "data-recipe-item", "data-motion-recipe", "data-motion-static", "data-render-mode", "data-template-family", "data-section-key"];
        var attrs = [];
        for (var i = 0; i < keys.length; i++) {
          var v = node.getAttribute ? node.getAttribute(keys[i]) : null;
          if (v !== null && v !== undefined) attrs.push(keys[i].slice(5) + "=" + String(v).slice(0, 14));
        }
        if (attrs.length) out += "[" + attrs.join(",") + "]";
      } catch (e) {}
      return out;
    }
    function listSummary(list) {
      if (!list || !list.length) return "";
      var parts = [];
      for (var i = 0; i < list.length && i < 3; i++) parts.push(summarize(list[i]));
      return parts.join("+") + (list.length > 3 ? "+" + (list.length - 3) + "more" : "");
    }
    function frameInfo() {
      var kind = "self";
      try { kind = window.top === window.self ? "top" : "iframe"; } catch (e) { kind = "cross-origin"; }
      var path = "/";
      try { path = String(location.pathname || "/").slice(0, 40); } catch (e) {}
      return kind + ":" + path;
    }
    function push(type, target, added, removed, hint) {
      if (frozen) return;
      if (records.length >= MAX) records.shift();
      var zone = zoneOf(target);
      if (hint && hint !== "app" && hint !== "text" && hint !== "unknown") zone = hint;
      records.push([seq++, now(), type, summarize(target), added, removed, zone]);
    }
    function involvesBoundary(m) {
      try {
        if (m.target && m.target.nodeType === 1) {
          var id = String(m.target.id || "");
          if (id.indexOf("B:") === 0 || id.indexOf("S:") === 0 || String(m.target.nodeName).toLowerCase() === "template") return true;
        }
        var lists = [m.addedNodes, m.removedNodes];
        for (var li = 0; li < lists.length; li++) {
          var list = lists[li];
          for (var k = 0; list && k < list.length; k++) {
            var node = list[k];
            if (node.nodeType === 1) {
              var nid = String(node.id || "");
              if (nid.indexOf("B:") === 0 || nid.indexOf("S:") === 0 || String(node.nodeName).toLowerCase() === "template") return true;
            } else if (node.nodeType === 8) {
              var data = String(node.data || "");
              if (data === "$" || data === "$?" || data === "$~" || data === "$!" || data === "/$" || data === "&" || data === "/&") return true;
            }
          }
        }
      } catch (e) {}
      return false;
    }
    var observer = new MutationObserver(function (mutations) {
      if (frozen) return;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "childList") {
          // Parser insertions of ordinary markup are the server HTML itself; keep only
          // post-parse changes and anything touching React/Fizz boundary markers or holders
          // (the $RC/$RV deferred swap), which run even mid-parse.
          if (document.readyState === "loading" && !involvesBoundary(m)) continue;
          var hint = m.addedNodes && m.addedNodes.length ? zoneOf(m.addedNodes[0]) : (m.removedNodes && m.removedNodes.length ? zoneOf(m.removedNodes[0]) : "");
          push("childList", m.target, listSummary(m.addedNodes), listSummary(m.removedNodes), hint);
        } else if (m.type === "attributes") {
          push("attr:" + (m.attributeName || ""), m.target, "", "");
        } else if (m.type === "characterData") {
          // Comment-marker flips ($? → $~ in $RC, /$ moves, React retry markers) are the
          // boundary-state channel; text-node data changes are page noise and are skipped.
          if (m.target && m.target.nodeType === 8) {
            push("cdata:" + String(m.oldValue ?? "").slice(0, 6) + ">" + String(m.target.data || "").slice(0, 6), m.target.parentNode || m.target, "", "");
          }
        }
      }
    });
    // Always armed from document-start (the install runs before any document script): the
    // Fizz $RC/$RV boundary swap mutates the DOM even mid-parse and must be captured in full.
    // Ordinary parser insertions are filtered cheaply in the callback above, so the parse
    // window stays low-cost while boundary-marker transitions are never missed.
    var armed = true;
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      characterDataOldValue: true,
      attributeFilter: ["hidden", "data-motion-static", "data-motion-engine", "data-motion-reason", "data-render-mode"],
    });
    function outline(root) {
      if (!root) return "";
      var out = [], stack = [[root, 0]];
      while (stack.length && out.length < 40) {
        var pair = stack.pop(), node = pair[0], d = pair[1];
        if (!node || node.nodeType !== 1) continue;
        out.push(new Array(d + 1).join(" ") + summarize(node));
        if (d < 3) {
          var kids = node.children || [];
          for (var k = kids.length - 1; k >= 0; k--) stack.push([kids[k], d + 1]);
        }
      }
      return out.join("|").slice(0, OUTLINE_LIMIT);
    }
    function freezeSnapshot(reason) {
      if (snapshot) return;
      frozen = true;
      try {
        var counts = {};
        var catalogues = document.querySelectorAll("[data-catalogue-layout], [data-business-recipe], [data-recipe-presentation]");
        counts.catalogue = catalogues.length;
        counts.motionRecipe = document.querySelectorAll("[data-motion-recipe]").length;
        counts.motionStatic = document.querySelectorAll("[data-motion-static]").length;
        snapshot = {
          reason: String(reason).slice(0, 140),
          at: now(),
          ready: document.readyState,
          frame: frameInfo(),
          counts: counts,
          outline: outline(document.body || document.documentElement),
          tail: records.slice(-SNAPSHOT_TAIL),
        };
      } catch (e) {
        snapshot = { reason: "snapshot-failed:" + String(e).slice(0, 80), frame: frameInfo() };
      }
    }
    window.addEventListener("error", function (event) {
      freezeSnapshot("error:" + (event && event.message ? String(event.message).slice(0, 140) : "unknown"));
    }, true);
    window.addEventListener("unhandledrejection", function () { freezeSnapshot("rejection"); }, true);
    window.${PROBE_PROPERTY} = {
      version: 1,
      records: function () { return records; },
      snapshot: function () { return snapshot; },
      state: function () { return { seq: seq, size: records.length, frozen: frozen, max: MAX, armed: armed, frame: frameInfo() }; },
      tail: function (count) { return records.slice(-(count || 15)); },
      freeze: function (reason) { freezeSnapshot(reason || "manual"); },
    };
  } catch (e) { /* the diagnostic must never break the page */ }
})();`;
}

/**
 * Node-side compaction: turn per-frame probe reads into one bounded log/comment payload.
 * `frameProbes` is [{ path, probe|null, inaccessible?: string }]; returns a compact JSON string.
 */
export function formatProbeDump(frameProbes, options = {}) {
  const liveTail = options.liveTail ?? PROBE_LIVE_TAIL;
  const read = (value, fallback) => (typeof value === "function" ? value() : value) ?? fallback;
  const frames = (frameProbes || []).slice(0, 4).map((entry) => {
    if (!entry || entry.inaccessible) return { frame: entry ? String(entry.path || "?").slice(0, 40) : "?", inaccessible: entry ? entry.inaccessible : "no-frame" };
    const probe = entry.probe;
    if (!probe) return { frame: String(entry.path || "?").slice(0, 40), installed: false };
    // Accepts either a live in-page handle ({state(), snapshot(), tail()}) or the plain JSON
    // shape returned by frame.evaluate ({state, snapshot, tail}).
    const state = read(probe.state, {}) || {};
    const snap = read(probe.snapshot, null);
    const frame = { frame: String(state.frame || entry.path || "?").slice(0, 48), installed: true, seq: state.seq, size: state.size, frozen: Boolean(snap) };
    if (snap) {
      frame.reason = snap.reason;
      frame.ready = snap.ready;
      frame.counts = snap.counts;
      frame.outline = snap.outline;
      frame.tail = snap.tail;
    } else {
      const tail = typeof probe.tail === "function" ? probe.tail(liveTail) : (probe.tail ?? []);
      frame.tail = tail;
    }
    return frame;
  });
  return JSON.stringify({ frames });
}
