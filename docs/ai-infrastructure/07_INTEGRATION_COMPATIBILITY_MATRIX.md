# 07 — INTEGRATION AND COMPATIBILITY MATRIX

**Constraint being tested:** the layer must preserve Next.js 16.4.2 / React 18.3.1 / Prisma 5.22.0 / Neon PostgreSQL / Vercel / Paystack, and must not break any existing route, test or entitlement.

---

## 1. Runtime compatibility

| Requirement | Existing | Layer needs | Compatible? | Evidence |
|---|---|---|---|---|
| Node | `^20.19 \|\| >=22.12` | same | ✅ | `package.json` engines |
| Next.js | 16.4.2 (App Router) | no change | ✅ | Server-only code; no new client boundary |
| React | 18.3.1 | no change | ✅ | No new client component |
| Prisma | 5.22.0 | `Unsupported("vector(1024)")` + raw query | ⚠️ **requires migration (G-1)** | Prisma 5 supports `Unsupported` and `$queryRaw`; pgvector must be enabled per database |
| PostgreSQL | Neon | `CREATE EXTENSION vector` | ⚠️ **verify Neon plan allows it** — this is an owner/Vercel-side check, not a code question | Neon supports pgvector on current tiers; **NOT TESTED here** (no engine, no DB) |
| Vercel serverless | functions | no change | ✅ | Layer adds no long-running work to the app |
| Vercel timeout | default | LLM calls need ≤ 8 s | ✅ | Mirror `lib/voice/llm.ts` `TIMEOUT_MS = 8_000` |
| Paystack | merchant `2006074` | **no interaction** | ✅ | Untouched |
| Cloudflare R2 | optional, fails closed | no interaction | ✅ | Untouched |
| Telnyx voice | readiness-gated | adapter options only | ✅ | `resolveSpeechAdapters` already provider-agnostic |
| `ws` voice worker | Docker, port 8787 | new worker uses 8788 | ✅ | No port collision |
| Rate limiter | in-process `Map` | **must not be the cost control** | ⚠️ design constraint | `lib/rate-limit.ts` is per-instance |
| Webpack client-boundary plugin | `lib/team-access` rewrite | must not match new modules | ✅ | Plugin regex is `team-access$` only |

---

## 2. Integration seams — every one is existing code

| # | Seam | Existing signature | Layer's use | Changes to existing file? |
|---|---|---|---|---|
| 1 | `getBusinessBrain(businessId)` | `lib/ai-business-brain.ts` | Facts for every prompt | **No** |
| 2 | `executeBusinessTool(tool, args, ctx)` | `lib/ai-tools.ts` | Only execution path for actions | **No** |
| 3 | `authoritativeUnitPrice(product)` | `lib/ai-grounding.ts` | Re-resolves every price before speech | **No** |
| 4 | `handleAIFrontDeskTurn(...)` | `lib/ai-front-desk.ts` | Adds optional `phrasing` param | **Yes — additive, default undefined** |
| 5 | `resolveSpeechAdapters(env)` | `lib/voice/speech/index.ts` | Adds `kokoro` / `faster-whisper` branches | **Yes — additive** |
| 6 | `resolveLlmAdapter(env)` | `lib/voice/llm.ts` | Adds `baseUrl` provider flexibility | **Yes — additive** |
| 7 | `writeAuditEvent(...)` | `lib/audit.ts` | All layer audit | **No** |
| 8 | `canBusinessRolePerform(role, action)` | `lib/tenant.ts` | Unchanged gate | **No** |
| 9 | `recordAIQualityEvent(...)` | `lib/intelligence.ts` | Eval events | **No** |
| 10 | `checkQuota(...)` | `lib/ai/quota.ts` | Pattern to copy for new meters | **No** |

**Seven of ten seams require zero change to existing files.** The three that change do so **additively with a default that preserves today's behaviour exactly** — no existing call site needs editing, and no existing test changes meaning.

---

## 3. Route compatibility

189 existing route handlers. The layer adds **no** public route. It adds:

| New route | Type | Flag | Reachable when |
|---|---|---|---|
| *(none)* | — | — | — |

The gateway is a **separate process**, not a Next.js route. This is deliberate: a Next.js route would be publicly addressable, would inherit the app's auth model, and would put model calls on the same serverless budget as customer pages.

**Compatibility rule enforced:** every existing route's behaviour is identical with `AI_INFRA_ENABLED` unset. Verified by the existing 4,676 passing tests continuing to pass (`11_ACCEPTANCE_REPORT.md` §1).

---

## 4. Data-layer compatibility

