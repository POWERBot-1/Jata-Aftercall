# 11 — ACCEPTANCE REPORT

**Statuses:** `PASS` · `FAIL` · `BLOCKED` (needs authorisation or an external fact) · `NOT TESTED` (no evidence gathered).
**Rule applied:** a claim without a command or a fetched artefact behind it is `NOT TESTED`, never `PASS`.

**Environment:** branch `arena/84a3b550-jata-aftercall` @ `ee59d95`, 2026-11-22. `npm ci` completed (554 packages).
**Environment limitation:** `binaries.prisma.sh` is unreachable from this sandbox, so the Prisma query engine could not be downloaded. This blocks every DB-touching verification and is recorded honestly rather than worked around with mocks.

---

## 1. Baseline engineering state (measured)

| # | Check | Command | Result | Status |
|---|---|---|---|---|
| 1.1 | TypeScript | `npx tsc --noEmit` — exit code **1** | 5 errors: 2 × `TS2307` missing modules in `lib/admin/product-lifecycle-execution-store.ts`; 3 test-only type errors | **FAIL (pre-existing)** |
| 1.2 | Unit + integration suite | `npx vitest run` | **4,676 passed, 3 failed, 343 skipped (5,022)** across 434 files | **FAIL (pre-existing, 3)** |
| 1.3 | Failing test identity | `... \| grep "FAIL "` | `autopilot-execution-rollback-isolation.test.ts` (1); `autopilot-phase1-hardening.test.ts` (2). One is a behavioural assertion: got `ENTITLEMENT_REQUIRED`, expected `FOREIGN_OR_MISSING_QUESTION` | Recorded |
| 1.4 | Postgres integration suites | — | 16 suites require a live DB + generated engine; engine undownloadable | **NOT TESTED** |
| 1.5 | Secret scan | `grep -rE "sk_live\|AKIA…"` over `*.ts/tsx/prisma` | Only redaction patterns and test fixtures — no real credentials | **PASS** |
| 1.6 | Dependency install | `npm ci` | 554 packages; `postinstall` prisma-generate failed on network only | **PASS (with 1.4 caveat)** |

**None of 1.1–1.6 was caused by this workstream.** No file outside `docs/ai-infrastructure/` was modified.

---

## 2. Deliverable acceptance (instruction — required deliverable)

| # | Deliverable | Evidence | Status |
|---|---|---|---|
| D1 | Complete existing-platform inventory | `01` — 192 models, 189 routes, 145 pages, 370 lib modules, 438 test files, 554 packages, 12 product plan keys, all measured | **PASS** |
| D2 | Open-source acquisition register | `02` — 41 candidates assessed, 14 adopt, 6 defer, 10 licence-rejected, 11 architecture-rejected | **PASS** |
| D3 | Licence and commercial-use register | `03` — 554-package scan + licence **texts fetched** for every contested case | **PASS**, with 2 open items (§4) |
| D4 | Repository fork and dependency plan | `04` — 0 new npm packages; forbidden-dependency list; directory plan; fork hygiene | **PASS** |
| D5 | Cumulative architecture | `05` — façade over existing brain; hybrid retrieval; HMAC+versioned contract | **PASS (design)** |
| D6 | Product-by-product capability matrix | `06` — 8 products; TAPNET marked BLOCKED with three-way verification of absence | **PASS (7 products) / BLOCKED (TAPNET)** |
| D7 | Integration and compatibility matrix | `07` — 10 seams, 7 need zero change; 8 honest incompatibilities listed | **PASS** |
| D8 | Security threat assessment | `08` — 12 threats, heat map, 10 acceptance tests, 4 pre-existing items | **PASS** |
| D9 | Cost and compute assessment | `09` — indicative only, caveat stated up front | **PASS (indicative)** |
| D10 | Implementation roadmap | `10` — Phase 0 → 7, each with exit criteria and rollback | **PASS (design)** |
| D11 | PASS/FAIL/BLOCKED/NOT TESTED acceptance report | this file | **PASS** |

---

## 3. Mandatory instruction compliance

