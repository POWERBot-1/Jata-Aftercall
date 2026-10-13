# Upstream issue package — streamed Flight scripts inserted ahead of SSR body content, then fatal hydration error #418 (args[]=HTML)

**Status:** DRAFT — prepared for submission to the React and/or Next.js issue trackers. **Not submitted.** Filing under the owner's GitHub identity is a separate explicit action (see §12).
**Prepared:** 2026-10-13 (M15 evidence package; investigation `POWERBot-1/Jata-Aftercall` branch `arena/8e301eea-jata-aftercall` @ `adc52f24`).
**Sanitization:** synthetic CI fixture slugs and ephemeral IDs only; no credentials, session cookies, auth headers, personal data, production secrets, or customer business information. Repository and CI run identifiers are retained solely as an evidence trail.

---

## 1. Title (proposed)

**Bug (React 19.2 canary / Next 15.5 App Router): streamed `self.__next_f` Flight scripts are created/inserted ahead of SSR body content during streaming hydration, and the body-level hydration walk then throws fatal #418 (args[]=HTML) — intermittent, server bytes identical on passing and failing loads**

## 2. Summary

- **Behavior:** On an App Router page served as a streamed HTML document, intermittently (~1 load in 2–3 controlled journey runs) the browser's `<body>` DOM at hydration time has the streamed inline Flight scripts (and the Fizz request-state script `id="_R_"`) placed **ahead of** the server-rendered content, even though the served response bytes are **content-first** on every captured load, including failing ones. React's body-level hydration walk then encounters `script` candidates where the tree expects the leading content element and throws the fatal `Minified React error #418 … args[]=HTML&args[]=`.
- **Affected route class:** authenticated draft-preview storefront pages (`/b/<slug>?preview=draft&v=<n>`) rendered with streaming SSR in a production build — a document-level `hydrateRoot(document, …)` hydration of a large App Router layout.
- **User-visible consequence:** the server-rendered DOM is discarded and re-rendered on the client (visible flash / first-frame corruption) and an uncaught page error is raised. Under CI it is release-blocking; in production it surfaces as an intermittent console/page error.
- **Why it is framework-suspected:** mutation-API stack capture taken at the first DOM insertion places the insertion calls inside the React DOM client reconciler build shipped by Next.js (see §8.3). Application code performs no body-level DOM manipulation (§8.5). Attribution to specific reconciler internals is **not** claimed; see §10.

## 3. Environment (verified from the reproduction runtimes)

| Item | Value | Source |
|---|---|---|
| Next.js | **15.5.27** (App Router, production build) | `package.json` / installed `next` |
| React used by App Router runtime | **19.2.0-canary-0bdb9206-20250818** (vendored) | version marker inside `next/dist/compiled/react-dom/cjs/react-dom-client.production.js` and `next/dist/compiled/next-server/app-page.runtime.prod.js` |
| `react` / `react-dom` npm packages (declared) | 18.3.1 (App Router hydration does **not** use these; it uses the vendored canary above) | `package.json` |
| React DOM executing chunk at failure | `/_next/static/chunks/4bd1b696-f785427dddbba9fb.js` (content-hashed chunk; byte-identical local `next build` reproduced the same hash) | failure stacks + local build comparison |
| Node.js | CI: Node 20 (workflow `node-version: "20"`); local build verification: v22.22.3; package engines `^20.19.0 \|\| >=22.12.0` | CI workflow, `package.json` |
| Browser | Chrome/Chromium (`puppeteer-core` driven by CI-provided `CHROME_PATH`), headless | CI workflow |
| OS | ubuntu-latest (GitHub Actions) | CI workflow |
| Build mode | `next build` production, minified (errors appear as `Minified React error #418`) | CI journey |
| Rendering | Streaming SSR + RSC/Flight, document-level hydration of `<html>/<body>` (React `hydrateRoot(document, …)` as invoked by the App Router entry) | next App Router default |

Note on versions: several independent reports (§9) confirm the replay-hydration defect class is present in exactly this vendored canary (`19.2.0-canary-0bdb9206`) and is fixed only in React 19.3.0 / Next ≥ 16.2.0. Whether that class fully explains the captures in §8 is **unresolved** (§10).

## 4. Reproduction procedure (as observed)

The failure is captured by a controlled browser journey in CI (synthetic business fixtures, production build, cold server):

