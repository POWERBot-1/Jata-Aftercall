# 05 — CUMULATIVE ARCHITECTURE

**The word operating this design is "cumulative".** Nothing here replaces, removes or re-implements an existing module. Every new component either wraps an existing function or sits behind a flag that is off by default.

---

## 1. Layer diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ PRODUCTS (unchanged)                                                          │
│ Business Page · AI Front Desk · Website Studio · POS · BOS/ERP · Autopilot    │
│ MJENGO OS · TAPNET (absent)                                                   │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  existing entitlement gates — NOT bypassed
                                │  lib/tenant.ts · lib/ai-entitlement.ts · lib/pos ·
                                │  lib/erp · lib/autopilot · lib/mjengo · lib/experience
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ EXISTING DETERMINISTIC CORE (unchanged, always the source of truth)           │
│  lib/ai-business-brain.ts   authoritative tenant facts                        │
│  lib/ai-grounding.ts        authoritative price/stock/policy + lexical match  │
│  lib/ai-commerce-turn.ts    cart/order/booking turn resolution                │
│  lib/ai-tools.ts            READ / WRITE / HIGH_RISK registry + role gate      │
│  lib/intelligence.ts        quality events, unanswered questions              │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  ONE seam: lib/ai-infra/index.ts
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ JATA AI INFRASTRUCTURE LAYER  (new, flag-gated, removable)                    │
│                                                                               │
│   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│   │ Brain façade│  │ Model adapter│  │  Retrieval   │  │  Eval harness    │   │
│   │ (wraps)     │  │ (chat+embed) │  │  hybrid      │  │  golden + score  │   │
│   └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────────────────┘   │
│          │                │                 │                                 │
│   ┌──────▼────────────────▼─────────────────▼───────────────────────────────┐ │
│   │ Policy engine: quota · redaction · allow-list · approval routing        │ │
│   │ (composes existing rules; introduces no second authorisation model)     │ │
│   └──────────────────────────────┬──────────────────────────────────────────┘ │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │  HMAC-signed, versioned, tenant-scoped
┌──────────────────────────────────▼───────────────────────────────────────────┐
│ services/jata-ai-gateway   (separate process · separate deploy · port 8788)  │
│   v1/chat · v1/embed · v1/stt · v1/tts                                        │
│   adapters: openai-compatible · local · loopback                              │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                           ▼
  Hosted API (existing)     Self-host weights            worker/ai-media
  OpenAI / Gemini           (Apache-2.0/MIT only)         Kokoro TTS · faster-whisper
  already configured        vLLM · llama.cpp              Docker · CPU
