# 02 — OPEN-SOURCE ACQUISITION REGISTER

**Acquisition question for every candidate:** can this be forked, modified and commercially used by JATA with no recurring software licence fee, in a **multi-tenant SaaS**, embedded in a **next/serverless** architecture?

**Method:** every licence was verified from the actual licence file via the GitHub API (`gh api repos/<r>/license`) or the model card, on 2026-11-22. SPDX identifiers marked `NOASSERTION` by GitHub were **opened and read** — that flag is where the traps are. Verdicts below are dated observations, not legal advice.

**Legend:** `ADOPT` = use as-is · `FORK` = copy/fork and adapt · `DEPEND` = install as a package · `REFERENCE` = read the design, write our own · `REJECT` = licence or architecture forbids it · `DEFER` = usable later, not now.

---

## 1. Inference runtimes

| Repository | Licence (verified) | Verdict | Reasoning |
|---|---|---|---|
| `vllm-project/vllm` | Apache-2.0 | **DEFER** | Best-in-class GPU serving, but needs a persistent GPU host. Vercel cannot run it. Only relevant if a self-hosted inference tier is approved (G-4/G-5). |
| `ggml-org/llama.cpp` | MIT | **DEFER** | CPU/quantised inference; viable for a cheap CPU worker later. Not needed to ship anything in this plan. |
| `ollama/ollama` | MIT | **REJECT for production** | Excellent developer tool. As a production dependency it adds a stateful daemon JATA must operate and secure. Use locally only. |

**Decision:** the AI layer talks to an **OpenAI-compatible HTTP contract** (`/v1/chat/completions`, `/v1/embeddings`). That contract is implemented by OpenAI, vLLM, llama.cpp, Ollama and self-hosted models alike. Pin the *protocol*, not the vendor — this is already the pattern in `lib/voice/llm.ts`, which respects `OPENAI_BASE_URL`. **Zero new runtime dependency is required to gain provider portability.**

---

## 2. Orchestration frameworks