1. Sign in to an authenticated **Website Studio** dashboard (synthetic fixture account created by the journey).
2. Open the studio **preview** entry for a published storefront fixture; the journey drives publish → preview and visits the storefront **draft-preview URL**: `/b/qa-retail-<fixtureId>?preview=draft&v=0` (plus sibling route loads `?preview=draft`, `/shop`, `/enquire`, `/book` in the same browser).
3. The storefront page loads in the main frame (draft-preview document). The journey is a cold production server + Chromium; network is unthrottled LAN.
4. Repeat over controlled cycles (~10–15 min each) — the defect is a timing race: roughly **1 failing load per 2–3 journey runs** historically (21 recorded reproductions), never deterministic locally outside this journey shape.

**Expected:** storefront hydrates without page errors; body element order at hydration equals the server byte order (content-first).
**Actual (failing loads):** uncaught `Minified React error #418 … args[]=HTML&args[]=`, body element order inverted (scripts first), client re-render of the root.

Passing runs (the majority) show no divergence and no error. Green runs are **not** evidence of a fix (§10).

## 5. Minimal reproduction — status

**A standalone minimal reproduction of the exact captured phenomenon (§8.1–8.4) has NOT been achieved.** Honest statement of the remaining dependencies:

- The failure needs the combination of **(a)** a large streamed App Router document (the storefront layout produces ~40.5 KB of HTML with 18–20 inline Flight scripts), **(b)** hydration starting while/just after the document is still parsing (`document.readyState` observed both `loading` and `complete` at capture), **(c)** client bundle availability such that hydration can begin before the stream finishes (warm-cache profile), and **(d)** Flight-row timing (React Flight cuts server trees into lazy rows at ~3200 bytes / per async boundary; rows resolve mid-hydration on races).
- Our probe-based instrumentation reproduces the failure only inside the authenticated preview journey above. Local synthetic probes with the same instrumentation have never reproduced it.
- **Reproduction blueprint (unverified — offered as a starting point for maintainers, not claimed to reproduce):** `next build` an App Router page whose root layout renders `hydrateRoot(document)`-style document hydration with (i) a body-level wrapper whose first child is a plain `<div>`, (ii) a streamed HTML response large enough to force ≥15 inline `self.__next_f.push` Flight row scripts, (iii) one Flight lazy row that resolves within a microtask/scheduler tick after hydration begins (e.g. an async server component or a >3200-byte row cut inside the body wrapper), (iv) serve over a throttled connection with the client chunk pre-cached; loop loads and assert body children order at `onRecoverableError`.
- Public standalone repros exist for the **related** replay-cursor class (§9: react/react#37584 → `dreamerhyde/react-hydration-replay-repro`; react/react#37321 → `cipherprofessor/react-37321-streaming-hydration-race-repro`) — they reproduce **neighboring** failure shapes, not the scripts-ahead-of-content datum of §8.1.

## 6. Expected behavior

The hydration walk over `<body>` should meet, in order, the server-rendered elements in the same order as the streamed bytes: the leading content container (here: a hidden state-slot `div`, then `div.business-route-root` with the storefront tree), with the inline Flight scripts (`script#_R_` + `self.__next_f.push` rows) staying where the parser placed them (after the content). Hydration should reuse the SSR DOM; no page error.

## 7. Actual behavior

At the fatal #418 (args[]=HTML), the body element order is inverted relative to the served bytes:

- **DOM at failure:** `body → script#_R_ → ~18 × script (self.__next_f.push rows) → div (state slot) → div.business-route-root → …full SSR content…`
- React's expected fiber at the throw is a bare `div` (shape recorded as `{ft:5, ty:"div", cl:null, rc:0, pt:"DIV", pk:[]}`), and the candidate DOM nodes reported are the scripts — i.e. the walk finds script candidates where the tree expects the state-slot `div`.
- The throw site is the reconciler's `throwOnHydrationMismatch` path (minified `rD` in the same chunk).

## 8. Evidence (sanitized)

### 8.1 Server response byte order (all captured loads, including failing)

Marker summary of the response bytes for the draft-preview URL (lengths 40562–40670 depending on load):

```
theme-root ×5, body, state-div, cmt-$, cmt-$, r-script(#_R_), nextF, nextF, … (18–20 Flight row scripts)
```

i.e. **content-first**: `<body><div hidden><!--$--><!--/$--></div><div class="business-route-root">…SSR content…</div><script id="_R_">…</script><script>self.__next_f.push([…])</script>…` — the Flight scripts trail the content in the bytes.

These bytes are captured as raw response text **before any browser parse**, from the completed response of the failing URL's own load. (An earlier hypothesis was that the server's first stream flush could take the "pending-tasks" branch and emit the scripts at body-start; that inversion was never observed in any captured response — every completed capture across 7+ runs is content-first, and the §8.2 Navigation pairing ties the failing document to these bytes. A theoretical in-flight chunk-order artifact differing from the completed text was never observed and is disfavored by the `decoded=40596` pairing, but was not captured chunk-by-chunk.)