```

**Note the arrow direction.** Product code never talks to a model. It talks to `lib/ai-infra/index.ts`, which talks to the existing deterministic core first and *may* consult a model for phrasing only. Facts never come from a model.

---

## 2. Why this is a façade, not a new brain

The directive's instruction 8 asks for a "shared Business Brain". **It already exists.** Building a second one would violate instruction 5 and would mean two sources of truth for prices.

| Directive asks for | Already exists | Layer's role |
|---|---|---|
| Shared Business Brain | `getBusinessBrain()`, `detectKnowledgeConflicts()` | **Wrap.** Add nothing to the auth path. |
| Model adapter | `lib/ai/provider.ts`, `lib/ai/providers/*`, `lib/voice/llm.ts` | **Extend** with a chat + embedding port on the same OpenAI-compatible contract. |
| Retrieval engine | Lexical scoring in `lib/ai-grounding.ts` (~55 exports) | **Add a second ranker** (vector) and fuse. Keep lexical as the fail-safe. |
| Multilingual voice | `lib/voice/language.ts` (en/sw), `lib/voice/speech/*` | **Add adapters** (Kokoro, faster-whisper) behind the existing interface. Add a Sheng/accent eval set. |
| Controlled agent framework | `AI_TOOL_REGISTRY` + HIGH_RISK gate + Autopilot approve/rollback | **Wrap.** Do not add a second tool registry. |
| Evaluation infrastructure | `AIQualityEvent`, `UnansweredQuestion`, `PREVIEW_TEST_QUESTIONS`, 438 test files | **Build here.** This is the genuine gap. |

**Three of six are already built.** Two need extension. One needs building. That reordering is the single most important output of this workstream.

---

## 3. The retrieval design (the genuine new capability)

### 3.1 Why hybrid, not pure vector

The existing lexical matcher is not a toy: it handles token singularisation, unit/pack tokens, stopword filtering, class words, unlisted-product detection, and Kenyan conversational phrasing. It is deterministic, free, explainable, and covered by behavioural tests. Replacing it with embeddings would:

- introduce a new failure mode (semantic near-miss returns a *wrong* price);
- add per-query cost and latency;
- break the guarantee that an answer can be traced to a structured row.

So vector search is added **as a recall expander**, and lexical remains the **precision authority**.

### 3.2 Fusion rule

```
FINAL_SCORE = 1.0 · lexical_exact      (structured row match — unconditional win)
            + 0.3 · lexical_fuzzy       (token overlap)
            + 0.2 · vector_similarity   (pgvector cosine)
```

Any candidate that resolves to a **structured product row** (price, stock) is re-resolved through `authoritativeUnitPrice()` before it is spoken. **A vector hit can never introduce a fact — it can only surface a row that is then read authoritatively.** This preserves the existing `STRUCTURED_DATA_WINS` invariant.

### 3.3 Chunking and schema (design only — G-1 required)

```prisma
// DESIGN ONLY — NOT APPLIED
model AiKnowledgeChunk {
  id          String   @id @default(cuid())
  businessId  String                       // tenant key, every query filters on it
  documentId  String?
  source      String                       // knowledge_document | faq | product | policy
  content     String   @db.Text
  contentHash String                       // dedupe; re-embed only when changed
  embedding   Unsupported("vector(1024)")? // bge-m3 dimension
  updatedAt   DateTime @updatedAt
  @@unique([businessId, contentHash])
  @@index([businessId])
}
```

Plus `CREATE EXTENSION IF NOT EXISTS vector;` and an HNSW index with `WHERE businessId = …` filtering applied in the query, not post-filtered.

**Tenant isolation on vectors is application-enforced, exactly like every other table.** The design does *not* rely on the vector index for isolation — every query is `WHERE businessId = $1 AND …`. Consistent with the existing codebase, where isolation is in `lib/tenant.ts` and every model carries `businessId`.

---

## 4. The model adapter contract

One port, OpenAI-compatible, because `lib/voice/llm.ts` already proves the pattern works with `OPENAI_BASE_URL`.

```ts
export type AiInfraContractVersion = "2026-11-aiinfra-v1";

export interface ChatPort {
  complete(req: {
    system: string;
    facts: string[];          // the ONLY permitted factual input
    userTurn: string;
    maxTokens: number;        // hard cap
    temperature: number;      // ≤ 0.3 for customer-facing text
    language: "en" | "sw";
  }): Promise<{ text: string } | null>;   // null ⇒ caller falls back, never throws
}

export interface EmbedPort {
  embed(texts: string[], opts: { model: string }): Promise<number[][]>;
}
```

**Fail-closed by construction:** `null` means "use the deterministic answer". A provider outage degrades phrasing, never availability, and never invents a fact. This mirrors `resolveLlmAdapter`'s existing behaviour ("Fail-closed by design: any provider error, timeout or malformed response yields null").

---

## 5. Versioning and authentication of the interface

| Concern | Design |
|---|---|
| Version | URL path `v1/` **plus** a `CONTRACT_VERSION` header asserted on both sides. Mismatch = refuse, loudly. |
| Auth | Per-request HMAC over `(method, path, body-sha256, timestamp, nonce)`. Shared secret from the environment. Mirrors the existing `VOICE_MEDIA_STREAM_TOKEN` and `lib/telnyx/webhook-signature.ts` patterns. |
| Replay | Timestamp window (±60 s) + nonce cache. |
| Tenant | `X-Jata-Tenant` claim, HMAC-signed. The gateway re-verifies the tenant exists and the entitlement is active **before** doing work — it does not trust the caller's assertion alone. |
| Network | The gateway binds `0.0.0.0` in containers but is not publicly routable; it accepts only signed calls from the app origin. |
| Rate/quota | The gateway enforces its own counters. **Do not rely on `lib/rate-limit.ts`** — it is a per-instance in-memory `Map` and is therefore not a cost control across serverless instances. |

---

## 6. Independent deployability

The layer is deployable in four independent units, each with its own risk and its own gate:

| Unit | Depends on | Gate | Removable by |
|---|---|---|---|
| `lib/ai-infra` (dormant) | nothing new | none | deleting one directory |
| `services/jata-ai-gateway` | a host | **G-4** | not deploying it |
| `worker/ai-media` | CPU + Docker | **G-4/G-5** | not deploying it |
| `pgvector` + chunks | Postgres extension | **G-1** | dropping the extension |

Because the flag is off by default, unit 1 can ship with **zero** customer-visible change, and units 2–4 are inert without it.

---

## 7. Explicit non-goals

Stated so they cannot be inferred later.

- **No new subscription tier.** The four Front Desk tiers stay as they are; every allowance remains PENDING OWNER DECISION per `docs/commercial/02_ENTITLEMENT_MATRIX.md`.
- **No price change.** `PlanConfig` is untouched.
- **No new payment path.** `lib/payments` untouched.
- **No new audit sink.** `lib/audit.ts` is the only audit trail.
- **No new tenant model.** `businessId` remains the tenant key.
- **No replacement of the deterministic Front Desk.** It is the fallback, permanently.
- **No production deployment in this workstream.**