| Repository | Licence (verified) | Verdict | Reasoning |
|---|---|---|---|
| `langchain-ai/langgraph` | MIT | **REFERENCE** | Graph/state-machine agent model is sound and is licence-clean. But JATA's agent loop already exists (`lib/ai-tools.ts` registry + `lib/autopilot/actions.ts` propose/approve/rollback). Adopting LangGraph means a second execution model beside a tested one. |
| `run-llama/llama_index` | MIT | **REFERENCE** | Same verdict. Its retrieval abstractions are useful as design input for the vector step, not as a dependency. |
| `crewAIInc/crewAI` | MIT | **REJECT** | Multi-agent role-play adds non-determinism to a product whose core value is deterministic, grounded commerce answers. Also pulls a large dependency tree. |
| `microsoft/autogen` | **CC-BY-4.0** (verified — the repo's `LICENSE` is the Creative Commons Attribution 4.0 text) | **REJECT** | CC-BY-4.0 is a *content* licence, not a software licence: no patent grant, and the attribution obligations are awkward for embedded code. Wrong licence class for a software dependency. |
| `langgenius/dify` | **Modified Apache-2.0** — *"Unless explicitly authorized by Dify in writing, you may not use the Dify source code to operate a multi-tenant environment"* | **REJECT (hard)** | JATA **is** a multi-tenant environment. This is a direct prohibition, not a nuance. Quoted from the fetched licence file. |
| `FlowiseAI/Flowise` | Apache-2.0 **except** `packages/server/src/enterprise/**` which is under a separate Commercial License | **REJECT** | The enterprise tree is the part that would matter. Forking the Apache portion gives a strictly inferior component that duplicates `lib/experience` (Website Studio). |
| `n8n-io/n8n` | **Sustainable Use License** — *"You may use or modify the software only for your own internal business purposes or for non-commercial or personal use"* | **REJECT (hard)** | Selling access to a product built on it is prohibited. Also `.ee.` files are not licensed at all. |
| `open-webui/open-webui` | **Custom "Open WebUI License"** — clause 4 forbids removing/altering branding above 50 end users without a written enterprise licence | **REJECT** | JATA has more than 50 users and would rebrand. Material breach risk. |

**Conclusion: acquire no orchestration framework.** Six of the eight most-recommended candidates are either licence-incompatible (4) or architecturally redundant (2). The remaining two are design references.

---

## 3. Retrieval / vector storage

| Repository | Licence (verified) | Verdict | Reasoning |
|---|---|---|---|
| `pgvector/pgvector` | **PostgreSQL Licence** (verified text: "Permission to use, copy, modify, and distribute … for any purpose, without fee") | **ADOPT (preferred)** | Runs inside the Postgres JATA already pays for. No new service, no new credentials, no new attack surface, no new bill. Every query stays inside the existing Prisma/tenant boundary. **This is the only vector option that adds zero infrastructure.** |
| `qdrant/qdrant` | Apache-2.0 | DEFER | Clean licence, good product — but a new stateful service to run, secure, back up and pay for. |
| `chroma-core/chroma` | Apache-2.0 | DEFER | Same objection. |
| `lancedb/lancedb` | Apache-2.0 | DEFER | Embedded (good fit conceptually) but a second storage engine beside Postgres. |
| `weaviate/weaviate` | **mixed: BSD-3-Clause outside `wl/`, proprietary inside `wl/`** | **REJECT** | The licence file states source in `wl/` is "all rights reserved" and BSD "does not grant the right to use these features or circumvent any license key". Feature set is licence-gated. |

**Decision:** `pgvector` on the existing Neon database, **behind an abstraction** so it can be swapped. Gate **G-1** (schema change) is required before any of it is built.

---

## 4. Speech — recognition (STT)

| Candidate | Licence (verified) | Verdict |
|---|---|---|
| `openai/whisper` (weights + code) | MIT | **ADOPT (baseline)** |
| `SYSTRAN/faster-whisper` | MIT | **ADOPT (preferred runtime)** — CTranslate2 reimplementation, far faster, same MIT terms |
| `k2-fsa/sherpa-onnx` | Apache-2.0 | ADOPT — CPU/on-device, good for a cheap always-on worker |
| `snakers4/silero-vad` | MIT | ADOPT — voice-activity detection to cut STT cost |

**Language caveat that decides the plan:** Whisper handles Kiswahili acceptably and English well, but **Kenyan-accented English and code-switched English/Kiswahili ("Sheng") are not well covered by any off-the-shelf model.** This is the real multilingual gap — not "support more languages". The existing `lib/voice/language.ts` (en/sw, explicit-switch-wins) is the correct skeleton.

## 5. Speech — synthesis (TTS)

| Candidate | Licence (verified) | Verdict | Reasoning |
|---|---|---|---|
| `hexgrad/Kokoro-82M` (weights) | Apache-2.0 | **ADOPT (primary)** | 82M params, runs near real-time on CPU, 54 voices, Apache-2.0 weights **and** code — commercially clean, no per-character fee. Language coverage is the limit (no Kiswahili). |
| Chatterbox (Resemble AI) | MIT (code **and** weights) | **ADOPT (secondary)** | Multilingual V3 covers 23+ languages **including Kiswahili**, MIT top-to-bottom, ~10 s zero-shot cloning, built-in watermark. **Retired as of Aug 2026** — MIT allows commercial use, but there are no future fixes. Vendor it, do not plan on upstream. |
| `rhasspy/piper` | MIT — but **archived 2025-10-06**; successor `OHF-Voice/piper1-gpl` is **GPL-3.0-or-later** | **REJECT for embedding** | The MIT repo is archived; the maintained successor is GPL-3. Because JATA distributes a hosted service and may ship on-premise later, GPL linkage is a needless constraint for a component this small. |
| `coqui-ai/TTS` (code) | MPL-2.0 | REFERENCE only | |
| `coqui/XTTS-v2` (weights) | **Coqui Public Model License — non-commercial** | **REJECT (hard)** | Non-commercial weights; and Coqui Inc. shut down in Jan 2024 so **no commercial licence can be purchased**. Also — separate risk — it does zero-shot voice cloning, which is a Kenyan voice-impersonation/fraud exposure JATA should not offer. |
| `SWivid/F5-TTS` | MIT code / **CC-BY-NC-4.0 weights** | **REJECT (hard)** | MIT code is a decoy; the released checkpoints are non-commercial. |
| `mymusise/ChatTTS` | — | **NOT VERIFIABLE** | `404` from the GitHub API at time of check. Do not use; unpinnable provenance. |
| `RVC-Project/…Voice-Conversion` | MIT | **REJECT** | Real-time voice conversion = impersonation capability. Reputational and fraud risk far exceeds any product value. |

## 6. Language models (weights)

| Candidate | Licence | Commercial in a SaaS? | Obligations that bite | Verdict |
|---|---|---|---|---|
| **Qwen3 dense (e.g. 8B)** | Apache-2.0 | Yes | Keep notice; explicit patent grant | **ADOPT as the self-host baseline** |
| Mistral Small / Ministral | Apache-2.0 | Yes | Same | ADOPT (alternative) |
| `openai/gpt-oss` | Apache-2.0 | Yes | Same + separate usage policy | ADOPT (alternative) |
| Llama 3.3 | Llama Community Licence | Yes, **under 700M MAU** | Must display "Built with Llama"; **derived model names must begin with "Llama"**; Meta AUP binds downstream; EU exclusion for multimodal | **AVOID by default** — the naming rule contaminates product naming |
| Gemma 3 | Gemma Terms of Use (custom) | Yes | Must pass Google's Prohibited Use Policy downstream "as an enforceable provision" in any agreement; no distillation | **AVOID by default** — contractual passthrough into customer terms |
| DeepSeek / GLM / Kimi (MIT / modified MIT) | MIT variants | Yes | Kimi has revenue/MAU display triggers | DEFER |
| MiniMax M-series | MiniMax Community Licence | **Separate agreement required** | — | REJECT |

**Decision:** any self-hosted model must be **Apache-2.0 or MIT**. Model *hosted API* usage (OpenAI, Gemini) is unaffected — this register governs weights JATA would host or redistribute.

## 7. Embedding models

| Candidate | Licence | Verdict |
|---|---|---|
| `BAAI/bge-m3` | MIT | **ADOPT** — multilingual, strong Kiswahili/English cross-lingual retrieval. |
| `sentence-transformers/all-MiniLM-L6-v2` | Apache-2.0 | ADOPT (cheap baseline) |
| Qwen3-Embedding | Apache-2.0 | ADOPT (multilingual alternative) |

## 8. Datasets — and the restriction nobody expects

| Dataset | Licence (verified) | Note |
|---|---|---|
| **Mozilla Common Voice** | **CC0 1.0** (public domain) | Kiswahili is included (a grant funded its addition after Kinyarwanda). **BUT** the download terms separately forbid re-hosting the dataset and forbid attempts to identify speakers. **CC0 on the data does not grant the platform's download terms.** |
| **FLEURS** | CC-BY-4.0 | ~12 h × 102 languages. Too small to train, correct for evaluation. Attribution required. |
| LibriSpeech | CC-BY-4.0 | English only. |

**Decision:** JATA may **train on** Common Voice and **sell the resulting model**, but may **not redistribute the corpus** and must not attempt speaker identification. FLEURS is the evaluation set. Both facts are recorded as obligations, not assumed away.

---

## 9. What is NOT acquired, and why that is the point

| Wanted capability | Why nothing is acquired |
|---|---|
| Business Brain | Already exists (`lib/ai-business-brain.ts`). Acquiring one would create the duplication instruction 5 forbids. |
| Agent framework | Already exists (`lib/ai-tools.ts` + `lib/autopilot/actions.ts`), including the human-approval gate. |
| Entitlement engine | Already exists, five times over, one per product. |
| Chat UI / admin console | `open-webui` and `dify` are licence-blocked; JATA already has a workspace UI. |
| Orchestration / RAG flow builder | `n8n`, `Flowise`, `dify` all licence-blocked; and all three would duplicate `lib/experience` + `lib/ai-*`. |
| Vector database service | `pgvector` inside the existing Postgres removes the need entirely. |

**Net acquisition footprint: 0 new runtime npm packages, 0 new services, 0 new recurring licence fees.** The only genuinely new artefacts are model weights (Apache/MIT only) and one Postgres extension.

---

## 10. Acquisition scorecard

| Category | Considered | Adopt/Fork | Defer | Reject (licence) | Reject (architecture) |
|---|---:|---:|---:|---:|---:|
| Inference runtimes | 3 | 0 | 2 | 0 | 1 |
| Orchestration | 8 | 0 | 0 | 4 | 4 (2 as reference) |
| Vector storage | 5 | 1 | 3 | 1 | 0 |
| STT | 4 | 3 | 0 | 0 | 1 |
| TTS | 8 | 2 | 0 | 4 | 2 |
| LLM weights | 7 | 3 | 1 | 1 | 2 (avoid) |
| Embeddings | 3 | 3 | 0 | 0 | 0 |
| Datasets | 3 | 2 | 0 | 0 | 1 |
| **Total** | **41** | **14** | **6** | **10** | **11** |

**24% of widely-recommended candidates are outright licence-blocked for this specific use.** That ratio is the reason instruction 4 exists.
