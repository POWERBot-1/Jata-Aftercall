# JATA AI INFRASTRUCTURE — ACQUISITION & INTEGRATION DIRECTIVE

**Status: DESIGN ONLY. NOTHING IMPLEMENTED, DEPLOYED, MIGRATED OR ACTIVATED.**
**Branch:** `arena/84a3b550-jata-aftercall` (base `ee59d95`, `main`)
**Date opened:** 2026-11-22
**Execution principle applied:** Acquire first → isolate second → integrate third → validate fourth → deploy only after explicit approval.

---

## What this workstream did

| Step | Action taken | Production touched? |
|---|---|---|
| 1 | Read the **entire existing repository** (192 Prisma models, 189 API routes, 145 pages, 370 lib modules, 438 test files, ~159,600 LOC) | No |
| 2 | Inventoried existing products, modules, entitlements, workflows, dependencies | No |
| 3 | Identified candidate open-source repositories and model weights | No |
| 4 | **Verified licences by fetching the actual licence text** (GitHub API + licence files + model cards), not from memory | No |
| 5 | Excluded duplicated functionality and every framework whose licence forbids this use | No |
| 6 | Designed an isolated, versioned AI infrastructure layer that extends — never replaces — the existing modules | No |
| 7 | Ran the existing test suite and typecheck to establish a real baseline | No (local only) |

**Not done, deliberately, and requiring separate authorisation:** no schema migration, no payment-logic change, no module replacement, no service deployment, no paid infrastructure, no production configuration change, no catalogue/entitlement/customer-row write.

---

## The three findings that change the directive

These are stated first because they invalidate parts of the obvious plan.

**1. JATA already owns most of the "Business Brain" the directive asks to build.**
`lib/ai-business-brain.ts` (tenant-scoped authoritative business data), `lib/ai-grounding.ts` (authoritative pricing, stock, policy resolution), `lib/ai-tools.ts` (a `READ` / `WRITE` / `HIGH_RISK` tool registry with a role gate), `lib/autopilot/actions.ts` (propose → approve → execute → rollback) and `lib/intelligence.ts` (quality events, unanswered questions) are the shared brain, the controlled agent framework and half the evaluation infrastructure. Building a parallel brain would create exactly the duplication the directive forbids in instruction 5. **The layer must be a façade over these, not a replacement.** See `05_CUMULATIVE_ARCHITECTURE.md` §2.

**2. The AI Front Desk does not call a language model at all.**
`lib/ai-front-desk.ts` imports `ai-business-brain`, `ai-config`, `ai-grounding`, `ai-commerce-turn`, `ai-tools` — and no provider. Verified by search: zero `fetch(`, zero `chat/completions`, zero provider import. The customer-facing AI is a **deterministic, grounded rules and retrieval engine**. This is a genuine strength (no hallucination surface, zero token cost, perfectly testable) and it must not be carelessly replaced. It also means "add an LLM" is a *quality/coverage* change with a new risk surface, not a wiring exercise. Only `lib/voice/llm.ts` reaches a model, and only inside `worker/voice-media`.

**3. Four of the most-recommended open-source AI platforms are licence-incompatible with JATA.**
Verified from the actual licence files, not summaries:

- **Dify** — modified Apache-2.0 that explicitly **forbids operating a multi-tenant environment** without a written commercial licence. JATA is a multi-tenant SaaS by definition. → **REJECTED.**
- **n8n** — "Sustainable Use License": "only for your own internal business purposes or for non-commercial or personal use". Selling access to it is prohibited. → **REJECTED.**
- **Open WebUI** — custom licence; removing its branding above 50 end users is a material breach. → **REJECTED.**
- **Flowise** — Apache-2.0 *except* the `src/enterprise` tree, which is commercially licensed; the useful enterprise features are not free. → **REJECTED** as a dependency.

Full evidence in `03_LICENCE_AND_COMMERCIAL_USE_REGISTER.md` §2.

---

## Deliverables

