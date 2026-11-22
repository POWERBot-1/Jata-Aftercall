# 09 — COST AND COMPUTE ASSESSMENT

**Caveat that governs this whole document.** No price was fetched from a live provider pricing page for this assessment, and no account, trial or credential was created. Every unit price below is **indicative**, drawn from published list prices as generally known, and **must be re-verified before any commitment**. FX is taken at **≈ KES 130 = USD 1**. Figures are order-of-magnitude planning numbers, not quotes.

---

## 1. The headline

| Option | Recurring software licence fee | New recurring infrastructure | Notes |
|---|---:|---|---|
| **Recommended path** (hosted API, existing keys, `pgvector` in existing Postgres) | **KES 0** | **KES 0 fixed** — usage-only | No new service to operate |
| Licence-free voice (Kokoro + faster-whisper on one CPU worker) | **KES 0** | ~USD 5–12/month | Removes per-minute TTS/STT fees |
| Self-hosted LLM (vLLM on GPU) | **KES 0** | ~USD 150–400/month minimum | Only justified at high volume or for data residency |

The directive's instruction 3 goal — "no recurring software licence fees" — is **fully achievable**. Compute is a separate axis and is usage-driven.

---

## 2. Per-operation indicative costs

| Operation | Unit price (indicative) | Typical JATA turn | Cost/turn |
|---|---|---|---|
| Chat completion, small model (`gpt-4o-mini` class) | ~USD 0.15 / 1M input, ~USD 0.60 / 1M output | ~800 in / 120 out tokens | ~USD 0.00019 (**≈ KES 0.025**) |
| Chat completion, mid model (`gpt-4o` class) | ~USD 2.50 / 1M in, ~USD 10 / 1M out | same | ~USD 0.0032 (**≈ KES 0.42**) |
| Embedding (`text-embedding-3-small` class) | ~USD 0.02 / 1M tokens | ~200-token chunk | ~USD 0.000004 (**KES 0.0005**) |
| Whisper STT (hosted) | ~USD 0.006 / minute | 2-minute call | ~USD 0.012 (**KES 1.56**) |
| TTS (hosted) | ~USD 15 / 1M chars | ~600 chars | ~USD 0.009 (**KES 1.17**) |
| **Kokoro TTS (self-hosted, CPU)** | **USD 0 marginal** | ~600 chars | **KES 0** + amortised worker |
| **faster-whisper (self-hosted, CPU)** | **USD 0 marginal** | 2-minute call | **KES 0** + amortised worker |

### The comparison that decides the voice question

At KES 3,999/month, a Voice-tier subscriber who makes **200 two-minute calls** costs, hosted: 200 × (KES 1.56 STT + KES 1.17 TTS) ≈ **KES 546** in provider fees. Acceptable.

At **2,000 calls** (a busy SME front desk): ≈ **KES 5,460** — **more than the subscription price.** The hosted path is loss-making at realistic volume.

Self-hosted Kokoro + faster-whisper makes marginal cost **≈ KES 0** and caps cost at the worker's fixed price. **This single change is what makes the KES 3,999 Voice tier commercially safe**, which is why it ranks #4 in `06` §2 despite shipping last (it is gated on the owner's Telnyx verification).

---

## 3. Compute requirements

| Component | CPU | RAM | GPU | Disk |
|---|---|---|---|---|
| Kokoro-82M (TTS) | 2 vCPU, near real-time | ~1–2 GB | not required | ~350 MB weights |
| faster-whisper `small`/`base` | 2–4 vCPU | ~2–4 GB | optional for latency | ~150–500 MB |
| silero-vad | negligible | <100 MB | no | ~2 MB |
| `bge-m3` embeddings (self-host) | 2 vCPU (batch) | ~2 GB | optional | ~2.3 GB |
| `pgvector` | rides existing Postgres | rides existing | no | index ≈ 1.5× vector data |
| Qwen3-8B (vLLM, **only if self-host**) | — | 16–24 GB | **1× 24 GB GPU** | ~16 GB |

**One 4 vCPU / 8 GB CPU worker can run Kokoro + faster-whisper + VAD together.** That is the entire licence-free voice stack, and it fits the existing `worker/voice-media` Docker pattern (`Dockerfile.voice-media-worker` already builds a Node 22 slim image with a healthcheck).

---

## 4. Vector storage sizing

`bge-m3` at 1024 dimensions, `float32` = 4 KB per chunk.

| Business knowledge size | Chunks (≈400 tokens) | Vector bytes | With HNSW index (≈1.5×) |
|---|---:|---:|---:|
| Very small (10 pages) | ~50 | 200 KB | ~0.3 MB |
| Typical SME | ~500 | 2 MB | ~3 MB |
| Large (B2C catalogue) | ~5,000 | 20 MB | ~30 MB |

