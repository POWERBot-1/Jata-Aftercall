# Control console and motion audit — 2026-10-31

Scope: source inspection at starting PR #77 SHA `c41b939974ca4f4cfcfdf0d130564fba60592783`. This is not a release, production or universal-inheritance verification. The authoritative owner instruction register is `docs/ADMIN_BUILDING_INSTRUCTIONS.md`.

## Control console

- No `app/control` route was found. Existing `app/admin/layout.tsx` gates the existing admin interface with the current `ADMIN` session role. The Prisma `Role` enum has `CUSTOMER` and `ADMIN`, not the requested six scoped roles. Existing `/admin` is infrastructure to assess, not a distinct `/control` authorization boundary. MFA, scoped roles, immutable administrative audit and all requested console modules are **not demonstrated** by this inspection.
- Vercel read-only project-domain inspection lists `jataaftercall.co.ke`, `www.jataaftercall.co.ke` and `jata-aftercall.vercel.app` on the project as verified. The apex configuration endpoint reports `misconfigured=false`. This does not establish actual HTTPS routing, canonical redirects, cookies or authorized/unauthorized `/control` behavior. Those remain **NOT TESTED**; no DNS, domain, credentials or production setting was changed.
- The session branch is fixed to `arena/dab4ca6e-jata-aftercall`, and PR #77 is already open and draft. A separate requested branch/PR cannot be created in this session. Preserve the existing PR and avoid overwriting separate open work.

## Motion and Website Studio

- Existing dependency: `motion` (`^14.1.0`). Existing scoped storefront runtime: `lib/experience/motionRuntime.ts`, `motionPolicy.ts`, `motionRecipes.ts`, `renderMode.ts`, `components/storefront/RenderModeProbe.tsx` and `MotionReveal.tsx`. It loads `motion/mini` lazily, scopes selectors, has cleanup and respects reduced motion, data-saving and resource conditions. These are source observations, not a new performance or accessibility test.
- Existing `ExperienceSite` includes a `RenderModeProbe`; family compositions use `MotionReveal` where the selected treatment permits motion. `app/b/[slug]/page.tsx` includes an `ExperienceSite` rendering path; `lib/experience/workspace.ts` distinguishes draft and published documents. The application also has non-ExperienceSite paths: do not assume all generated or existing business pages flow through this runtime.
- `lib/experience/templateFamilies.ts` defines 20 family keys: cinematic, editorial, luxury, minimal, magazine, marketplace, product-first, storytelling, spatial, interactive-showroom, gallery, split-screen, fullscreen-media, scrollytelling, cardless-immersive, map-driven, catalog, portfolio, service-journey and experimental. Some intentional configurations disable motion; preserve the existing Lite/no-JavaScript fallback and the owner's reduced-motion requirement.
- Open PRs #41 and #42 concern Website Studio and motion. Their changes were not copied, overwritten or merged. Review their exact overlap before adding a second engine. Existing owner intent demands automatic inheritance but does not authorize a schema migration or production republishing for motion.
- **NOT TESTED:** before/after browser baselines, every template family, full preview/publish and legacy paths, per-site setting behavior, tenant isolation, interaction states, reduced motion, layout/visual preservation and performance on the final candidate. No new motion was implemented in this audit.

## Next safe steps

1. Finish a source-to-test inventory of every renderer, preview and publish path; establish actual browser baselines before motion changes.
2. Design `/control` role provisioning and MFA/session boundary against existing identity and migrations; do not treat the current `ADMIN` role as the requested six-role security model.
3. Continue PR #77's connected agent, financial sandbox, reporting, recovery and responsive evidence blockers in `docs/agents/RELEASE_GATE_AND_RUNBOOK.md` independently of policy activation. Keep real operations default off.
4. For every subsequent owner instruction append a new numbered register section; review conflicts rather than silently editing or replacing previous decisions.