| # | Deliverable | File | Verdict |
|---|---|---|---|
| 1 | Complete existing-platform inventory | [`01_EXISTING_PLATFORM_INVENTORY.md`](01_EXISTING_PLATFORM_INVENTORY.md) | **PASS** |
| 2 | Open-source acquisition register | [`02_OPEN_SOURCE_ACQUISITION_REGISTER.md`](02_OPEN_SOURCE_ACQUISITION_REGISTER.md) | **PASS** |
| 3 | Licence and commercial-use register | [`03_LICENCE_AND_COMMERCIAL_USE_REGISTER.md`](03_LICENCE_AND_COMMERCIAL_USE_REGISTER.md) | **PASS** (with 2 BLOCKED items) |
| 4 | Repository fork and dependency plan | [`04_FORK_AND_DEPENDENCY_PLAN.md`](04_FORK_AND_DEPENDENCY_PLAN.md) | **PASS** |
| 5 | Cumulative architecture | [`05_CUMULATIVE_ARCHITECTURE.md`](05_CUMULATIVE_ARCHITECTURE.md) | **PASS** (design) |
| 6 | Product-by-product capability matrix | [`06_PRODUCT_CAPABILITY_MATRIX.md`](06_PRODUCT_CAPABILITY_MATRIX.md) | **PASS** |
| 7 | Integration and compatibility matrix | [`07_INTEGRATION_COMPATIBILITY_MATRIX.md`](07_INTEGRATION_COMPATIBILITY_MATRIX.md) | **PASS** |
| 8 | Security threat assessment | [`08_SECURITY_THREAT_ASSESSMENT.md`](08_SECURITY_THREAT_ASSESSMENT.md) | **PASS** (with 1 pre-existing FAIL) |
| 9 | Cost and compute assessment | [`09_COST_AND_COMPUTE_ASSESSMENT.md`](09_COST_AND_COMPUTE_ASSESSMENT.md) | **PASS** (indicative — see caveat) |
| 10 | Implementation roadmap | [`10_IMPLEMENTATION_ROADMAP.md`](10_IMPLEMENTATION_ROADMAP.md) | **PASS** (design) |
| 11 | PASS / FAIL / BLOCKED / NOT TESTED acceptance report | [`11_ACCEPTANCE_REPORT.md`](11_ACCEPTANCE_REPORT.md) | **PASS** (the report itself; it reports genuine FAILs) |

---

## Engineering state found on arrival (unmodified)

Recorded because the directive says to preserve outstanding obligations, and because these are **pre-existing** and must not be attributed to this workstream.

| Check | Result | Detail |
|---|---|---|
| `tsc --noEmit` | **FAIL** (5 errors) | `lib/admin/product-lifecycle-execution-store.ts` imports two modules that do not exist in the repository. Nothing imports that file — it is orphaned and unreferenced. Two further errors are test-only type assertions. |
| `vitest run` | **4,676 pass / 3 fail / 343 skipped** (5,022) | All 3 failures are in `tests/unit/autopilot-*.test.ts`. One is a genuine behavioural assertion mismatch (`ENTITLEMENT_REQUIRED` returned where `FOREIGN_OR_MISSING_QUESTION` expected). |
| PostgreSQL integration suites | **NOT TESTED here** | 16 suites need a live Postgres + a generated Prisma engine. The sandbox cannot reach `binaries.prisma.sh`, so the engine was not downloadable. Recorded as NOT TESTED, not as pass or fail. |

Nothing in this workstream changed any of the above. See `11_ACCEPTANCE_REPORT.md` §1.

---

## Gates requiring owner authorisation

Every item below is **BLOCKED** until separately authorised. None has been started.

| Gate | What it authorises | Why it needs a decision |
|---|---|---|
| **G-1 Schema** | Any Prisma migration, including the `pgvector` extension and embedding columns | Instruction 11. A new extension is a production schema change. |
| **G-2 Payments** | Any touch to `lib/payments`, Paystack, wallet, plan prices | Instruction 11. |
| **G-3 Module replacement** | Swapping the deterministic Front Desk for an LLM path | Instruction 11 + changes customer-visible behaviour on a sold product |
| **G-4 Deployment** | Standing up `services/jata-ai-gateway` anywhere | Instruction 11 + recurring compute cost |
| **G-5 Paid infrastructure** | Managed vector DB, GPU inference, hosted transcription | Instruction 11 + instruction 3 (this plan is designed to need none) |
| **G-6 Model weights** | Downloading or serving any model under a non-Apache/MIT licence | Licence obligations attach at distribution; see `03` §3 |
| **G-7 TAPNET** | Anything at all | TAPNET does not exist in this repository — see `06` §5 |

---

## Reading order

1. `01` — what exists (read before trusting any proposal, including this one).
2. `03` — what is legally usable. Read this **before** `02`; it eliminates most of `02`.
3. `05` — the architecture, which is mostly "reuse what is already there".
4. `11` — what is actually proven.

Pages `02`, `04`, `06`, `07`, `08`, `09`, `10` are supporting detail.