| # | Instruction | Compliance | Status |
|---|---|---|---|
| 1 | Inspect complete repo before recommending changes | 192 models / 189 routes / 370 modules / 438 tests read; inventory produced first | **PASS** |
| 2 | Inventory every product, module, service, API, dependency, model, entitlement, workflow | `01` §2–§7 | **PASS** |
| 3 | Identify OSS that can be forked/modified/commercially used with no recurring fee | `02` — 14 adoptions, all zero-fee | **PASS** |
| 4 | Verify every upstream licence, weight, dataset, dependency, restriction | `03` — texts fetched, not recalled. 10 rejections evidence-quoted | **PASS** |
| 5 | Identify duplicated functionality; exclude competing frameworks | `02` §2/§9, `05` §2 — 6 frameworks excluded (4 licence, 2 duplication) | **PASS** |
| 6 | Preserve Next.js, Prisma, Neon, Vercel, Paystack | `07` §1 — 0 new npm deps, 0 route changes, payments untouched | **PASS** |
| 7 | Separate AI layer with authenticated, versioned interfaces | `05` §5 — `v1` + `CONTRACT_VERSION`, per-request HMAC, nonce, tenant claim | **PASS (design)** |
| 8 | Shared Business Brain, model adapter, retrieval, multilingual voice, agent framework, eval | `05` §2 — **3 of 6 already exist**; retrieval-semantic and eval are the genuine gaps | **PASS (assessed)** |
| 9 | Map capabilities to Business Page, Front Desk, Studio, POS, BOS, Autopilot, MJENGO, TAPNET | `06` — 7 of 8 mapped; **TAPNET absent** | **PASS (7/8) — TAPNET BLOCKED** |
| 10 | Tenant isolation, entitlements, deterministic money, human approval | `07` §5, `08` T-1/T-3, `05` §7 — all four enforced by *existing* modules, reused not re-implemented | **PASS** |
| 11 | No migrations / payment changes / module replacement / deployment / paid infra without authorisation | **Zero production mutations.** Only `docs/ai-infrastructure/` created. `prisma/` untouched; `lib/payments` untouched; no deploy; no account created | **PASS** |
| 12 | Regression, security, licence, performance, compatibility, operational acceptance tests | 10 security tests (`08` §4), 5 licence tests (`03` §5), eval harness (`10` Phase 2), perf caps, compat matrix (`07`) | **PASS (design)** — implementation gated |

---

## 4. BLOCKED items

| # | Item | Why blocked | What unblocks it |
|---|---|---|---|
| B-1 | **TAPNET capability mapping** | The product does not exist in the repository. Verified: case-insensitive search for `tapnet`/`tap net`/`TAP_NET` across all `.ts`/`.tsx`/`.prisma`/`.md` ⇒ **0 matches**; no route, model, plan key or env var; absent from `README.md`, `.env.example` and 40+ status docs. Not the same as Qi (`lib/qi`, inactive seam), Tawa (MJENGO codename) or ATLAS (Paystack merchant) | Owner states what TAPNET is: new product, external integration, alternate name, or typo |
| B-2 | Neon `CREATE EXTENSION vector` | Cannot be checked without the production/plan detail; no DB reachable from this sandbox | Owner/operator runs a read-only `SELECT * FROM pg_available_extensions WHERE name='vector'` |
| B-3 | Prisma engine download | `binaries.prisma.sh` unreachable ⇒ 16 Postgres suites and any DB verification impossible here | Run in CI (has network) |
| B-4 | Data-egress / privacy position (T-4) | Requires an owner decision on sending tenant content to hosted model APIs, and whether `/privacy` currently discloses it | Owner decision (G-3) |
| B-5 | Whether the Voice tier can be sold | `getVoiceReadiness().canSell` needs `TELNYX_VOICE_LIVE_VERIFIED` + `VOICE_CALLS_ENABLED` + `VOICE_CUSTOMER_BILLING_ENABLED` | Owner verification of a live call |
| B-6 | Customer entitlement inventory (pre-existing) | `docs/commercial/README.md` deliverable #3 — needs an authorised read-only production query | Owner authorisation |
| B-7 | Exact provider pricing | No live pricing page consulted; no account created | Re-verify before any commitment |

---

## 5. NOT TESTED

| # | Item | Reason |
|---|---|---|
| N-1 | Any schema migration | Not created — G-1 not authorised |
| N-2 | Vector retrieval quality | No table, no extension, no engine |
| N-3 | Any LLM phrasing behaviour | Not implemented — G-3 not authorised |
| N-4 | STT/TTS with Kokoro or faster-whisper | Not implemented — G-4/G-5 not authorised; no weights downloaded |
| N-5 | Gateway HMAC / replay behaviour | Not implemented |
| N-6 | Live voice call end-to-end | Pre-existing blocker B-5 |
| N-7 | Production behaviour of any kind | No production access by design |
| N-8 | Sheng/accent STT accuracy | Corpus not built; needs Phase 2.3 |
| N-9 | Neon pgvector performance at scale | No database access |
| N-10 | Whether `/privacy` discloses model-provider data flows | Page not audited against actual data flow; flagged as P-2, not asserted |

