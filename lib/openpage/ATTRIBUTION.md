# OpenPage attribution

The schema layer in this directory is adapted from **OpenPage**, an MIT-licensed
open-source website builder:

- Upstream repository: <https://github.com/buildingopen/openpage>
- Upstream commit inspected: `9818eb4` ("Improve UX intuitiveness for first-time users")
- Upstream license: MIT (see `LICENSE` in this directory)
- Copyright: the OpenPage contributors

## What was imported

Only the runtime-independent, JSON-first parts of OpenPage were imported. They were
adapted for Next.js 16 / React 18 and for JATA's server/client boundaries:

| Upstream file | JATA file | Adaptation |
|---|---|---|
| `src/blocks/types.ts` | `lib/openpage/types.ts` | Import paths only |
| `src/lib/block-metadata.ts` | `lib/openpage/blockMetadata.ts` | Import paths only |
| `src/lib/theme-presets.ts` | `lib/openpage/themePresets.ts` | Import paths only; no CSS side effects |
| `src/lib/generation-prompt.ts` | `lib/openpage/generationPrompt.ts` | Product name and safety rules adapted |
| `src/lib/generate-site.ts` | `lib/openpage/siteConfig.ts` | Deterministic IDs, strict per-block property sanitising, no browser storage, no direct AI calls |
| `src/lib/templates.ts` | `lib/openpage/layoutPlans.ts` | Only the structural block sequence is retained; upstream sample copy/testimonials/stats are deliberately not imported |
| `src/store/configStore.ts` | `lib/openpage/layoutVariants.ts` + studio reducer | Undo/redo semantics retained, state moved to React so no new Zustand dependency is introduced |
| `api/generate.ts` | `app/api/studio/openpage/*` | Uses JATA's approved server-side AI provider and tenant guards; no client API keys |

## What was deliberately NOT imported

- OpenPage's Vite app shell, React Router routes, Vercel function wrapper and dashboard.
- OpenPage's Gemini key stored in `localStorage` (`openpage-gemini-key`). JATA never
  accepts an AI key from the browser. Generation runs through `lib/ai/registry.ts`.
- OpenPage's Tailwind/theming runtime. JATA's approved storefront renderer remains the
  only production renderer; OpenPage blocks are adapted into JATA Experience sections.
- Upstream sample content (testimonials, statistics, team members, prices). It is
  invented content and must never be presented as a real business's facts.

The upstream MIT license is retained verbatim at `lib/openpage/LICENSE`.