Even 1,000 businesses at typical size ≈ **3 GB**. This is comfortably inside an existing managed Postgres plan, and is the strongest practical argument for `pgvector` over a dedicated vector service — a separate service would cost more than the storage it holds.

---

## 5. Scenario modelling

Assumptions: 1,000 active Front Desk businesses, 40 customer turns/business/month (deliberately modest), 20% on a Voice tier at 150 calls/month. Phrasing on the small-model path.

| Line | Volume/month | Unit | Cost (USD) | Cost (KES) |
|---|---:|---|---:|---:|
| Chat phrasing | 40,000 turns | ~USD 0.00019 | 7.60 | ~988 |
| Embeddings (new/changed chunks) | ~100,000 chunks one-off, then ~10k/mo | ~USD 0.0000008/chunk | 0.01 | ~1 |
| **Subtotal, text-only layer** | | | **~7.61** | **~990** |
| STT hosted, 200 Voice businesses × 150 calls × 2 min | 60,000 min | USD 0.006/min | 360 | ~46,800 |
| TTS hosted, same | 18M chars | USD 15/1M | 270 | ~35,100 |
| **Voice, hosted** | | | **~630** | **~81,900** |
| **Voice, self-hosted** | 1 CPU worker | fixed | **~10** | **~1,300** |
| **Total, hosted voice** | | | **~638** | **~82,900** |
| **Total, self-hosted voice** | | | **~18** | **~2,340** |

**Reading of this table:**

1. **The text layer is commercially trivial** — under KES 1,000/month at 1,000 businesses. It is not a cost problem at all. The blocker is *cost visibility per tenant*, not the bill.
2. **Hosted voice is the only line that matters** — KES 82,900/month of provider fees against 200 Voice subscribers paying KES 3,999 = KES 799,800 revenue. It works at this volume, but the margin is 90% → ~40% once support and Telnyx carriage are added, and it inverts above ~2,000 calls/month per business.
3. **Self-hosting voice cuts the bill ~35×** and turns marginal cost into fixed cost. That is the entire commercial case for `worker/ai-media`.
4. **Self-hosted LLM (GPU) is not justified at any modelled volume** — the text layer costs ~USD 8/month hosted versus ~USD 150–400/month for a minimum GPU. The case for self-hosting an LLM is **data residency (T-4)**, not cost. This should be stated plainly to the owner.

---

## 6. Cost controls that must exist before any metered call is enabled

Instruction 10's "deterministic financial calculations" and T-6 ("denial of wallet") converge here.

| Control | Requirement |
|---|---|
| Per-tenant ceiling | Hard monthly token cap; on exhaustion, deterministic path only |
| Per-request cap | `maxTokens` fixed per route (voice already 160) |
| Global circuit breaker | Spend-rate threshold disables phrasing automatically |
| Ledger | One append-only usage record per call, tenant-scoped — **mirrors `VoiceUsageRecord`, does not create a second billing engine** |
| Reporting | `/admin` cost view per tenant, reconciled against the provider invoice |
| No auto-upgrade | Exceeding a ceiling never charges a customer; it denies with an upgrade prompt (consistent with `docs/commercial/02_ENTITLEMENT_MATRIX.md` §3) |
| Alerting | Owner-visible alert before any threshold is hit |

**Not authorised in this workstream:** no ceiling value is chosen here. Every allowance remains **PENDING OWNER DECISION** per the existing commercial matrix. This document only states that the *mechanism* must exist first.

---

## 7. One-off / setup costs

| Item | Cost | Notes |
|---|---|---|
| `pgvector` extension on Neon | KES 0 | Included in the existing plan tier if supported |
| Model weight downloads | KES 0 | Bandwidth only; ~2.8 GB total for Kokoro + faster-whisper + bge-m3 |
| Engineering | not costed | Internal |
| Provider accounts | **none created** | No trial, no commitment |
| GPU | **none** | Not required by this plan |

**Total additional committed spend to reach a working, licence-clean, flag-gated layer: KES 0.**

---

## 8. Verdict

| Question | Answer |
|---|---|
| Can this be done with zero recurring licence fees? | **Yes** — verified in `03`. |
| Can it be done with zero new fixed infrastructure? | **Yes** for text + retrieval. Voice needs one ~USD 5–12/month CPU worker. |
| Is cost a blocker? | **No.** Text layer is ~KES 1,000/month at 1,000 tenants. |
| Is there a cost trap? | **Yes** — hosted STT/TTS on a high-volume Voice tier. Mitigated by self-hosting or by a per-tenant minute cap. |
| Is a GPU needed? | **No**, unless data residency requires a self-hosted LLM. |
| Numbers verified? | **No — indicative only.** No live pricing page was read; re-verify before commitment. |
