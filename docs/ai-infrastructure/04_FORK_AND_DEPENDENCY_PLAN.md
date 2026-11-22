# 04 — REPOSITORY FORK AND DEPENDENCY PLAN

**Principle:** fork **little**, depend on **almost nothing**, and keep every upstream artefact in its own directory with its licence and provenance intact — the pattern `lib/openpage/` already establishes.

---

## 1. What gets forked vs. depended on vs. written

| Component | Strategy | Why |
|---|---|---|
| Business Brain | **REUSE existing** | Already correct and tenant-scoped. Forking it would duplicate. |
| Agent framework / tool registry | **REUSE existing** | `lib/ai-tools.ts` already enforces READ/WRITE/HIGH_RISK + role gate. |
| `pgvector` | **DEPEND** (Postgres extension) | Not vendorable code; supplied by the managed Postgres. Enable per-database. |
| Embedding generation | **WRITE** (thin adapter) | ~150 lines over an OpenAI-compatible `/v1/embeddings` contract. No SDK. |
| Retrieval fusion | **WRITE** | Hybrid = existing lexical score (`ai-grounding.ts`) ⊕ vector score. Wrapping both preserves the deterministic path. |
| Model adapter (chat) | **WRITE** (extend existing pattern) | `lib/ai/provider.ts` already defines the contract shape; add a text-completion port mirroring `lib/voice/llm.ts`. |
| Eval harness | **WRITE** | Nothing suitable to fork; the golden sets already exist in `tests/` and `PREVIEW_TEST_QUESTIONS`. |
| Kokoro TTS worker | **FORK (pin + vendor small shim)** | Apache-2.0. Vendor only a pinned model reference + an HTTP/batch shim, not the training repo. |
| faster-whisper STT worker | **DEPEND** (Python wheel) | MIT. Runs in the existing Docker worker pattern, **not** on Vercel. |
| Chatterbox (Kiswahili TTS) | **FORK snapshot, DEFER** | MIT but retired. Vendor a pinned commit; no upstream support. Only if Kokoro's language gap blocks Voice. |
| OpenPage | **Already forked** | Keep as-is; do not re-fork. |
| Qwen3 / Mistral weights | **DEPEND at runtime, DEFER** | Only if a self-host tier is approved. Never bundled in the Next.js app. |

---

## 2. Forbidden dependencies

These must never appear in `package.json` or a lockfile. A CI assertion enforces it (`03` §5).

| Package | Reason |
|---|---|
| `dify`, `dify-ai` | Modified Apache-2.0 forbids multi-tenant operation |
| `n8n`, `n8n-core`, `n8n-workflow` | Sustainable Use Licence: internal/non-commercial only |
| `open-webui` | >50-user branding clause |
| `flowise`, `flowise-components` | Enterprise tree is commercially licensed |
| `weaviate-client` | Mixed BSD / all-rights-reserved (`wl/`) |
| `TTS` (Coqui) + XTTS-v2 weights | Non-commercial weights |
| `f5-tts` + official checkpoints | CC-BY-NC-4.0 weights |
| `piper-tts` (piper1-gpl) | GPL-3.0-or-later |
| `autogen` | CC-BY-4.0 (content licence) |
| `rvc`, `so-vits-svc` | Voice impersonation capability |
| `langchain`, `llama-index`, `crewai` | Not licence-blocked — blocked by **architecture**: duplicate execution models beside a tested one |

---

## 3. Directory plan (new, isolated, nothing existing moves)

```
services/
  jata-ai-gateway/              NEW separately-deployable Node process — the only new runtime
    README.md                   contract + versioning policy
    package.json                deliberately minimal
    src/
      server.ts                 HTTP listener (0.0.0.0, port from env)
      auth/                     HMAC + tenant claim verification
      routes/                   v1/* — versioned
      adapters/                 chat · embed · stt · tts — OpenAI-compatible contract
      policy/                   allow-list, quota, redaction (reuses lib rules by copy, never by import)
    licences/                   verbatim upstream licences (Apache-2.0 from Kokoro etc.)

lib/ai-infra/                   NEW, inside the Next.js app, behind a feature flag
  index.ts                      the ONLY import surface for product code
  client.ts                     typed client for jata-ai-gateway (fetch, retries, timeouts)
  contract.ts                   shared types + CONTRACT_VERSION
  flags.ts                      AI_INFRA_ENABLED (default false ⇒ every call is a no-op)
  retrieval/
    lexical.ts                  thin wrapper over lib/ai-grounding.ts (REUSE, do not reimplement)
    vector.ts                   pgvector query (GATED — needs migration)
    fuse.ts                     reciprocal-rank fusion of lexical + vector
  eval/
    golden/                     frozen fixtures, versioned
    runner.ts                   offline scorer
  audit.ts                      re-exports lib/audit.ts writeAuditEvent — no second audit trail

worker/
  ai-media/                     NEW sibling of voice-media/
    Dockerfile
    README.md

prisma/migrations/              UNTOUCHED until G-1 approval
  (design only, not created)    2026xxxx_ai_infra_pgvector_and_chunks/
```

**Hard rule:** product code (`lib/ai-front-desk.ts`, `lib/autopilot/*`, `lib/pos/*`, …) imports **only** `lib/ai-infra/index.ts`. It never imports an adapter, a vector query or the gateway client directly. That single seam is what makes the whole layer removable by flipping one flag and deleting one directory.

---

## 4. The dormant-by-default flag contract

```ts
// lib/ai-infra/flags.ts
export function aiInfraEnabled(): boolean {
  return process.env.AI_INFRA_ENABLED === "true";
}
```

Behaviour when **false** (which is the default, and the only state authorised without G-3):

- `lib/ai-infra/*` returns the existing deterministic result, unchanged.
- No network call is made.
- No new database read.
- No behaviour difference detectable by a customer or a test.

This is what allows the whole layer to be merged and validated **without** touching a sold product, which is the only way to satisfy instruction 11 while still making progress.

---

## 5. Fork hygiene rules

Adapted from what `lib/openpage/ATTRIBUTION.md` already does correctly.

1. **Pin a commit or tag.** Never "main".
2. **Copy the licence verbatim** into the forked directory.
3. **Write an ATTRIBUTION file** stating upstream URL, pinned commit, what was imported, what was *not* imported, and why.
4. **Record every local modification** in that file as a table.
5. **No upstream branding, sample content or demo data** in the fork — `lib/openpage` explicitly lists the invented testimonials/prices it refused to import, and that is the standard.
6. **Retired upstream = vendor, don't track.** Chatterbox is MIT but retired; pin and own every bug.
7. **Weight files are not code.** They need their own manifest: source URL, SHA-256, licence, and the date checked (`03` §5).

---

## 6. Dependency budget

| New runtime npm dependency | Count |
|---|---:|
| Required to ship Phase 1–3 (docs + dormant layer + eval) | **0** |
| Required to ship Phase 4 retrieval, if G-1 approved | **0** (pgvector is a server extension, not an npm package; `pg` already present) |
| Required to ship Phase 5 speech, if G-4/G-5 approved | **0** in the Next.js app; Python wheels live only inside the Docker worker |
| **Total new npm packages in the Next.js application** | **0** |

The single most valuable architectural property of this plan is that it adds **no dependency surface to the application that serves customers**. All model risk is confined to one optional sidecar process.
