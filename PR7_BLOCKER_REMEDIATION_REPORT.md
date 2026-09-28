# PR #7 Blocking-Finding Remediation Report

**Baseline reviewed:** `e9ab1d02738c27f4648561360381264b334b47b2`
**Base:** `origin/main` at `f23f4df6634109fb4bd1db5d5c5c4376a13472c9`
**Implementation branch:** `arena/01a0e817-jata-aftercall`
**Governance:** targeted remediation only; no merge, production deployment, production data/configuration changes, or real Paystack charge.

The baseline report is preserved separately in `PR7_INDEPENDENT_VERIFICATION.md`. This file records remediation evidence, not a replacement for independent verification.

## A. Four findings addressed

### A — Paystack reference format

- Replaced the `jata_` prefix with `jata-` followed by the complete server-generated UUIDv4 in `lib/paymentReference.ts` and `app/api/checkout/route.ts`.
- UUIDv4 provides 122 bits of random entropy; uniqueness remains backed by the existing unique `Payment.reference` constraint. A pending checkout remains protected by the existing duplicate-pending guard. References are not supplied by the browser.
- Added a server-side allowed-character guard in `initializeTransaction`; exact references continue to be stored, returned, verified, and correlated with webhook payment records. Existing payment rows are not rewritten.
- Re-checked the current [Paystack transaction documentation](https://paystack.com/docs/api/transaction/): permitted reference characters are alphanumeric, hyphen, dot, and equals. The implementation and tests conform. Provider compatibility is documentation-based; no live provider call was made.
- Coverage: `tests/unit/payment-reference.test.ts`, `tests/integration/checkout-route.test.ts`, `tests/integration/payment-verification-route.test.ts`, `tests/integration/paystack-webhook-route.test.ts`, and provider-client tests. Explicit legacy-reference cases confirm unchanged exact lookup/correlation for existing stored records.

### B — Server-authoritative KES

- Added the server constant `PAYMENT_CURRENCY = "KES"`; checkout uses it for the payment record and Paystack initialization. The request body currency is ignored.
- Initialization input is typed and runtime-checked as KES. The provider payload serializes the server-derived subunit amount as a string, as documented, and explicitly includes `currency: "KES"`.
- Verification requires both the stored expectation and provider evidence to be KES. Settlement rejects any non-KES stored payment before state changes. Existing reference, amount, status, HMAC, ownership, idempotency, and transaction controls remain in place.
- Coverage: manipulated client currency in checkout tests, provider-payload assertion, invalid currency rejection, amount/currency evidence mismatch tests, webhook checks, and direct settlement guard tests.

### C — Two product UI themes

- Added **Lime Spark / Graphite** with exact `#B6FF2E` and `#23262F`, and **Emerald Ink / Champagne** with exact `#064E3B` and `#F8E7C9`, in `lib/productThemes.ts`.
- Added centralized semantic CSS-variable maps; selector provides names, concise descriptions, visual swatches, radio selection, accessible labels, and an explicit selected label. Preference is stored in localStorage and survives refresh/navigation/sign-out/sign-in in that browser. The schema has no user theme-preference field; account-level sync was deliberately not added.
- Product styles apply through `ProductThemeProvider` on product routes. `/b/*` is kept outside this scope. Existing public business-page `clean`, `dark`, `warm` options were not renamed or replaced and are regression-tested.
- CSS styles product surfaces, text, links/actions, form controls, selected/disabled/focus/error/status states, dialogs/role=dialog, loading/skeleton hooks, and reduced-motion behavior. Contrast unit tests check text, muted text, links/primary actions, borders, placeholders, disabled text, selected states, focus, and success/warning/error combinations against WCAG contrast thresholds.
- Coverage: `tests/unit/product-themes.test.ts` and existing `tests/unit/themes.test.ts`. Manual browser and assistive-technology review was not available.

### D — Dependency audit and remediation

Baseline `npm audit`: **10 vulnerabilities** (3 moderate, 5 high, 2 critical). Production-only audit: **2 vulnerable package entries**, one critical and one high. Findings included vulnerable Next.js/PostCSS, stale Next ESLint configuration and `glob`, plus Vitest/Vite/esbuild/mocker issues.

Chosen upgrades and rationale:

| Package | Before → after | Decision and compatibility evidence |
|---|---|---|
| `next` | 14.2.15 → 15.5.26 | Security patch in the supported 15.5 maintenance line; App Router remains on React 18.3.1, which is within the package peer range. Updated async `cookies`, `params`, and `searchParams` call sites required by Next 15. |
| `eslint-config-next` | 14.2.15 → 15.5.26 | Aligned to the framework line; existing ESLint 8 is in the config peer range. |
| `postcss` | 8.5.28, with same-version npm override | Forces Next’s previously pinned vulnerable nested 8.4.31 to the patched compatible 8.5 line; production audit cleared. |
| `vitest` | 2.1.9 → 4.1.11 | Fixes critical test-runner and mocker advisories. Full suite passes on the upgraded runner. |
| `vite` | 5.4.21 → 7.3.6 | Compatible Vitest peer; fixes Vite/esbuild advisories. This dev toolchain requires Node `^20.19.0 || >=22.12.0`; that supported engine range is recorded in `package.json`. |

The updated lockfile removes the audited vulnerable versions, including the `glob` command-injection package. The `glob` CLI path was not called by application runtime, but the vulnerable dependency was removed rather than relying on that distinction. Fresh final `npm audit` and `npm audit --omit=dev` both report **0 vulnerabilities**. No `npm audit fix` or force upgrade was used.

The Next 15 upgrade was tested with the existing application and required limited App Router async API updates; no React major upgrade, Prisma upgrade, schema change, or application rewrite was made. A Vercel build/runtime check remains outstanding.

## Test evidence

After `npm ci`:

- `npm test`: **23 files, 172 tests passed**.
- `npm run lint`: passed (Next emits a deprecation notice for `next lint`, no lint warnings/errors).
- `npx tsc --noEmit`: passed.
- `npm run build`: passed with the repository’s offline Prisma fallback; Next 15.5.26 compiled and generated all pages.
- `npm audit`: **0**; `npm audit --omit=dev`: **0**.
- `git diff --check`: passed.

The `npm ci` postinstall and build attempted Prisma engine downloads from `binaries.prisma.sh`; network TLS failed, and the repository’s existing postinstall/build fallback continued. No database URL was present, so the migration gate was skipped. This is not a live PostgreSQL verification.

Existing mocked route/lifecycle coverage was retained for plan-derived pricing, create-business-to-checkout, location save/update/directions, payment verification states, publication privacy, and security/tenant isolation. Static source review of checkout/callback confirms plan and price review, secure-payment action, pending/success/failure/error messages, retry/status-check, and return paths; this was not a rendered browser UX test. No schema migration was required.

## Limits and unchanged policy

- No real Paystack initialization, charge, verification, or webhook delivery was attempted. Reference/currency conformance is verified against current provider documentation and mocked request/evidence tests only.
- No production DB/configuration or production deployment was inspected or changed. The Vercel preview is login-protected; no browser-level UX or production runtime check was possible.
- The pre-existing behavior that a suspended but published business can remain public was left unchanged, as explicitly directed. It is not a regression introduced here.