### 8.2 Paired failing-document identity (same-load pairing)

The failing document's own `performance` Navigation entry, captured at the error:

```
ready=complete size=13190 decoded=40596 1st=script#_R_,script,script last=script,div,div.business-route-root
```

`decoded=40596` matches the captured content-first response length (40562) — the failing document **is** the content-first byte document. Body's first children are the scripts; its last children end `…, script, div, div.business-route-root`, consistent with the full outline:

```
body | script#_R_ | script ×18 | div | div.business-route-root | …content (preview banner, skip link, header, main, hero)…
```

### 8.3 Mutation capture — who inserted the scripts (two independent reproductions)

Client-side instrumentation wraps `Node/Element/Document` insertion APIs (`appendChild`, `insertBefore`, `insertAdjacentHTML`, `replaceChildren`, `document.write`, `removeChild`, …) before any page script runs, recording API name, node summary, timestamp and a filtered call stack for the first script insertion / first move / first body reorder. Decisive lines (run 2; run 1 was identical with a truncated stack):

```
firstScriptInsert : appendChild  <chunks/4bd1b696-f785427dddbba9fb.js:1:119405> | ix (…same chunk…)
firstScriptMove   : (none)
firstBodyReorder  : (none)
firstWrite        : (none)
insertion API counts in erroring frame: {"appendChild":131,"insertBefore":16}
```

- Inserted nodes are **fresh** `script` elements whose text heads with `self.__next_f.push([1,"1]` (the streamed Flight row payload).
- No existing node was moved (`insertBefore` of parsed nodes / `removeChild`+`appendChild` of existing nodes never recorded before the throw), and `document.write` never ran — so the scripts at the front of `<body>` were **created and appended**, not relocated.
- Timing (run 1 tail): script appends at t≈30–37 ms interleaved with parser text-insertions (`parse+204@32:script+#text(5478)`) — the inserts occur **while the document is still parsing**.
- Stack frames: the insert call at chunk offset `1:119405`, with the enclosing function `ix` in the same chunk — inside the region of the minified reconciler's `completeWork` (bulk child-insert site at offset 118833: `a.appendChild(o.stateNode)`, hoistable/singleton handling nearby). The chunk is the React DOM client production build vendored by Next 15.5.27 (byte-identical local build confirmed by matching content hash).

### 8.4 Two independent controlled reproduction records

| Record | Outcome | Distinguishing evidence |
|---|---|---|
| CI run `38382918708` (2026-10-13) | Fatal #418 (args[]=HTML) | first mutation stack (offset truncated); `ready=loading`; body outline scripts-first; source bytes mono |
| CI run `38385430167` (2026-10-13) | Fatal #418 (args[]=HTML) | full stack offset `1:119405`; `STKM/STKR/STKW` empty; `STKA {"appendChild":131,"insertBefore":16}`; Navigation `decoded=40596` pairing; `1st=script#_R_,script,script` |

Both runs also recorded the expected-fiber shape and the scripts-first body outline in the same evidence block. 21 reproductions are recorded across the investigation; these two are the ones with mutation-API capture.

### 8.5 Negative controls (application side)

- Static audit of all application/layout/component code: **no** body-level DOM reordering, no script creation/move, no `document.write`; the only app-side insertion is a canvas append in a WebGL viewer and attribute writes in an inline theme script. The motion runtime animates existing elements only.
- On healthy loads the parser-inserted Flight scripts carry **no** call stack (they are parser-inserted), confirming the discriminator: only failing loads show client-side creation of these scripts.

### 8.6 Synthetic controls (separate from actual reproductions)

The journey also runs synthetic race arms (leading-script injection, parse-frontier error injection) which produce #418/#423 on demand. They validate the detection pipeline only; they are **not** counted as reproductions of the natural failure.

## 9. Controls and upstream research (public sources, checked 2026-10-13)

Passing controlled runs (same instrumentation, no divergence, no error): CI runs `38381175602`, `38387639677`, and the majority of historical runs. A green run without reproduction is **not** evidence of a fix.

Potentially related public issues — recorded with match judgment (matching error number alone is not treated as a match):

