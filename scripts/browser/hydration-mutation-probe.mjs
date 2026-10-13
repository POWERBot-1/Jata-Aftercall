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
    var seq = 0, frozen = false, snapshot = null, records = [], parseDropped = 0, parseSamples = [];
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
    function involvesHoistable(m) {
      // Parse-phase insertions of <script>/<link>/<meta>/<style> are kept: an inline script
      // that hoists bootstrap scripts during parse would otherwise hide inside the dropped
      // parser-insertion stream (M12 — the raw-vs-DOM divergence window).
      try {
        var lists = [m.addedNodes, m.removedNodes];
        for (var li = 0; li < lists.length; li++) {
          var list = lists[li] || [];
          for (var n = 0; n < list.length; n++) {
            var node = list[n];
            if (node && node.nodeType === 1) {
              var name = node.nodeName;
              if (name === "SCRIPT" || name === "LINK" || name === "META" || name === "STYLE") return true;
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
          // (the $RC/$RV deferred swap), which run even mid-parse. Parse-phase drops are
          // counted and sampled so the timeline can still prove hydration-vs-parse order.
          if (document.readyState === "loading" && !involvesBoundary(m) && !involvesHoistable(m)) {
            parseDropped += 1;
            if (parseSamples.length < 5) parseSamples.push("parse+" + parseDropped + ":" + summarize(m.target) + "+" + listSummary(m.addedNodes));
            continue;
          }
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
    document.addEventListener("readystatechange", function () {
      if (!frozen && document.readyState !== "loading") push("rs:" + document.readyState, document.documentElement || document, "", "", "");
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
      while (stack.length && out.length < 70) {
        var pair = stack.pop(), node = pair[0], d = pair[1];
        if (!node) continue;
        if (node.nodeType === 8) { out.push(new Array(d + 1).join(" ") + "#c(" + String(node.data || "").slice(0, 6) + ")"); continue; }
        if (node.nodeType !== 1) continue;
        out.push(new Array(d + 1).join(" ") + summarize(node));
        if (d < 4) {
          var kids = node.nodeName === "TEMPLATE" && node.content ? node.content.children : (node.children || []);
          for (var k = kids.length - 1; k >= 0; k--) stack.push([kids[k], d + 1]);
          if (node.nodeName === "TEMPLATE") out.push(new Array(d + 2).join(" ") + "<template-content>");
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
          parseDropped: parseDropped,
          parseSamples: parseSamples,
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
      state: function () { return { seq: seq, size: records.length, frozen: frozen, max: MAX, armed: armed, parseDropped: parseDropped, parseSamples: parseSamples, frame: frameInfo() }; },
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
    const expected = read(probe.m418last ?? probe.expected, null);
    const frame = { frame: String(state.frame || entry.path || "?").slice(0, 48), installed: true, seq: state.seq, size: state.size, frozen: Boolean(snap) };
    if (expected) frame.expected = expected;
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

/**
 * Node-side structural digest of a server HTML document body: comments, tags with their id,
 * class and stable data-* markers; script/style bodies stripped. Used to diff the server-
 * rendered structure against the probe's client-side outline at error time (issue #418).
 */
/**
 * M12 Stage B: raw server-response ordering evidence (issue #418).
 *
 * Extracts byte offsets of the structural markers that decide the body-level
 * hydration walk from the RAW response text — before any browser parsing, DOM
 * recovery, or React mutation can reorder anything — plus the marker names in
 * document (= byte) order. Tags and stable identifying attributes only: no
 * cookies, auth headers, secrets, or customer content. Bounded output.
 */
export function serverHtmlOrder(html, options = {}) {
  const limit = options.maxMarkers ?? 16;
  const patterns = [
    ["body", /<body[\s>]/gi],
    ["state-div", /<div hidden=""/gi],
    ["cmt-$?", /<!--\$\?-->/gi],
    ["cmt-$", /<!--\$-->/gi],
    ["tpl-B", /<template id="B:/gi],
    ["seg-S", /<div hidden id="S:/gi],
    ["nextF", /self\.__next_f/gi],
    ["rt-inline", /\$RT=/gi],
    ["rb-replay", /\$RB=/gi],
    ["r-script", /id="_R_"/gi],
    ["theme-root", /product-theme-root/gi],
    ["route-root", /business-route-root/gi],
    ["catalogue", /data-catalogue-layout/gi],
    ["main", /<main[\s>]/gi],
  ];
  const found = [];
  for (const [name, pattern] of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(html)) && found.length < limit * 2) {
      found.push({ name, at: match.index });
    }
  }
  found.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
  const trimmed = found.slice(0, limit);
  return {
    order: trimmed.map((entry) => entry.name).join(","),
    offsets: trimmed.map((entry) => `${entry.name}@${entry.at}`).join(" "),
  };
}

export function serverHtmlDigest(html, options = {}) {
  const limit = options.limit ?? 2000;
  const bodyStart = html.search(/<body[\s>]/i);
  let body = bodyStart >= 0 ? html.slice(bodyStart) : html;
  body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>");
  body = body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  body = body.replace(/<!--[\s\S]*?-->/g, (comment) => `${comment.slice(0, 12)}~-->`);
  const parts = [];
  const tagPattern = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*'){0,220})>/g;
  let match;
  while ((match = tagPattern.exec(body)) && parts.join("|").length < limit) {
    const closing = body[match.index + 1] === "/";
    const tag = match[1].toLowerCase();
    if (closing) continue;
    const attrs = match[2] || "";
    const id = /\bid="([^"]*)"/.exec(attrs);
    const cls = /\bclass="([^"]*)"/.exec(attrs);
    const data = [...attrs.matchAll(/\b(data-[\w-]+)="([^"]{0,16})"/g)].slice(0, 3).map((m) => `${m[1].slice(5)}=${m[2]}`);
    parts.push(`${tag}${id ? `#${id[1]}` : ""}${cls ? `.${cls[1].trim().split(/\s+/).slice(0, 2).join(".")}` : ""}${data.length ? `[${data.join(",")}]` : ""}`);
  }
  return parts.join("|").slice(0, limit);
}

/**
 * Test-only build patch (M11 Stage D): records the fiber React expected when
 * `throwOnHydrationMismatch` fires (hydration #418) into `window.__m418last`.
 * The built chunk is byte-stable (4bd1b696-*.js across runs), so the throw site
 * is addressable by its minified shape `function rD(e){var n=Error(i(418`.
 * Diagnostics only: adds one guarded assignment before the Error construction;
 * never suppresses the throw, never alters hydration behavior. Applied by the
 * browser runner to the CI build's chunk on disk before `next start` — never
 * part of the application source or a shipped bundle pipeline.
 */
export function patchHydrationThrowDiagnostics(source) {
  const pattern = /function (\w+)\(e\)\{var n=Error\(i\(418/;
  if (!pattern.test(source)) return { patched: false, source };
  const injected = source.replace(
    pattern,
    'function $1(e){try{var __pf=e&&e.return;while(__pf&&!__pf.stateNode)__pf=__pf.return;var __pn=__pf&&__pf.stateNode;window.__m418last={ft:e&&e.tag,ty:typeof e==="object"&&e.type&&(e.type.name||e.type),cl:e&&e.memoizedProps&&String(e.memoizedProps.className||"").slice(0,96),rc:e&&e.memoizedProps&&e.memoizedProps.children?1:0,pt:__pn&&__pn.nodeName,pi:__pn&&__pn.id||"",pk:__pn&&__pn.childNodes?[].slice.call(__pn.childNodes).slice(0,12).map(function(c){return c.nodeType+":"+(c.nodeName||"")+":"+(c.id||"")+":"+(typeof c.className==="string"?c.className.slice(0,24):"")}):[]};}catch(x){}var n=Error(i(418',
  );
  return { patched: injected !== source, source: injected };
}
