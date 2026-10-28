# PR #69 — Release Blockers and Remediation Report (2026-10-27, second directive)

**Branch:** `arena/b45b361f-jata-aftercall` · **PR:** https://github.com/POWERBot-1/Jata-Aftercall/pull/69
**Head at time of writing:** `96b7544` (all 12 check-runs green) · **Production today:** Vercel deployment `dpl_GpE7WtrLsDpFhXKQYV2kv6o8hx8V`, SHA `b716247` (PR #68), alias `jata-aftercall-git-main-powerbot-1.vercel.app`
**Status: stopped before merge/deploy, exactly as the directive requires.** Two mandated capabilities depend on external contracts/credentials that do not exist in any environment reachable from this workstream. Every doable item — the two visual defects, contact evidence, media lifecycle evidence, design preservation, full CI — is complete and green.

Verdict legend: **PASS** = executed and verified · **FAIL** = executed and failed · **BLOCKED** = cannot be executed; exact dependency named · **NOT TESTED** = not executed.

---

## 1. Directive-by-directive verdicts

| # | Directive item | Verdict |
|---|---|---|
| 1 | Inspect real TANYA-AI / SOMA AI implementations and wire a **live** JATA Qi integration | **BLOCKED** — no such implementations are accessible anywhere (§2). Mocked seam alone is not accepted, so this is not claimed complete. |
| 2 | Durable customer image upload/persist/read/replace/delete on the approved storage architecture, secure credentials | **BLOCKED** for durable byte storage — the R2 adapter is code-complete and fail-closed, but zero storage credentials exist in any Vercel environment and no Cloudflare access is available (§3). Metadata-reference lifecycle and the honest 503 path: **PASS** with real-Chrome evidence. |
| 3 | Fix blank homepage showcase image and the 320px demo-image boundary; capture the required screenshots | **PASS** — blank image root-caused and fixed; the "boundary" flags proven to be intentional clipped motion with zero real violations; 468/468 real-Chrome gates including the new interaction captures (§4). |
| 4 | Preserve design, type, layout, icons, pricing, plan IDs, payment behavior, publication gates, Vercel/Neon architecture, tenant isolation; do not modify Qi/TANYA repos | **PASS** — no protected surface changed; no external repository modified (§5). |
| 5 | Full CI/security checks with evidence, SHAs, artifact links, honest classifications | **PASS** — all 12 check-runs green on the verified head; artifact registered (§6). |
| 6 | Merge and deploy once gates pass and the live capabilities genuinely work | **NOT EXECUTED, by instruction** — the stop clause applies while items 1–2 are blocked. PR remains OPEN/MERGEABLE; nothing was merged or deployed. |
| 7 | Post-deploy live verification | **NOT TESTED** — no deployment occurred; production remains on `b716247`, untouched. |

## 2. Blocker A — live JATA Qi integration: the exact missing dependencies

Four independent facts, each re-verified on 2026-10-27 rather than assumed:

1. **No TANYA-AI or SOMA AI code is accessible.** The POWERBot-1 organization contains exactly six repositories: `Jata-Aftercall`, `JATA-Qi`, `Moto-X`, `karis-os-core`, `docs`, `whatsapp-prediction-bot-admin-setup`. A code search across all of them for TANYA/SOMA returns zero implementations (the only hits are portfolio prose mentioning "TANYA mobile"). GitHub global search returns unrelated third-party tutorial/education repositories, none owned by POWERBot-1; web search returns no JATA-related contract.
2. **The Qi packages are not installable.** Every `@jataqi/*` package (`core-kernel`, `agent-runtime`, `unified-loop`, `external-connectors`, `loop-host`, `storage`, `vector-search`, `knowledge-service`, …) returns HTTP 404 from the public npm registry; registry search for "jataqi" returns zero objects. There is no private registry configured in the Vercel project or the repository.
3. **JATA Qi has no network surface to call.** A fresh clone confirms the monorepo ships 45 in-process ESM packages with no HTTP framework dependency (no express/fastify/hono/koa, no `node:http` server; its own FX module states "JATA Qi bundles no rate source, no PSP, no HTTP client"). `loop-host` is a long-lived scheduler/lease/checkpoint process requiring durable Postgres — it cannot run inside the Vercel serverless model, and no Qi host is deployed anywhere reachable.
4. **No credentials or configuration exist.** The Vercel project has no `JATAQI_*` variables; none exist at team level either.

What would unblock it (owner decision + handover; none of these can be self-provisioned here):
- access to the actual TANYA-AI/SOMA AI repositories or their published contracts, **or** an explicit decision to (a) vendor the Qi runtime into this deployable (new-dependency/architecture approval) or (b) deploy a standalone Qi loop host and define its network contract;
- a server-side `JATAQI_AUTH_TOKEN` issued for a named tenant/capability scope, delivered through Vercel environment configuration (never the repository);
- confirmation of `JATAQI_AUTH_MODE` and sandbox-vs-production environment.

The fail-closed `lib/qi` seam delivered earlier (20 contract tests, env-only secrets, default-deny, no network I/O) remains the ready insertion point and is the maximum honest progress without those inputs. It is explicitly **not** a live integration and is not presented as one.

## 3. Blocker B — durable customer image storage: the exact missing configuration

The approved architecture is Cloudflare R2 over the existing S3 SDK v3 adapter (`lib/storage/r2.ts`, already a dependency). It activates only when all of the following exist as server-side Vercel variables for the target environment, plus the selector:

- `JATA_STORAGE_PROVIDER=cloudflare-r2`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL` (an enabled `r2.dev` subdomain for pilot, or a custom domain — storefront media is public by design)

Inventory evidence: the Vercel project `jata-aftercall` currently holds 17 environment variables covering auth, database, Paystack, M-Pesa and platform settings only. **None of the six R2/selector variables exists in production, preview or development, and no team-level shared variables exist.** This workstream has no Cloudflare account/API access, the sandbox network cannot reach Cloudflare endpoints, and creating paid cloud resources without approval is prohibited — so the bucket, token and public URL cannot be self-provisioned. Without them the system correctly refuses byte uploads with `503 inline_media_persistence_disabled` (proven live in §4), which is the designed fail-closed behavior rather than a defect.

Owner handover needed: create the R2 bucket and scoped API token in the owner's Cloudflare account, enable a public base URL, then provide the six values above for Vercel `production` (and `preview` for rehearsal). After that, a single CI run on the existing workflow will prove end-to-end persistence; no code change is expected to be required.

## 4. Visual defects and real-Chrome evidence (item 3) — PASS

**Blank homepage showcase image — root cause and fix.**
- Cause: `DemoShowcase` rendered every panel photograph with `loading="lazy"`. In full-page headless captures (and on slow real connections when a visitor jumps to the section), the below-the-fold active panel's image never entered the viewport, so it painted as a blank cream band.
- Product fix (`components/landing/DemoShowcase.tsx`): the active first panel now loads eagerly with `fetchpriority="high"`; the three hidden panels and the property inset stay lazy. Pinned by a source-level test and an SSR test (`landing-motion`, `landing-content`).
- Harness fix: `openPage` now scrolls the real viewport in steps, settles image decoding, then returns to the top before the full-page capture, so no lazy media can ever again appear blank in evidence without the gate failing.
- Result: zero blank/broken rendered images across all routes and viewports in the latest run.

**320px demo-image boundary — investigated, no real defect.**
- A first diagnostic run flagged 46 image-boundary cases. Instrumented per-image facts showed every one is an intentional Ken Burns transform (`lp-zoom` up to scale 1.09, `lp-pan` 1.06, `lp-drive` 1.08, `lp-hero-drift` up to 1.1, `jata-cross`) painting inside an `overflow: hidden|clip` ancestor (`.lp-demo__media`, `.lp-hero`, `.jata-showcase`, auth aside). The refined gate distinguishes clipped motion from true spills by checking the clip box against the viewport plus transform-free `offsetWidth`; after refinement **all boundary gates pass at 320/360/390/430/768/1366**, and document-level horizontal overflow remains zero everywhere.

**New authenticated interaction evidence (real Chrome, disposable database, real session):**

| Capture (artifact JPEG) | What it proves | Gate |
|---|---|---|
| `390x844__contact-editor.jpg` | Nominated number editor opens in the authenticated workspace | render |
| `390x844__contact-editor-invalid.jpg` | "123" is rejected inline by the Kenyan rule; no PATCH is sent | KE rejection |
| `390x844__contact-editor-saved.jpg`, `1366x768__contact-editor-saved.jpg` | `0724317010` saves with an announced success | PATCH 200 + announcement |
| persistence assertion (in `evidence.json`) | Reload shows the saved value — real database persistence | value match |
| `390x844__photos-fallback.jpg` | Category fallback imagery renders with no uploaded asset, after a draft exists | decoded images |
| `390x844__photos-upload-blocked.jpg` | Real JPEG through the real upload control shows the honest "durable media provider not configured" alert; API probe confirms exact `503 inline_media_persistence_disabled`; nothing persists | status/code + UI text |
| `390x844__photos-metadata-asset.jpg` / `…after-delete.jpg` | Metadata-only reference creates (201), renders in the gallery, and is removed through the Delete control with confirm dialog | create + remove |
| Six viewports × ten routes + nav journey | Original espresso/amber design, plan order/icons, no overflow, no page errors | 468 gates total, 0 failures |

The authoritative run on final head `96b7544` is **run 40493536344, PASS=469 FAIL=0**, uploading artifact **`premium-screenshots-69`** (id `12729127512`, ~13.2 MB). Artifact blob download is blocked in this sandbox, so author eyeball inspection of the JPEGs remains NOT TESTED and stays the owner's separate visual-approval gate; every objective gate inside the run is machine-verified. The earlier fully-green run 40491087140 (468/468) is retained for history.

## 5. Preservation guarantees (item 4) — PASS

- No change to pricing modules, plan keys, intervals, entitlements, Paystack/M-Pesa code, publication gates, subscriptions, settlement or the Prisma schema/migrations; no lockfile or dependency change.
- The original espresso/cream/amber design, serif display, layout, cards, section order and the phone/calendar/bot/spark/wand/store icon lock remain byte-identical to main apart from the two evidence-backed overflow rules and the eager-image fix.
- Tenant isolation unchanged and re-proven: media IDOR suite, contact route tenant guards, and the new interaction run all operate under the real `guardTenantMutation` checks on a disposable database.
- The JATA Qi, TANYA and SOMA repositories were not cloned-for-edit, pushed to, or otherwise modified.
- No production variable, domain, DNS or credential was read into the repository, logged, or altered; the Vercel project was inspected read-only.

## 6. Verification evidence (item 5)

- Local: `vitest` 3,037 passed / 121 skipped / 1 failure — the single failure is the known offline-Prisma DMMF stub case (no engine in sandbox); `npm run lint` 0 errors (41 pre-existing warnings); production build compiles, with only the four documented offline Prisma-stub typecheck errors that CI's generated client eliminates.
- CI on final head `96b7544`: all 12 check-runs success — Release gate (aggregate), Static, Migrations + schema on PostgreSQL 18, Failure paths actually fail, Schema reconciliation, D2 build/audit/controls, Production build path, Exact candidate applies, Migration target guard, Journey against a real database, Real-Chrome six-viewport capture, Vercel Preview Comments.
- Commits added in this round (all fast-forward, no force-push): `011c1f6`, `c3735f5`, `ac707d6`, `b20d373`, `38ffbf1`, `6e6aa69`, `580ec9e`, `f2944ef`, `96b7544` — harness diagnostics, the eager-image product fix and its tests, and the authenticated interaction/evidence sequence.
- Screenshot runs: failed diagnostic runs were retained on purpose in the run history so the investigation (46 boundary flags → clipped-motion explanation; no-request save → input-setter correction; empty gallery → draft-creation dependency) is fully auditable.

## 7. Exact decision requests before merge/deploy can proceed

1. **R2:** provision bucket + scoped token + public base URL in the owner's Cloudflare account and supply the six Vercel variables (§3). On confirmation, I (or the owner) re-run the screenshot workflow which will then exercise real upload/persist/read/replace/delete, and the `503` gate flips to a durable-201 gate.
2. **Qi:** provide the TANYA/SOMA contract or choose embedding vs standalone host, plus the scoped `JATAQI_AUTH_TOKEN` and mode (§2). Until then the live-integration requirement cannot be honestly satisfied.
3. **Merge/deploy authorization after both blockers clear:** PR #69 is otherwise merge-ready through the normal protected GitHub process; the Vercel Git integration will then deploy the merge to production automatically (production branch `main`), and the post-deploy live verification (item 7 of the directive) can be executed against the promoted SHA.
4. **Visual approval:** inspect artifact `premium-screenshots-69` (id `12729127512`) from run 40493536344 on head `96b7544` — automated gates cannot substitute for this.

No merge, deploy, migration, storage activation, secret creation, customer-data change or external-repository modification has been performed.
