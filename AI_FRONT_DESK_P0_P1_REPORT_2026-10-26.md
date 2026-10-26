# AI Front Desk — P0 subscription enforcement + P1 redesign

**Date:** 2026-10-26
**Branch:** `arena/78b4d7cf-jata-aftercall` (branched from `main` @ `083dfdb`)
**Scope:** AI Business Front Desk inside the existing JATA AFTERCALL app. No schema change, no
deployment, no production data touched, no customer charged.

---

## 1. Status summary

| Area | Status | Evidence |
| --- | --- | --- |
| Root cause identified (false LIVE / subscription bypass) | **PASS** | §2, six distinct defects with file:line |
| Server-derived status model (DRAFT/PREVIEW/LIVE/PAUSED/MAINTENANCE/SUSPENDED) | **PASS** | `lib/ai-publication.ts`, 28 enforcement tests |
| Enforcement on publication, activation, public AI access, APIs | **PASS** | §3, table of surfaces |
| Direct-API `operationalStatus:"LIVE"` refused when unpaid | **PASS** | `tests/security/ai-front-desk-publication-enforcement.test.ts` |
| Cross-tenant entitlement isolation | **PASS** | same suite (tenant B's paid plan never authorises tenant A) |
| Duplicate payment webhooks idempotent | **PASS** | `tests/security/ai-front-desk-payment-webhook-idempotency.test.ts` (5) |
| P1 visual redesign to the JATA design system | **PASS** (code + markup audit) | §5 |
| 5-step UX journey | **PASS** (code + rendering tests) | `tests/unit/ai-front-desk-journey.test.ts` (29) |
| Eleven required UI states | **PASS** | §5.3, one test per state |
| Mobile + accessibility evidence | **PASS** (measured, not screenshotted) | §6, `tests/unit/ai-front-desk-accessibility.test.ts` (23) |
| Unit/integration/security suite | **PASS** | 2847 passed, 1 failed (environment-only, §8) |
| ESLint | **PASS** | 0 errors, 40 warnings (baseline: 41) |
| TypeScript — application code | **PASS** | `npx tsc --noEmit`: no findings outside `tests/` |
| TypeScript — whole project | **BLOCKED** | 4 errors, all from the ungenerated Prisma client; reproduced on the untouched baseline (§8) |
| `npm run build` | **BLOCKED** (type-check stage) | `✓ Compiled successfully`; fails at `Running TypeScript` with the same 4 pre-existing errors (§8) |
| Existing unpaid-LIVE records identified in production | **BLOCKED** (no database access) | Read-only audit script + classification tests delivered; cannot execute without `DATABASE_URL` (§9) |
| Vercel deploy / merge | **NOT DONE** (not authorised) | §12 |

---

## 2. Root cause

The Front Desk could read — and could operate — as LIVE without a verified paid subscription. Six
independent defects, each sufficient on its own:

1. **The stored switch defaulted to LIVE.** `lib/ai-config.ts` built the extended config with
   `operationalStatus: merged.operationalStatus || "LIVE"`, so a business that had never configured
   anything read back as LIVE simply because no status had been saved.
2. **The dashboard claimed LIVE before it had any server answer.** `components/AIDashboardClient.tsx`
   seeded local state with `operationalStatus: "LIVE"` in the initial `useState`, so the first paint
   of every tenant's dashboard said LIVE — and the publish button/props were derived from it.
3. **Activation was a client-supplied value.** `POST /api/ai/status` wrote whatever
   `operationalStatus` the caller sent, with no subscription check; `POST /api/ai/config` did the
   same. A single authenticated `fetch` from the browser (or curl) activated the desk.
4. **Publishing forced LIVE.** `publishAIConfigSnapshot()` wrote
   `operationalStatus: current === "PAUSED" ? "PAUSED" : "LIVE"`, so *any* code path that reached
   the publish step produced a LIVE desk, independently of the entitlement.
5. **Signed-in callers skipped the entitlement check on the live AI path.** `POST /api/ai/chat`
   applied the `getAIPackageStatus(...).entitled` test only in the `else` branch for anonymous
   callers; any authenticated session reached real AI responses without a paid plan.
6. **The public business page inferred "AI is live" from entitlement alone.**
   `app/b/[slug]/page.tsx` set `aiFrontDeskLive` from `getAIPackageStatus().entitled` while ignoring
   `isPublished` and the operational switch, so a paid but unpublished/paused desk was advertised.

Nothing in the repair trusts a client flag, URL parameter, cached browser value or a "payment
succeeded" redirect: every input is re-read from the database by the server.

---

## 3. Enforcement changes (P0)

**New authority: `lib/ai-publication.ts`**

- `deriveAIFrontDeskPublication({ isPublished, operationalStatus, entitlement, preview })` — a pure
  function: LIVE only when published **and** entitled **and** switched on. Missing entitlement, a
  failed billing read, or an expired/cancelled/refunded subscription all resolve to `SUSPENDED`.
  `preview: true` resolves to `PREVIEW` and is never `publiclyOperational`.
- `getAIFrontDeskPublication(businessId, { preview })` — the server-side loader used by every page
  and route; it fails closed (no entitlement ⇒ not live, never an exception that reads as live).
- `authorizeAIFrontDeskOperation({ businessId, preview })` →
  `{ allowed, code: "NOT_PUBLISHED" | "SUBSCRIPTION_REQUIRED" | "BILLING_UNAVAILABLE" | null, reason, publication }`.
- `canApplyOperationalStatus(...)` — deactivation/pause is always allowed; activation requires a
  server-verified entitlement.

| Surface | Before | Now |
| --- | --- | --- |
| `POST /api/ai/publish` | readiness gate only | readiness **and** entitlement; `402 SUBSCRIPTION_REQUIRED`; no `isPublished` write, no `AI_FRONT_DESK_PUBLISHED` audit on refusal |
| `publishAIConfigSnapshot()` | forced LIVE | promotes the version; `activateLive` is opt-in **and** re-verified against `getAIPackageStatus`; a paused desk stays paused |
| `POST /api/ai/status` | accepted `LIVE` from the caller | `LIVE`/activation requires entitlement (`402` + code); `PAUSED`/`MAINTENANCE` always allowed; LIVE before publication ⇒ `409 NOT_PUBLISHED` |
| `POST /api/ai/config` | accepted any `operationalStatus` | same activation rule; config can no longer smuggle LIVE |
| `POST /api/ai/chat` | entitlement checked for anonymous callers only | every non-preview turn passes `authorizeAIFrontDeskOperation`; `402` unpaid, `404` unpublished, `503` billing unverifiable; anonymous callers get a neutral message, the signed-in owner gets the reason |
| `/b/[slug]/ai` | published + entitled | `publication.publiclyOperational === true` or `notFound()`; owner preview requires auth + `canAccessBusiness` and renders as PREVIEW |
| `/b/[slug]` link | entitlement only | derived publication; the AI link appears only for a LIVE desk |
| `app/dashboard/ai` | client-seeded LIVE | server-loaded publication, entitlement, readiness and profile; the workspace re-reads after every write |
| `AIConfigForm` (detailed config) | seeded LIVE | seeds DRAFT and can only show a stored non-LIVE status as DRAFT |

Authorisation, tenant scoping and webhook authentication are unchanged: `assertBusinessRole` /
`canAccessBusiness` still gate every write, ADMIN still has the overrides it already had (and no
subscription bypass), and the Paystack webhook still verifies its signature and de-duplicates on
`ProcessedWebhook.id`.

`app/api/autopilot/config/route.ts:47` was in scope for review and is **unchanged on purpose**:
`AutopilotConfiguration.operationalStatus` belongs to the JATA Autopilot product, is never read by
the Front Desk's publication derivation or chat path, and the owner instruction is not to modify
unrelated products. This is documented rather than silently "fixed".

---

## 4. Status model

| Product state | Persisted facts | Customer reachable |
| --- | --- | --- |
| `DRAFT` | `isPublished = false`, or published but never activated | no |
| `PREVIEW` | owner preview (`?preview=1`, authenticated + tenant-checked) | no (owner only) |
| `LIVE` | published + activated + server-verified entitlement | **yes** |
| `PAUSED` | published + entitled + owner paused | no (human handoff) |
| `MAINTENANCE` | published + entitled + owner maintenance | no (human handoff) |
| `SUSPENDED` | published earlier, entitlement expired/cancelled/refunded/unpaid/unverifiable | no |

Labels and help text live in `lib/statusLabels.ts` (`aiFrontDeskStatusLabel`), so a status string
can never be rendered as something the domain does not support.

---

## 5. P1 redesign

### 5.1 Design system

The AI screens now use the same tokens and primitives as the workspace/homepage rather than a dark
generic AI dashboard: `.ws-*` shell tokens (`--ws-ink #14110f`, `--ws-cream #f7f2e8`,
`--ws-amber #f0a03c`, `--ws-display` serif display face, `--ws-radius-*`, `--ws-elev-1`),
`WorkspaceHero`, `WorkspacePanel`, `WorkspaceStat`, `WorkspaceSectionHead`, `StatusPill`,
`WorkspacePhotoImage` + `lib/workspaceImagery` category photography, and `jata-btn` / `jata-input`
/ `jata-field` / `jata-hint` / `jata-error`. `bg-slate-950`-style cockpits are gone from
`components/AIDashboardClient.tsx`.

Imagery is category-based (`photoForCategory`) — real pictorial elements, no upload required, no
fabricated testimonials or statistics anywhere in the new copy.

### 5.2 Journey (`components/ai/AIFrontDeskWorkspace.tsx`)

1. **Welcome** — one primary CTA (“Set up AI Front Desk”), the subscription requirement stated up
   front, a private-test escape hatch, and a category photograph.
2. **Business information** — prefilled from the tenant record, required vs optional marked, inline
   validation with `aria-invalid`/`aria-describedby`, saved through the existing `PATCH /api/business`.
3. **Customer responses** — plain-English tone/language/ordering switches saved as a draft through
   `POST /api/ai/config`; no unsupported capability is offered and no price or policy is invented.
4. **Preview and test** — labelled *private*, representative questions generated from the tenant's
   own saved catalogue, tested through `POST /api/ai/chat` with `preview: true`, plus a “what it
   knows right now” inventory.
5. **Publish** — subscription and readiness shown together, friendly subscription-required state
   linking to the existing `/dashboard/subscription` and `/checkout` flows, then the real publish
   request; LIVE only appears after the server reports it.

Back/next navigation is always present, state lives in one component so nothing is lost between
steps, and the deep link `/dashboard/ai#publish` opens a step directly.

### 5.3 Eleven required UI states

| # | State | Where it renders |
| --- | --- | --- |
| 1 | Not configured | “Not set up yet” pill; readiness checks all failing |
| 2 | Draft saved | “Draft saved” pill, “Draft” status, save notice “Saved as a draft…” |
| 3 | Private preview ready | “Private preview ready” pill; preview panel labelled private |
| 4 | Subscription required | “Subscription: not active”, plan price from the `PlanConfig` row, links to plan + checkout, publish disabled |
| 5 | Payment pending verification | “Subscription: payment not confirmed”; “only treated as paid after the provider confirms it” |
| 6 | Eligible to publish | “Ready to publish”; publish enabled only when the server says entitled + ready |
| 7 | Publication in progress | `Publishing…`, `aria-busy`, button disabled; no notice until the response is read |
| 8 | Live and entitled | “Live” pill + help text, customer link, pause control |
| 9 | Expired / suspended | “Not live” + “Not serving customers”, no LIVE label anywhere |
| 10 | Publication failed | Server reason shown in a `role="alert"` panel, state re-read from the server, “Nothing was changed” |
| 11 | Billing unavailable | “We could not confirm your subscription”, “Nothing was published or switched on”, publish disabled, “Try again” |

---

## 6. Mobile and accessibility evidence

Measured from the shipped tokens/components (`tests/unit/ai-front-desk-accessibility.test.ts`, 23
assertions):

| Check | Result |
| --- | --- |
| `--ws-text` on `--ws-paper` | 18.2:1 |
| `--ws-muted` on `--ws-paper` | 7.6:1 |
| `--ws-muted` on `--ws-cream` | 7.0:1 |
| `--ws-amber-deep` on `--ws-paper` | 4.9:1 |
| `--ws-amber-deep` on `--ws-amber-soft` | 4.5:1 |
| `--ws-jade` on `--ws-jade-soft` | 4.9:1 |
| `--ws-on-ink` on `--ws-ink` | 16.9:1 |
| `--ws-faint` (3.9:1) | not used by any AI surface (asserted) |
| Tap targets | `.jata-btn` and `.ws-shell .jata-btn-sm` = 2.75rem (44px); compact pills use `min-h-11`; no `min-h-9/10` remains in the AI components |
| Narrow screens | no fixed pixel widths, no `min-w-[…px]`, action rows wrap, single column until `sm`/`lg` |
| Keyboard | 2px `:focus-visible` outline with 2px offset on links, buttons and `.jata-btn` |
| Semantics | labelled inputs (`htmlFor`/`id` pairs asserted both ways), `aria-invalid`, `aria-describedby`, `role="alert"` / `role="status"`, `aria-live`, `aria-current="step"`, `role="log"` on the customer conversation |
| Real controls | no clickable `div`s, no `alert()`, no `location.reload` |
| Decorative icons | every lucide icon carries `aria-hidden="true"` |

Not verified: real-device rendering and screen-reader sessions (no browser or device in this
environment). The above is source- and token-level evidence, not a substitute for a device pass.

---

## 7. Tests added / updated

Added:

| File | Tests | Focus |
| --- | --- | --- |
| `tests/security/ai-front-desk-publication-enforcement.test.ts` | 28 | publication gate, activation refusal (status + config), LIVE-before-publish, admin/non-member, cross-tenant, derivation, `publishAIConfigSnapshot` |
| `tests/unit/ai-front-desk-journey.test.ts` | 29 | 5-step journey, prepopulation, inline validation, representative questions, all eleven states, no optimistic LIVE |
| `tests/unit/ai-front-desk-accessibility.test.ts` | 23 | contrast, tap targets, focus, labels, live regions |
| `tests/security/ai-front-desk-payment-webhook-idempotency.test.ts` | 5 | signature refusal, single activation, sequential replays, no publication write |
| `tests/unit/ai-front-desk-reconciliation-dry-run.test.ts` | 10 | audit classification + “no apply mode” |

Updated to the shipped policy (not the other way round): `tests/security/ai-front-desk-route-authorization.test.ts`
(unpaid chat now `402` + `blocked`), `tests/unit/demo-data-restore.test.ts` (mocks the publication
authority), `tests/unit/business-page-ai-link.test.ts` (link follows derived LIVE).

---

## 8. Commands and results

```
npx vitest run
  Test Files  1 failed | 223 passed | 15 skipped (239)
  Tests       1 failed | 2847 passed | 121 skipped (2969)

npm run lint            → 0 errors, 40 warnings (baseline 41)
npx tsc --noEmit        → 4 errors, all inside tests/, all Prisma-client related

npm run build
  [build] prisma generate failed (offline) — continuing with fallback
  ✓ Compiled successfully in 35.6s
  Running TypeScript ...
  tests/prisma/autopilot-constraints-and-concurrency.test.ts(29,29): error TS2339 ...
  tests/prisma/autopilot-constraints-and-concurrency.test.ts(29,66): error TS2339 ...
  tests/prisma/experience-boundary.test.ts(34,19): error TS2694 ...
  tests/unit/autopilot-phase1-hardening.test.ts(493,33): error TS2339 ...
  Failed to type check.
```

**Environment limitation, proven not introduced here.** `binaries.prisma.sh` is unreachable from
this sandbox, so `prisma generate` cannot run and `@prisma/client` stays stubbed. Re-running
`npx tsc --noEmit` and `npm run build` on the untouched baseline (`git stash -u`) produced the
*identical* four errors and the same failed type-check stage. The single failing test
(`autopilot-phase1-hardening.test.ts:493`, `Prisma.dmmf` is undefined) fails identically on the
baseline for the same reason. Neither is related to this change, and neither can be fixed from
inside this environment.

The 15 skipped files / 121 skipped tests are the database-backed `tests/prisma/*` suites that skip
themselves without a live PostgreSQL connection.

---

## 9. Existing unpaid-LIVE records: audit, not a migration

Delivered:

- `scripts/audit/ai-front-desk-live-status-rules.mjs` — the classification rules (mirrors
  `lib/ai-entitlement.ts` + `lib/ai-publication.ts`), unit-tested without a database.
- `scripts/audit/ai-front-desk-live-status-dry-run.mjs` — reads only. Every statement is a
  `SELECT`; there is no `UPDATE`/`INSERT`/`DELETE`/DDL and no `--apply` flag (it throws if asked).
  Outputs a human report or `--json`, and prints no customer data: business id, slug, name, plan
  key, subscription/entitlement status, whether a PAID payment exists, stored switch and derived
  state.

Classification proven by tests: published + switched LIVE + no paid subscription ⇒ flagged;
expired subscriber whose switch still says LIVE ⇒ flagged; a different plan key ⇒ flagged;
legitimate paid subscriber ⇒ not flagged; grace only when the row carries `graceUntil`; corrupt
snapshot ⇒ DRAFT; unpublished ⇒ DRAFT.

Reconciliation plan (staged, none of it applied):

1. Review the flagged rows with the owner (no data change).
2. Confirm the documented grace policy for legitimate lapses (no invented windows).
3. Rely on the shipped server-side derivation: those rows stop serving customers without any row
   being edited (no data change).
4. **Optional, owner-authorised afterwards:** set the stored switch on those rows to PAUSED so the
   saved configuration matches the derived state. This needs a reviewed, reversible migration and
   is explicitly *not* performed by the script.

**Not executed here:** no `DATABASE_URL` and no production access in this environment, so no
production record has been read or reported. Status: **BLOCKED** pending owner-run execution.

---

## 10. Files changed and migration impact

Modified (18): `app/api/ai/{chat,config,dashboard,status}/route.ts`, `app/b/[slug]/ai/page.tsx`,
`app/b/[slug]/page.tsx`, `app/dashboard/ai/page.tsx`, `app/onboarding/ai/page.tsx`,
`app/globals.css`, `components/{AIConfigForm,AIDashboardClient,AIFrontDeskCustomerClient}.tsx`,
`lib/ai-config.ts`, `lib/ai-readiness.ts`, `lib/statusLabels.ts`, plus three updated test files.

Added: `lib/ai-publication.ts`, `components/ai/AIFrontDeskWorkspace.tsx`,
`scripts/audit/{ai-front-desk-live-status-dry-run,ai-front-desk-live-status-rules}.mjs`,
and five test files.

**Migration impact: none.** No `prisma/schema.prisma` change, no new migration, no new table/column,
no backfill. No new runtime dependency (the audit script uses the already-present `pg`).

API contract changes (deliberate, documented): `POST /api/ai/chat` returns `402`/`404`/`503` with
`blocked: true` and a `code` for refused turns instead of `200` + a soft fallback; `POST /api/ai/status`
and `/api/ai/config` return `402`/`409` for activation attempts that are not permitted;
`/api/ai/status` reports the derived `publication` object.

---

## 11. Risks and blockers

1. **Unpaid-LIVE rows in production are still unknown** — needs an owner-run read-only audit (§9).
   Customer-facing risk is already mitigated: those desks stop being reachable because the gate is
   evaluated per request. The residual risk is misleading copy in the owner console, which the
   derived state also fixes.
2. **Production build/type-check cannot be verified here** (Prisma engine download blocked) — CI on
   GitHub (`.github/workflows/release-validation.yml`) is the place to confirm it.
3. **No real-device/screen-reader pass** — source-level accessibility evidence only.
4. **`/api/business` publishes the site on any paid plan** (existing, documented policy). It cannot
   make the *AI Front Desk* live, because that ignores `isPublished` and requires the AI entitlement.
5. **Concurrent duplicate webhooks** are serialised inside the settlement transaction
   (`ProcessedWebhook` primary key), not by the route's pre-check; covered by the existing
   `tests/integration/paystack-webhook-route.test.ts`.
6. Two ESLint warnings remain on AI surfaces (setState-in-effect in the console's loader; `Date.now()`
   message ids in the customer chat). Both are the pre-existing patterns, not new defects.

---

## 12. Explicit confirmations

- Production was **not** deployed. No Vercel deployment, no production config change, no merge.
- **No records were modified**: no production migration, no seed, no backfill, no reconciliation
  write. The audit script is read-only and was not executed against any database.
- **No customer was charged**, refunded or subscribed. No payment, checkout or webhook logic was
  altered.
- No secrets, credentials, customer data or tenant data were read, used, logged or committed.
- POS, Website Studio, JATA Qi, JATA Autopilot and other subscription plans were not modified.
- No dependency was added; the stack (Next.js, Prisma, Neon PostgreSQL, Tailwind, Vercel) is intact.
