# 03 — LICENCE AND COMMERCIAL-USE REGISTER

**Rule:** an SPDX string in a README is not evidence. Every entry below was verified against the licence **text** on 2026-11-22. Where GitHub returns `NOASSERTION`, the licence file was opened and read — that flag marks custom or mixed licences, which is exactly where commercial projects get burned.

---

## 1. JATA's own current dependency tree

Scanned all 554 installed packages by reading each `package.json` `license` field.

| Licence | Packages | Commercial use in a multi-tenant SaaS | Obligations |
|---|---:|---|---|
| MIT | 430 | ✅ | Notice in distributions |
| Apache-2.0 | 60 | ✅ | Notice + NOTICE file + state changes; patent grant |
| ISC | 36 | ✅ | Notice |
| BSD-2-Clause | 9 | ✅ | Notice |
| BSD-3-Clause | 5 | ✅ | Notice + no endorsement |
| MPL-2.0 | 4 | ✅ | File-level copyleft only — **modified MPL files must be published** |
| MIT-0 | 2 | ✅ | None |
| LGPL-3.0-or-later | 2 + 1 composite | ⚠️ | Dynamic linking only; no static relink obligation if unmodified |
| Python-2.0, CC-BY-4.0, CC0-1.0, 0BSD, MIT-AND-ISC | 5 | ✅ | Attribution for CC-BY-4.0 |

### Items requiring a written position

| Package | Licence | Assessment |
|---|---|---|
| `@img/sharp-libvips-linux-x64` (×2) | LGPL-3.0-or-later | **Use as a dynamically-loaded library only.** JATA uses `sharp` transitively (Next.js image optimisation) and does not modify it. Under LGPL-3, unmodified shared-library use is permitted in a proprietary application. **Do not vendor, patch or statically link libvips.** Recorded as a standing engineering rule. |
| `lightningcss` (×3) | MPL-2.0 | MPL is file-scoped copyleft. Unmodified use imposes no publication duty. **Do not fork/patch it in-tree.** |
| `axe-core` | MPL-2.0 | Dev/test only (accessibility). Not shipped. No obligation. |
| `caniuse-lite` | CC-BY-4.0 | Browser data. Attribution required in notices. **CC-BY-4.0 is not a software licence** — but here it is data, so it is fine, provided attribution is retained. |
| `victory-vendor` | MIT AND ISC | Both permissive; composite satisfied by retaining both notices. |

**Verdict: the existing tree is commercially clean.** No GPL, AGPL, SSPL, BUSL, Commons-Clause or non-commercial licence is present. One standing rule is created (no static linking of LGPL `libvips`) and one notice obligation (CC-BY-4.0 data attribution).

---

## 2. Candidate acquisition register — verified licence texts

### 2.1 Hard rejections: licence text forbids this business model

**Dify** (`langgenius/dify`) — GitHub reports `NOASSERTION`; licence file read in full:

> "Dify is licensed under **a modified version of the Apache License 2.0**, with the following additional conditions: … **a. Multi-tenant service: Unless explicitly authorized by Dify in writing, you may not use the Dify source code to operate a multi-tenant environment.** … b. LOGO and copyright information: … you may not remove or modify the LOGO or copyright information … **The interactive design of this product is protected by appearance patent.**"

Governing clause: **prohibits the exact deployment model JATA uses.** There is also an appearance-patent reservation. **BLOCKED — do not depend on, fork, or vendor.** Written permission would have to be negotiated; that is a recurring commercial negotiation, which the directive excludes.

**n8n** (`n8n-io/n8n`) — `NOASSERTION`; licence read in full:

> "**Sustainable Use License** … You may use or modify the software **only for your own internal business purposes or for non-commercial or personal use.** You may distribute the software or provide it to others only if you do so **free of charge for non-commercial purposes.**"
> "Source code files that contain `.ee.` in their filename … are NOT licensed under the Sustainable Use License."
> "**Content of branches other than the main branch (i.e. `master`) are not licensed.**"

Governing clause: the Sustainable Use Licence grants **source rights only for internal or non-commercial use**. JATA sells seats. **BLOCKED.** The "non-main branches are not licensed" clause is also a provenance trap for anyone who forks a feature branch.

**open-webui** (`open-webui/open-webui`) — `NOASSERTION`; licence read in full:

> Clause 4: "licensees are strictly prohibited from altering, removing, obscuring, or replacing any 'Open WebUI' branding … except (i) deployments … where the total number of end users … does not exceed **fifty (50)** … (ii) prior written permission … or (iii) a duly executed enterprise license."