| Concern | Position |
|---|---|
| Migration | **Not created.** Design in `05` §3.3 is `DESIGN ONLY — NOT APPLIED`. |
| Existing tables | Unmodified. No column added, dropped or renamed. |
| New table | `AiKnowledgeChunk` (design only), `businessId` + `onDelete: Cascade` + `@@index([businessId])` — matches the pattern of all 192 existing models. |
| Backfill | Chunking is incremental from `KnowledgeDocument`/`FAQ`; idempotent via `contentHash`. No bulk write authorised. |
| Rollback | `DROP TABLE AiKnowledgeChunk; DROP EXTENSION vector;` — no other table references it. |
| Tenant isolation | Application-level `WHERE businessId = $1`, identical to every other model. **Not** relied upon from the vector index. |
| Money | Never stored, computed or rounded by the layer. |

---

## 5. Subscription and entitlement compatibility

| Product | Entitlement module | Layer interaction |
|---|---|---|
| AFTERCALL | `lib/subscriptionFlow.ts` | none |
| AI Front Desk ×4 tiers | `lib/ai-entitlement.ts` + `lib/frontDeskTiers.ts` | reads `entitled`; **never writes** |
| Website Studio | `lib/experience/entitlement.ts` | none |
| Business POS | `lib/pos/entitlement.ts` | none |
| BOS/ERP | `lib/erp/entitlement.ts` | none |
| MJENGO OS | `lib/mjengo/entitlement.ts` | none |
| Autopilot ×3 | `lib/autopilot/entitlement.ts` | reads `entitled` |
| Team free access | `lib/team-access.ts` | none — and the layer must not import it into client code |

**Explicit non-behaviour:** the layer does **not** grant a capability to a tier. If an owner wants semantic retrieval to be a Pro-tier feature, that is a catalogue + entitlement decision under `docs/commercial/` and requires separate approval. The layer only makes the capability exist.

---

## 6. Test-suite compatibility

| Suite | Files | Effect |
|---|---:|---|
| `tests/unit` | 282 | Must be unchanged. Layer adds new files only. |
| `tests/integration` | 90 (16 need Postgres) | Unchanged |
| `tests/prisma` | — | Unchanged |
| `tests/e2e` | 3 | Unchanged |
| `tests/security` | — | Unchanged; new security tests added alongside |
| New | — | `tests/unit/ai-infra-*`, `tests/security/ai-infra-*`, `tests/unit/licence-*` |

**Non-negotiable gate:** the 3 pre-existing failures in `tests/unit/autopilot-*` must be **fixed or explicitly accepted before** the layer merges, because otherwise a new failure cannot be distinguished from an old one. This is recorded in `10_IMPLEMENTATION_ROADMAP.md` Phase 0.

---

## 7. Incompatibilities and constraints (honest list)

| # | Constraint | Impact | Mitigation |
|---|---|---|---|
| I-1 | Prisma engine cannot be downloaded in this sandbox (`binaries.prisma.sh` unreachable) | 16 Postgres suites and any DB-touching verification are **NOT TESTED** | Run in CI, which has network. Recorded, not worked around with mocks. |
| I-2 | Neon must permit `CREATE EXTENSION vector` | Retrieval blocked if not | Verify with a read-only query before G-1 |
| I-3 | `lib/rate-limit.ts` is per-instance | Multi-instance cost control is unreliable | Gateway enforces its own counters; app-level limiter stays a UX guard only |
| I-4 | Vercel function duration | LLM must not run long | 8 s timeout, streaming optional later |
| I-5 | `lib/voice/llm.ts` is OpenAI-only by design | Adding a provider means editing that file | Additive `provider` branch; keep `null` fallback |
| I-6 | 4,822-line single Prisma schema | `prisma generate` on every change is slow; merge conflicts | Do not restructure in this workstream (out of scope, high risk) |
| I-7 | Voice tier unsellable until owner gates | Kokoro work has no revenue until then | Sequence voice **last** |
| I-8 | Kokoro has no Kiswahili | Voice quality gap for the primary non-English language | Chatterbox (MIT) as the Kiswahili path; **DEFER, retired upstream** |

---

## 8. Compatibility verdict

| Dimension | Verdict |
|---|---|
| Framework | **COMPATIBLE** — no version change, no new client boundary |
| Runtime (Vercel) | **COMPATIBLE** — no new long-running work in the app |
| Database | **CONDITIONAL** — one extension + one table, gated on G-1 and Neon support |
| Payments | **COMPATIBLE / UNTOUCHED** |
| Entitlements | **COMPATIBLE / READ-ONLY** |
| Routes | **COMPATIBLE** — adds none |
| Tests | **COMPATIBLE** — additive; but pre-existing failures must be resolved first |
| Deployment | **INDEPENDENT** — the only new process is optional and flag-gated |
