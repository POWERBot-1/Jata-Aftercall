# 10 — IMPLEMENTATION ROADMAP

**Governing rule:** no phase begins without its gate. Each phase is independently valuable, independently revertible, and leaves the platform working if abandoned.

**Phase 0 is not optional.** It exists because the repository has 3 pre-existing failing tests and 5 pre-existing typecheck errors, and a new failure must never be confusable with an old one.

---

## Phase 0 — Restore a trustworthy baseline (no gate; no product change)

| # | Task | Risk | Why first |
|---|---|---|---|
| 0.1 | Fix the 3 failing tests in `tests/unit/autopilot-execution-rollback-isolation.test.ts` and `tests/unit/autopilot-phase1-hardening.test.ts` — or record an explicit owner acceptance of each | None (test-only) | Cannot measure regressions otherwise |
| 0.2 | Resolve `lib/admin/product-lifecycle-execution-store.ts` — it imports two modules that do not exist. Delete if orphaned (nothing imports it) or restore the missing modules | Low | 2 of the 5 typecheck errors |
| 0.3 | Fix the 3 test-only type errors (`Prisma.dmmf`, `PrismaClientKnownRequestError`, `BusinessUncheckedCreateInput`) — these stem from a non-generated Prisma client, so fix by generating in CI, not by editing types | Low | Restores a clean `tsc --noEmit` |
| 0.4 | Add `licence-tree-policy` + `no-blocked-dependency` CI tests (`03` §5) | None (CI only) | Locks in instruction 4 permanently |
| 0.5 | Confirm CI can run the 16 Postgres suites (network to `binaries.prisma.sh`) | None | They are NOT TESTED in this environment |

**Exit criteria:** `tsc --noEmit` clean; `vitest run` 0 failures; licence tests green.
**Deliverable:** a baseline commit that changes no behaviour.

---

## Phase L — Licence register made executable (no gate)

| # | Task | Notes |
|---|---|---|
| L.1 | `THIRD_PARTY_NOTICES` generation + completeness test | Satisfies Apache/BSD/CC-BY obligations |
| L.2 | `model-weight-manifest` (URL + SHA-256 + licence + date) | Required before any weight download |
| L.3 | `openpage-attribution-intact` test | Protects the one existing fork |

**Exit criteria:** all licence tests pass; no runtime change.

---

## Phase 1 — Dormant layer skeleton (no gate)

**The whole point: merge-able with zero customer-visible change.**

| # | Task | Notes |
|---|---|---|
| 1.1 | `lib/ai-infra/{index,contract,flags,client}.ts` | `AI_INFRA_ENABLED` default false |
| 1.2 | `CONTRACT_VERSION = "2026-11-aiinfra-v1"` | Asserted on both sides |
| 1.3 | `ai-infra-flag-off-inert` test | Asserts zero outbound calls, zero new DB reads, identical responses with the flag off |
| 1.4 | `lib/ai-infra/eval/` harness with the existing `PREVIEW_TEST_QUESTIONS` as the first golden set | Reuses existing fixtures — no new data |
| 1.5 | Expand golden sets: per business category, en/sw, 30 injection payloads | Synthetic only |

**Exit criteria:** flag-off inertness proven; eval harness scores the **current deterministic engine** as the baseline. This is the single highest-value phase because it makes every later change measurable.

**Deliberate omission:** no adapters, no gateway, no vector. Those need gates.

---

## Phase 2 — Evaluation and regression infrastructure (no gate)

Building on Phase 1, still with zero runtime change.

| # | Task | Notes |
|---|---|---|
| 2.1 | Retrieval quality metric (precision@k / recall over the catalogue) on the existing lexical engine | Baseline for Phase 4 comparison |
| 2.2 | Answer-grounding metric: every claim traceable to a structured row, FAQ or approved document | Encodes the existing `STRUCTURED_DATA_WINS` invariant as a measurement |
| 2.3 | Sheng / Kenyan-accented-English / code-switched corpus | Synthetic; this is the real multilingual gap |
| 2.4 | Cost + latency harness (mocked provider) | Proves the circuit breaker logic |
| 2.5 | Wire results into the existing `recordAIQualityEvent` | No new evaluation store |

**Exit criteria:** a report showing current deterministic quality per category, with numbers. No product change.

---

## Phase 3 — LLM phrasing behind a flag — **GATE G-3**

