# 06 — PRODUCT-BY-PRODUCT CAPABILITY MATRIX

Maps each infrastructure capability to each product. **"Today"** = what the repository actually does at `ee59d95`. **"With layer"** = what the flag-gated layer would add. A cell that grants nothing is marked `—`; nothing here implies a commercial entitlement change (all allowances remain PENDING OWNER DECISION per `docs/commercial/02_ENTITLEMENT_MATRIX.md`).

---

## 1. Capability sweep

### Business Page (`/b/[slug]`, `MONTHLY`/`ANNUAL`, KES 149/999) — **public, unauthenticated**

| Capability | Today | With layer | Value |
|---|---|---|---|
| Business Brain grounding | ✅ via `getBusinessBrain` | unchanged | — |
| Lexical retrieval | ✅ `ai-grounding` | unchanged | — |
| Semantic retrieval | ❌ | ✅ surfaces approved knowledge for "do you do X?" questions | **HIGH** — most common public question type |
| Chat (web_chat channel) | ✅ deterministic | LLM phrasing only, facts still deterministic | MEDIUM |
| Multilingual | partial (en/sw heuristics) | better Sheng/accent handling | HIGH |
| Voice | ❌ (Voice tier gated) | unchanged | — |
| Agent actions | `create_lead`, `request_human` | unchanged | — |
| Eval | quality events | golden-set regression per business category | MEDIUM |

**Risk note:** this is the only surface reachable by an anonymous internet user. Any model call added here must be cost-capped **per IP and per instance**, and must never be able to reach `HIGH_RISK` tools (already impossible — the registry gate requires a non-CUSTOMER role).

### AI Front Desk (Starter 499 / Standard 999 / Pro 1,999 / Voice 3,999)

| Capability | Today | With layer | Value |
|---|---|---|---|
| Brain | ✅ | unchanged | — |
| Tools | ✅ 22 tools, 3 tiers | unchanged | — |
| Commerce turn (cart/order/booking) | ✅ `ai-commerce-turn.ts` (1,128 lines) | unchanged | — |
| LLM phrasing | ❌ none | ✅ optional, facts-locked | **HIGH** — answers currently read as template output |
| Semantic retrieval | ❌ | ✅ | **HIGH** |
| Conversation memory | ✅ within tenant session | unchanged | — |
| Voice (STT/TTS) | interface + adapters, provider unconfigured | Kokoro/faster-whisper = licence-free path to `canSell` | **HIGHEST commercial value** — unlocks the KES 3,999 tier without per-minute vendor fees |
| Quality eval | events only | regression harness | HIGH |
| Token/message metering | ❌ none | ✅ required before any paid LLM tier | **BLOCKING for cost control** |

**Dependency:** the Voice tier cannot be sold until `getVoiceReadiness().canSell` is true, which needs `TELNYX_VOICE_LIVE_VERIFIED` **and** `VOICE_CALLS_ENABLED` **and** `VOICE_CUSTOMER_BILLING_ENABLED`. The layer can make voice *cheaper and licence-clean*; it cannot make it *sellable* — that is an owner verification gate.

### Website Studio (`INTERACTIVE_BUSINESS`, KES 999)

| Capability | Today | With layer | Value |
|---|---|---|---|
| Image generate / enhance | ✅ `jata-local`, OpenAI, Gemini | unchanged | — |
| Copy assist | ✅ + quota (40/40/400 per month) | unchanged | — |
| Design context / prompt builder | ✅ `designContext.ts`, `promptBuilder.ts` | unchanged | — |
| Retrieval over the business's own copy | lexical only | semantic brand-voice consistency | MEDIUM |
| Eval | image fixtures | visual/prose regression | LOW |

**Verdict: lowest-priority product for this layer.** Studio already has the most complete AI stack, its own quota system, and a working deterministic fallback. Do not touch it in Phases 1–4.

### Business POS (`BUSINESS_POS`, KES 499, private)

| Capability | Today | With layer | Value |
|---|---|---|---|
| Deterministic money | ✅ `lib/pos/money.ts` | **must remain untouched** | — |
| Sales / inventory / credit | ✅ 40 modules | unchanged | — |
| Natural-language stock query | ❌ | read-only tool over existing reports | MEDIUM |
| Voice note entry | ❌ | STT → existing POS forms | LOW (needs approval UI) |
| Any write action | role-gated | **unchanged — HIGH_RISK gate still applies** | — |

**Hard rule:** no model output may ever compute a price, total, tax or stock level. Those stay in `lib/pos/money.ts` and `lib/ai-grounding.authoritativeUnitPrice`. An LLM may only *phrase* a number that deterministic code produced.

### JATA BOS PRO / ERP (`ERP_PRO`, KES 3,000, private)

| Capability | Today | With layer | Value |
|---|---|---|---|
| Double-entry accounting | ✅ deterministic | untouched | — |
| eTIMS | ❌ disabled by design | untouched | — |
| Approvals | ✅ `lib/erp/approvals.ts` | unchanged | — |
| Document Q&A ("what did we spend on X?") | ❌ | retrieval over existing journal/report output | **HIGH for owners** |
| Draft invoice/quote text | ❌ | LLM drafts, human approves | MEDIUM |
| Anomaly narrative | ❌ | LLM explains a deterministic detection | MEDIUM |

