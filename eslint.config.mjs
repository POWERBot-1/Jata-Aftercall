import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * ESLint flat config for the ESLint CLI (Next.js 16 removed `next lint`).
 *
 * `eslint-config-next@16` requires eslint >= 9 and exports flat-config arrays, so the previous
 * `.eslintrc.json` (`"extends": "next/core-web-vitals"`) becomes this file.
 *
 * Two deliberate decisions, both recorded in RELEASE_REPORT_2026-10-13.md §N:
 *
 * 1. Coverage parity. `npm run lint` lints `app components lib` — the directories the removed
 *    `next lint` covered — so the migration does not silently change which files gate the build.
 *    `eslint .` additionally covers tests/, scripts/ and prisma/ and surfaces 44 pre-existing
 *    findings there (6 `react/no-children-prop` errors, 5 stale eslint-disable directives, plus
 *    warnings). Widening the gate is a separate, reviewable change, not something to smuggle into
 *    a framework upgrade.
 *
 * 2. New advisory rules stay visible. `eslint-config-next@16` pulls in
 *    `eslint-plugin-react-hooks@7`, which enables React Compiler-era rules that did not exist in
 *    the pre-upgrade config. They flag pre-existing patterns in ratified storefront code — 23 x
 *    `react-hooks/set-state-in-effect`, 3 x `react-hooks/purity`, 3 x `react-hooks/refs` — and
 *    remediating them means changing component behaviour, which is out of scope here and needs its
 *    own review. They are therefore warnings: reported on every run, never hidden, not blocking.
 */
const config = [
  ...nextCoreWebVitals,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", ".cache/**", "out/**", "dist/**", "next-env.d.ts"],
  },
];

export default config;