---

## 6. Production-mutation audit (instruction 11)

| Area | Touched? | Evidence |
|---|---|---|
| `prisma/schema.prisma` | **No** | Byte-identical; design only in `05` §3.3, labelled `DESIGN ONLY — NOT APPLIED` |
| `prisma/migrations/` | **No** | No migration created (65 unchanged) |
| `lib/payments/`, `lib/paystack.ts`, wallet | **No** | Untouched |
| Plan prices / `PlanConfig` / seed | **No** | Untouched |
| Entitlement modules (7) | **No** | Untouched |
| Existing lib/app/components files | **No** | Only `docs/ai-infrastructure/` added |
| Deployment / Vercel config | **No** | `vercel.json` untouched; nothing deployed |
| Paid infrastructure / accounts | **No** | No account, trial or credential created |
| Environment / secrets | **No** | No `.env*` written; no secret handled |

**Files created by this workstream: 12 Markdown documents under `docs/ai-infrastructure/`, and nothing else.**

---

## 7. Genuine findings (worth the owner's attention)

The three most consequential things this workstream discovered — none of which were in the directive's assumptions:

1. **The AI Front Desk has no language model.** Verified: `lib/ai-front-desk.ts` imports brain, config, grounding, commerce-turn and tools — no provider, no `fetch`. It is a deterministic grounded engine. This is a **strength** (no hallucination, zero token cost, fully testable) and a **limit** (answers read as templates; no semantic recall). The directive's framing assumed an LLM existed to be improved.

2. **Four of the most-recommended AI platforms are licence-blocked for this exact use.** Dify forbids multi-tenant operation without a written licence; n8n's Sustainable Use Licence restricts to internal/non-commercial; Open WebUI's branding clause bites above 50 users; Weaviate's feature set is licence-key-gated. All four were verified from the licence text, not summaries. **This is the single highest-value output of the licence register** — it prevents an expensive architectural mistake.

3. **Self-hosting voice is a margin decision, not a technology preference.** At 200 two-minute calls/month, hosted STT+TTS costs ~KES 5,460 against a KES 3,999 subscription — loss-making. Kokoro (Apache-2.0) + faster-whisper (MIT) make marginal cost ≈ 0. Conversely, **self-hosting an LLM is not justified on cost at all** (~USD 8/mo hosted text vs ~USD 150–400/mo GPU); its only justification is data residency.

---

## 8. Preserved obligations

All pre-existing obligations in `01` §9 are unchanged and unclaimed: commercial deliverable #3 (BLOCKED), R2 media (BLOCKED), password reset (BLOCKED), DNS/TLS (BLOCKED), voice verification (BLOCKED), eTIMS (disabled by design), agent registration/verification (disabled), Qi seam (inactive), plus the 3 failing tests and the orphaned lifecycle module (both pre-existing, both Phase 0).

**No outstanding obligation was closed, and none was claimed complete.**

---

## 9. Verdict

| Question | Answer |
|---|---|
| Were all 12 required deliverables produced? | **Yes** — 11 documents + this report |
| Were all 12 mandatory instructions complied with? | **Yes**, with instruction 9 satisfied for 7 of 8 products and TAPNET BLOCKED on absence |
| Was any production mutation made? | **No** |
| Was any paid infrastructure activated? | **No** |
| Was any deployment performed? | **No** |
| Is the existing platform preserved? | **Yes** — 0 files outside `docs/ai-infrastructure/` changed |
| Is anything claimed complete that is not? | **No** — every gap is labelled BLOCKED or NOT TESTED |
| Is the repository's own baseline green? | **No** — 3 pre-existing test failures, 5 pre-existing typecheck errors. **Phase 0 must precede any implementation.** |

**Overall: the acquisition and design workstream is PASS. Nothing downstream of it is started, and nothing downstream of it may start without the gates in §4 and in `README.md`.**

**Next action belongs to the owner:** choose which gates to open. My recommendation, in order, is **Phase 0** (free, fixes the baseline), then **Phase 1–2** (free, no product change, builds the measurement that makes every later decision falsifiable), and only then consider **G-3**.