| # | Task | Notes |
|---|---|---|
| 3.1 | `ChatPort` implementation on the OpenAI-compatible contract (extend `lib/voice/llm.ts` pattern) | `null` on any failure |
| 3.2 | Additive `phrasing?:` parameter to `handleAIFrontDeskTurn` | Default undefined ⇒ today's behaviour |
| 3.3 | **Facts-locked guard**: model receives only `facts[]`; system prompt marks facts as data | T-2 |
| 3.4 | **Numeric-token assertion**: every number in the output must exist in the fact set, else discard | T-3, the critical rule |
| 3.5 | Redaction before render/speak | T-5 |
| 3.6 | Per-tenant ceiling + global circuit breaker + usage ledger | T-6 — **must land before 3.7** |
| 3.7 | Enable for **one internal business only** | Canary |

**Exit criteria:** Phase 2 metrics show improvement; numeric-token assertion has zero violations over the golden set; cost per turn measured and under the (owner-set) ceiling; canary shows no factual regression.
**Rollback:** flip the flag. Deterministic path resumes; no data migration to undo.

---

## Phase 4 — Semantic retrieval — **GATE G-1 (schema)**

| # | Task | Notes |
|---|---|---|
| 4.1 | Owner confirms Neon supports `CREATE EXTENSION vector` (read-only check) | I-2 |
| 4.2 | Migration: `vector` extension + `AiKnowledgeChunk` + HNSW | Design in `05` §3.3; **`DESIGN ONLY` today** |
| 4.3 | `buildVectorQuery(tenantId, …)` — tenant is a required first argument | T-1 primary control |
| 4.4 | Incremental, idempotent chunker over `KnowledgeDocument`/`FAQ` (`contentHash`) | No bulk write without approval |
| 4.5 | Fusion: lexical authoritative, vector recall-only; re-resolve every price | §3.2 |
| 4.6 | `ai-infra-tenant-isolation` + `ai-infra-vector-query-shape` tests | T-1 |

**Exit criteria:** retrieval precision improves over Phase 2 baseline; cross-tenant test zero hits; every price still from `authoritativeUnitPrice`.
**Rollback:** drop table + extension. Nothing else references them.

---

## Phase 5 — Cost ledger and admin visibility — **no new gate (extends Phase 3)**

| # | Task | Notes |
|---|---|---|
| 5.1 | Tenant-scoped append-only usage records | Mirror `VoiceUsageRecord`; no second billing engine |
| 5.2 | `/admin` per-tenant cost view | Reads the same records |
| 5.3 | Threshold warnings before enforcement | Consistent with `02_ENTITLEMENT_MATRIX` §3 |

**Exit criteria:** invoiced provider cost reconciles with the ledger within tolerance.
**Blocking:** Phase 3 must not be enabled for real customers before 5.1–5.2.

---

## Phase 6 — Licence-free voice — **GATES G-4 / G-5**

**Deliberately last**, because the Voice tier is unsellable until the owner's Telnyx gates are set (`06` §1).

| # | Task | Notes |
|---|---|---|
| 6.1 | `worker/ai-media` Docker (Kokoro TTS + faster-whisper STT + silero-vad) | Sibling of `voice-media`; port 8788 |
| 6.2 | Additive `kokoro` / `faster-whisper` branches in `resolveSpeechAdapters` | Existing interface unchanged |
| 6.3 | Weight manifest + SHA-256 pins (Phase L.2) | T-8 |
| 6.4 | Chatterbox Kiswahili path — **DEFER** | MIT but retired; only if Kokoro's language gap blocks Voice |
| 6.5 | Voice eval: Kiswahili + accented-English WER / MOS | Phase 2.3 corpus |

**Exit criteria:** STT WER and TTS intelligibility acceptable on the eval corpus; per-call marginal cost ≈ 0; the owner's Telnyx gates remain the only thing between this and `canSell`.
**Rollback:** stop the worker; hosted adapters still work if configured.

---

## Phase 7 — Explicitly out of scope until separately authorised

Recorded so nothing is smuggled in.

- Tier/allowance changes, new packages, price changes (`docs/commercial/`).
- Any `lib/payments` change.
- Self-hosted LLM / GPU tier (data-residency decision, not cost).
- Replacing the deterministic Front Desk.
- Any production deployment.
- Schema restructure of the 4,822-line Prisma file.
- TAPNET (does not exist — `06` §5).

---

## Sequencing rationale

| Decision | Reason |
|---|---|
| Baseline before any code | 3 pre-existing failures would mask regressions |
| Eval before LLM | Otherwise "better" is unfalsifiable |
| LLM before retrieval | Retrieval without an eval baseline cannot be judged |
| Cost ledger inside Phase 3 | Enabling a metered call without a ceiling is a financial bug, not a feature |
| Voice last | Highest cost/risk, and commercially gated by the owner regardless |
| Zero new npm dependencies | All model risk confined to one optional sidecar (`04` §6) |

## Effort indication

Deliberately not expressed in days — this repository's own history shows estimates are unreliable, and inventing them would be a speculative completion claim. Phases are ordered by dependency and risk; each is independently shippable and independently abandonable.