| Item | Status / versions | Similarities | Differences | Verdict |
|---|---|---|---|---|
| [react/react#37584](https://github.com/react/react/issues/37584) — "hydration cursor is not rewound when a host fiber is replayed, so hydration fails on an identical tree" | Open/active class; React 19.2.x incl. 19.2.8 npm **and** Next-15.5-vendored `19.2.0-canary-0bdb9206`; standalone repro [`dreamerhyde/react-hydration-replay-repro`](https://github.com/dreamerhyde/react-hydration-replay-repro) | Intermittent; identical server/client trees; fatal #418 args[]=HTML; Flight lazy row resolving mid-hydration; same vendored canary; recovery discards SSR DOM | Their captures: off-by-one claim (element compared to its own first child). Ours: flight scripts **created and inserted** ahead of content before the throw — a datum their reports do not include | **Strong candidate same-defect-class; not proven identical** |
| Fix PRs [react/react#35494](https://github.com/facebook/react/pull/35494) ("Correctly handle replaying when hydrating") and [react/react#35518](https://github.com/facebook/react/pull/35518) ("fix useId tracking on replay") | Merged; shipped **React 19.3.0** only (not backported to 19.2.x per maintainers, cited in third-party PRs); present from Next ≥ 16.2.0 | Fixes exactly the replay-hydration cursor/Forked-flag defect class of this vendored canary | Not in any Next 15.x bundle | Candidate remediation for the class; whether it removes **our** captures is untested |
| [react/react#37551](https://github.com/react/react/issues/37551) — HostSingleton replay, singleton cursor saved twice | Sept 2026; jsdom repro in-issue; Next 16.3.4 / 19.3.0-canary | Failure shape nearly identical: `MISMATCH fiber=div cursor=<script> parent=body` (body's div fiber meets script candidates) | Mechanism: corrupted hydration **cursor**, DOM not reordered; ours has actual re-inserted scripts in the DOM (mutation records) | Adjacent — same failure shape, different captured mechanism |
| [react/react#37321](https://github.com/react/react/issues/37321) — streaming hydration can overtake the HTML parser; false fatal #418 when a network chunk boundary splits the shell | Aug 2026; standalone repro [`cipherprofessor/react-37321-streaming-hydration-race-repro`](https://github.com/cipherprofessor/react-37321-streaming-hydration-race-repro) | False fatal #418 args[]=HTML during streaming hydration; server HTML byte-correct; cached-client-bundle trigger profile | Their cursor strands at end of `<head>` (walk runs out of siblings); ours meets wrong-type candidates at body level with scripts inserted | Same failure family (false mismatch during streaming); different detail |
| [facebook/react#29801](https://github.com/facebook/react/issues/29801) — Hydration fails when async script is located outside head tag | Closed not-planned; React 19 beta | Shows react-dom **creating fresh script elements during hydration** (`createElement('script')`, `head.appendChild`) — supporting datum that the reconciler can create/append scripts mid-hydration | Trigger: hoistable `<script>` placement rules; observed cause differs | Supporting datum only |
| [facebook/react#24430](https://github.com/facebook/react/issues/24430) — mismatch due to plugins generating script tag on top | Backlog (React 18) | Scripts inserted ahead of content cause hydration mismatch | Cause: browser extension injection, not the reconciler | Same outcome class, different cause |
| [facebook/react#35210](https://github.com/facebook/react/issues/35210) — random attribute mismatches (Mantine/Next) | Closed → #35494 | Intermittent hydration divergence with identical trees | Attribute-level (useId/aria), not structural HTML args | Adjacent |
| [vercel/next.js#43159](https://github.com/vercel/next.js/issues/43159) — Random non-deterministic #418 appDir, prod only | Closed (2022, React 18-era appDir) | Intermittent, prod-only, race-suspected | Old stack, no mechanism evidence | Trigger-profile precedent only |
| [vercel/next.js Discussion #68689](https://github.com/vercel/next.js/discussions/68689) | Open discussion | 418/423 aggregation thread | No mechanism | Background |
| Third-party independent confirmations of the vendored-canary replay bug: [Deodat-Lawson/LaunchStack#437](https://github.com/Deodat-Lawson/LaunchStack/pull/437) (backport of #35494+#35518 to Next 15.5; measured 14/72 failing loads → 0), [workforceap/workforceap-beta#2668](https://github.com/workforceap/workforceap-beta/pull/2668)/[#2669](https://github.com/workforceap/workforceap-beta/pull/2669), [TechnoOptics/CounselOptics#82](https://github.com/TechnoOptics/CounselOptics/pull/82) (5/50 → 0/90 under throttle), [tj0517/Seaclouds_management_system#88](https://github.com/tj0517/Seaclouds_management_system/pull/88), [NewWorldVenture/Bubaly#605](https://github.com/NewWorldVenture/Bubaly/pull/605) | Merged/active, 2026 | Same vendored canary; intermittent #418 on identical trees; independent measurements that #35494 removes the class | None include a scripts-ahead-of-content DOM capture | Corroborating environment evidence |

**Search summary:** no public issue found that reports the specific datum of §8.3 (client-side creation of the streamed Flight/request-state scripts ahead of SSR body content, captured by insertion stacks). The closest cluster is the replay-hydration class (#37584/#35494/#35518) — **plausibly the same root defect or a sibling in the same vendored canary**, which maintainers must determine. This report does not claim a match.

## 10. Investigation boundaries — proven vs unresolved

**Proven (direct captures):**
1. Served bytes are content-first on failing loads (same-load pairing via the document's own Navigation entry).
2. At failure, the body DOM is scripts-first; the hydration walk expects the state-slot `div` and meets `script` candidates, then #418 (args[]=HTML) throws.
3. The scripts at the front of `<body>` were **freshly created and appended** via `appendChild`/`insertBefore` from the React DOM client chunk vendored by Next 15.5.27, at ~147 insertion calls in the erroring frame, during the load (two independent reproductions).
4. No application code performs body-level DOM manipulation; no `document.write`; no moves of existing nodes.
5. The trigger is intermittent and tied to hydration-vs-stream timing (`readyState` observed `loading` and `complete`; warm-cache profile consistent with hydration starting before/around stream completion).

**Unresolved (do not treat as established):**
1. The exact internal fiber mechanism — e.g. HostHoistable resource (re-)creation vs hydration-recovery bulk re-insert vs HostSingleton/body handling vs a consequence of the replay defect of #37584. Distinguishing these requires reconciler-state instrumentation we are not authorized to apply.
2. Whether the #35494/#35518 fixes eliminate this phenomenon (not tested; no Next 15.x ships them).
3. Whether the phenomenon occurs in React 19.3.0+ / Next ≥ 16.2.0, or in non-Next React DOM setups. **Not claimed.**
4. A standalone minimal reproduction (§5).

**Explicitly not claimed:** that this is a confirmed upstream bug in every React 19 / Next.js configuration; that any cited public issue is the same bug; that any fix has been verified.

## 11. Regression expectations (behavioral, not implementation-prescriptive)

A fix must restore, under the reproduction loop of §4:

1. **DOM-order stability:** at hydration start and at every error, `document.body`'s first element is the state-slot `div` — equal to the server byte order. No inline Flight/request-state script appears ahead of SSR content in the body.
2. **No fatal #418 (args[]=HTML)** and no `onRecoverableError` on identical trees across N≥50 controlled loads (including throttled/warm-cache arms).
3. **SSR DOM reuse:** the server-rendered nodes present before hydration are the nodes after hydration (identity check on the root container's first child), i.e. no full-root client re-render.
4. Existing passing journeys remain green; synthetic race arms (which intentionally inject divergence) continue to detect what they were built to detect.

## 12. Artifacts & filing

- **In-repo evidence package (this document):** `docs/WEBSITE_STUDIO_HYDRATION_UPSTREAM_ISSUE.md`.
- **Full sanitized raw evidence (CI comments on the draft PR in the private repo, per-run):** runs `38382918708`, `38385430167` (`M418E STKI/STKM/STKR/STKW/STKA/NAV`, `M418E RESP`, `M418E OUTLINE`, `M418E EXPECTED` blocks). The instrumentation lives in `scripts/browser/hydration-mutation-probe.mjs` + `scripts/browser/studio-authenticated.check.mjs` (delegating wrappers around Node/Element/Document insertion APIs; no framework modification).
- **Not included:** repository source dump, raw verbose CI logs, cookies/tokens, business data.
- **Submission status: NOT SUBMITTED.** Filing is a public act under the owner's identity and requires explicit owner action/authorization.
- **Official destinations (drafts to paste):**
  - React: `https://github.com/facebook/react/issues/new?template=bug.yaml` (component: `react-dom`; title §1; body §2–§11). Also reference #37584 / #37321 / #37551 in the body.
  - Next.js (alternative or cross-post): `https://github.com/vercel/next.js/issues/new?template=bug_report.yml` (area: `App Router`; same body; emphasize the vendored canary `19.2.0-canary-0bdb9206-20250818`).
- **Recommended filing note:** before filing, consider linking the report to react/react#37584 as a comment instead of a new issue if the maintainers judge the scripts-ahead datum to be part of that defect; the new-issue value here is the distinct insertion capture (§8.3).

---

*Prepared without modifying React DOM or Next.js internals, without patch-package, without dependency changes, and without weakening any test. Hydration #418 remains open and release-blocking in the source repository.*