Governing clause: **>50 users requires the vendor's branding or an enterprise licence.** **BLOCKED** for a rebranded SaaS.

**Flowise** (`FlowiseAI/Flowise`) — `NOASSERTION`; licence read in full:

> "All content that resides under `packages/server/src/enterprise` … and files with explicit copyright notice … are licensed under **Commercial License**."

Governing clause: split licence; the commercially interesting tree is not free. **BLOCKED as a dependency.**

**Weaviate** (`weaviate/weaviate`) — `NOASSERTION`; licence read in full:

> "Within the `wl` directory … source code is Copyright Weaviate BV, all rights reserved, and is only available under a separate enterprise license… **The BSD license does not grant the right to use these features or circumvent any license key.**"

Governing clause: licence-key-gated feature set. **BLOCKED.**

### 2.2 Hard rejections: model weights are non-commercial

| Model | Weight licence | Evidence |
|---|---|---|
| **Coqui XTTS-v2** | **Coqui Public Model License — non-commercial**, covering model *and its audio outputs*; explicitly bars using it to bootstrap a commercial model | Code is MPL-2.0 (decoy). **Coqui Inc. shut down Jan 2024** → no commercial licence can be bought, so the non-commercial term is final. |
| **F5-TTS official checkpoints** | **CC-BY-NC-4.0** | Code MIT (decoy); weights are NonCommercial because of the Emilia training data. |

Both are **BLOCKED for production**. Non-commercial weights may only ever be used for internal evaluation, and even that should be avoided so no evaluation artefact ends up in a shipped pipeline.

### 2.3 Conditional: usable, with obligations that must be documented

| Item | Licence | Obligation JATA must honour | Decision |
|---|---|---|---|
| **Llama 3.3** | Llama 3.3 Community Licence | (a) 700M MAU threshold — irrelevant now, **counted across affiliates**; (b) display "Built with Llama"; (c) **a distributed model created or improved with Llama materials or outputs must have a name beginning with "Llama"**; (d) Meta AUP binds downstream; (e) multimodal/Llama-4 has an **EU domicile exclusion** | **Avoid.** The naming rule contaminates product naming for a small capability gain. |
| **Gemma 3 and earlier** | Gemma Terms of Use (custom; last modified 2026-04-01) | Must include Google's **Prohibited Use Policy as an enforceable provision in any agreement** downstream, and it reaches derivatives. Google "claims no rights in Outputs". | **Avoid.** Passing a third party's use policy into JATA's own customer terms is a contract-cleanliness problem. |
| **Piper** | MIT (`rhasspy/piper`, **archived 2025-10-06**) → successor `OHF-Voice/piper1-gpl` is **GPL-3.0-or-later** | Old MIT repo is frozen; maintained line is GPL-3. Also: per-voice model licences vary and "the project grants none". | **Avoid for embedding.** GPL-3 is the wrong licence for a distributed/on-prem component. |
| **Chatterbox** | MIT (code **and** weights) | **Retired as of Aug 2026** — no upstream fixes. Built-in watermark must not be stripped. | **Usable.** Vendor a pinned snapshot; do not strip the watermark. |
| **Mozilla Common Voice** | **CC0 1.0** for the data | Download terms **separately forbid re-hosting the dataset and forbid attempts to identify speakers.** | **Usable for training**, not for redistribution. Recorded as a process rule. |
| **FLEURS** | CC-BY-4.0 | Attribution required | Usable for evaluation. |
| **CC-BY-4.0 in code form** (`microsoft/autogen`) | CC-BY-4.0 | No patent grant; content-licence attribution mechanics | **Avoid as a software dependency.** Wrong licence class. |

### 2.4 Clean adoptions

| Item | Licence (verified text) | Why it is safe |
|---|---|---|
| `pgvector/pgvector` | **PostgreSQL Licence** — "Permission to use, copy, modify, and distribute this software and its documentation **for any purpose, without fee**…" | Permissive, fee-free, no copyleft trigger. |
| `hexgrad/Kokoro-82M` | **Apache-2.0** (weights and code) | Commercial use, modification and closed-source embedding permitted with notice. |
| `openai/whisper` | MIT | Permissive. |
| `SYSTRAN/faster-whisper` | MIT | Permissive. |
| `snakers4/silero-vad` | MIT | Permissive. |
| `k2-fsa/sherpa-onnx` | Apache-2.0 | Permissive + patent grant. |
| `BAAI/bge-m3` | MIT | Permissive. |
| Qwen3 dense | Apache-2.0 | Permissive + explicit patent grant. |
| `langchain-ai/langgraph` | MIT | Clean, but architecturally redundant (see `02` §2). |
| `qdrant/qdrant`, `lancedb/lancedb`, `chroma-core/chroma` | Apache-2.0 | Clean, but unnecessary given `pgvector`. |
| `vllm-project/vllm`, `ggml-org/llama.cpp` | Apache-2.0 / MIT | Clean for a future self-host tier. |