**Hard rule:** the model reads **aggregates produced by `lib/erp/accounting.ts`**; it never posts a journal entry. `ErpApprovalRequest` remains the only path to a consequential action.

### JATA Autopilot (2,499 / 6,999 / 19,999, private)

| Capability | Today | With layer | Value |
|---|---|---|---|
| Propose → approve → execute → rollback | ✅ `lib/autopilot/actions.ts` | unchanged | — |
| Policy / consent / security | ✅ 3 modules | unchanged | — |
| Industry packs | ✅ 17 KB | unchanged | — |
| Proposal quality | rule-based | LLM-drafted proposals, **still requiring approval** | HIGH |
| Eval | ❌ | proposal-acceptance-rate harness | HIGH |

**This product is the best natural home for the LLM layer** because consequential actions already require explicit human approval (`approveAndExecuteProposal`). The safety property that makes LLMs risky elsewhere is already enforced here.

### MJENGO OS (`MJENGO_OS`, KES 2,000, private)

| Capability | Today | With layer | Value |
|---|---|---|---|
| Access / CSRF / settlement / sanitisation | ✅ 7 modules, no `dangerouslySetInnerHTML` | untouched | — |
| Site/workspace generation | ✅ | unchanged | — |
| Semantic brand/theme retrieval | ❌ | low value | LOW |
| Swahili-first copy | partial | improvement | MEDIUM |

### TAPNET — **see §5**

---

## 2. Prioritised capability ordering

Ranked by (commercial value ÷ (risk × effort)). This ordering is what `10_IMPLEMENTATION_ROADMAP.md` follows.

| Rank | Capability | Product(s) | Why first |
|---:|---|---|---|
| 1 | **Evaluation infrastructure** | all | Zero customer risk, zero schema change, makes every later change safer. Everything else is unmeasurable without it. |
| 2 | **LLM phrasing behind a flag, facts-locked** | AI Front Desk | Highest visible quality gain; deterministic fallback means worst case = today's behaviour. |
| 3 | **Semantic retrieval via pgvector** | Business Page, Front Desk, ERP Q&A | Unlocks the questions lexical matching cannot answer. Requires G-1. |
| 4 | **Licence-free voice (Kokoro + faster-whisper)** | AI Front Desk Voice | Removes per-minute vendor cost from a KES 3,999 tier. Needs G-4/G-5. |
| 5 | **Cost/usage ledger** | Front Desk, Autopilot | Mandatory before any metered tier; currently absent. |
| 6 | **Sheng/accent multilingual eval + tuning** | Front Desk Voice, Business Page | The real differentiation for a Kenyan SME product. |
| 7 | Studio / POS / MJENGO integration | — | Already well-served. Defer. |

---

## 3. What the layer deliberately does not do for any product

- Change a price, plan key, entitlement duration or grace rule.
- Add a payable capability to any tier.
- Change a payment, wallet or reconciliation path.
- Add an authorisation model (HIGH_RISK gate is the only one).
- Compute money.
- Write to a customer-visible surface without the deterministic path having produced the facts first.

---

## 4. Coverage summary

| Product | Capabilities the layer could improve | Blocking dependency |
|---|---:|---|
| Business Page | 4 | none for 2; G-1 for semantic |
| AI Front Desk | 7 | G-1 (retrieval), G-3 (LLM), G-4/5 (voice) |
| Website Studio | 2 | none — defer |
| Business POS | 2 | none — defer |
| JATA BOS PRO | 3 | G-1 |
| JATA Autopilot | 3 | G-3 |
| MJENGO OS | 2 | none — defer |
| TAPNET | **cannot be assessed** | absent from repository |

---

## 5. TAPNET — cannot be mapped

**TAPNET does not exist in this repository.** Verified three ways: case-insensitive search across all `.ts`, `.tsx`, `.prisma` and `.md` files for `tapnet`, `tap net` and `TAP_NET` returned zero matches; there is no route, model, module, plan key or environment variable; and it is not mentioned in `README.md`, `.env.example`, `docs/` or the 40+ status documents.

It is also **not** the same thing as:
- **JATA Qi** (`lib/qi/`) — an authenticated work-ingress seam, currently inactive with no live transport.
- **JATA Tawa** (`docs/MJENGO_TAWA_*`) — an earlier codename for the MJENGO OS work.
- **JATA ATLAS** — the Paystack merchant entity (`2006074`).

**Therefore instruction 9's requirement to map capabilities to TAPNET is BLOCKED — not because of authorisation, but because there is no such product in the codebase.** Mapping it would require inventing a product, which is the kind of speculative completion the execution principle forbids.

**Required to unblock:** the owner must state what TAPNET is — a new product to be designed, an external service to integrate, an alternative name for an existing module, or a typo. Until then it is carried as an open item (`11_ACCEPTANCE_REPORT.md` §4).