---

## 3. The licence facts that most often go wrong

Recorded because they are the failure modes this register exists to prevent.

1. **Code licence ≠ weight licence.** XTTS-v2 (MPL-2.0 code / non-commercial weights), F5-TTS (MIT / CC-BY-NC-4.0), Piper (MIT repo / GPL-3 successor / unspecified per-voice). Always check the weights and, for Piper, each voice pack.
2. **`NOASSERTION` on GitHub is a warning, not a formality.** Four of the seven rejections here carried it.
3. **Apache-2.0 can be "modified".** Dify's is. A modified Apache-2.0 that adds a multi-tenant prohibition is not Apache-2.0-compatible, and the modification governs.
4. **Non-main branches can be unlicensed** (n8n states this explicitly). Fork from tagged releases only.
5. **Dataset CC0 does not override download terms** (Common Voice). Train yes, re-host no, de-anonymise no.
6. **A hosted service is "distribution" for some licences.** Llama's naming/attribution and Gemma's policy passthrough attach to products made available to others, not just to binaries shipped.
7. **LGPL/LGPL-3 requires a linking discipline**, not just a notice. Recorded as a standing rule for `libvips`.
8. **Retired ≠ unlicensed.** Chatterbox is MIT and commercially usable with no upstream support. Kokoro's maintainers warn that similarly-named sites are scam mirrors — **download weights only from the canonical org**.

---

## 4. Register summary

| Status | Count | Items |
|---|---:|---|
| **ADOPT (clean, no fee, no copyleft trigger)** | 12 | pgvector, Kokoro, faster-whisper, whisper, silero-vad, sherpa-onnx, bge-m3, Qwen3 dense, Mistral Small, gpt-oss, FLEURS, Common Voice (training only) |
| **CONDITIONAL (usable with recorded obligations)** | 3 | Chatterbox (retired, keep watermark), Common Voice (no re-host), Qwen3-Embedding |
| **AVOID BY DEFAULT (commercially allowed, obligations disproportionate)** | 4 | Llama 3.3, Gemma 3, Piper-GPL3, autogen (CC-BY-4.0) |
| **BLOCKED — licence prohibits this use** | 10 | Dify, n8n, open-webui, Flowise, Weaviate, XTTS-v2, F5-TTS, MiniMax, RVC voice-conversion, ChatTTS (unverifiable) |
| **Existing tree requiring a standing rule** | 2 | `@img/sharp-libvips` (LGPL-3 → dynamic only), `lightningcss`/`axe-core` (MPL → unmodified only) |

**Recurring software licence fees introduced by this plan: KES 0.**

---

## 5. Enforcement: licence tests to add (design)

Instruction 12 requires licence acceptance tests. These can be implemented with **zero product risk** because they touch nothing at runtime.

| Test | Idea | Runs |
|---|---|---|
| `licence-tree-policy` | Walk `node_modules`, fail if any SPDX is outside the allowlist, or is in the LGPL/MPL deny-static list, or is a modified-Apache/custom licence | CI, offline |
| `licence-notice-completeness` | Every non-MIT/ISC/BSD dependency must appear in a generated `THIRD_PARTY_NOTICES` file | CI, offline |
| `openpage-attribution-intact` | `lib/openpage/LICENSE` text unchanged and `ATTRIBUTION.md` upstream commit still recorded | CI, offline |
| `model-weight-manifest` | Every adopted weight file has a pinned source URL, SHA-256 and an `Apache-2.0 | MIT` licence record | CI, offline |
| `no-blocked-dependency` | Assert no `dify`, `n8n`, `open-webui`, `flowise`, `weaviate`, `xtts`, `f5-tts` appears in `package.json` or a lockfile | CI, offline |

The first is fully implementable now (the scanner already exists as an ad-hoc command — see §1 method). The rest are listed in `10_IMPLEMENTATION_ROADMAP.md` Phase L.
