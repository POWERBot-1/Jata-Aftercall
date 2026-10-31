# Fintech and motion acceptance

**Baseline:** `044ca8a948cdc058a2b992a4e9a7d405d3b2c3c3`. **Verdict: NOT READY / NOT TESTED for complete acceptance.** This audit did not execute a real/sandbox provider transaction or a full browser motion matrix.

## Financial integrity

### Source-level evidence

- Pricing configuration in `lib/pricing.ts` includes monthly KES 149/30 days; annual KES 999/365 days; AI Business Front Desk KES 499/30 days; Website Studio KES 999/30 days; POS KES 499/30 days; Autopilot tiers KES 2,499, 6,999 and 19,999. Static source values match the named baseline; authoritative production catalogue/availability was not queried.
- Paystack helpers and routes provide server-side initialization, verification and webhook signature handling; verification, payment, subscription and webhook tests exist. No credentials were read, payment initialized, webhook submitted, payment made or entitlement activated.
- POS/report test modules include bounded totals, refunds, settled-payment/report behavior, snapshots, money/time-zone and offline queue/sync coverage. No native database/actual UI financial ledger comparison was executed during this turn.
- Existing docs under `docs/agents/RELEASE_GATE_AND_RUNBOOK.md` explicitly call out missing complete sale attribution/accrual/reversal/reconciliation as release-critical for its agent financial programme. That record must not be mistaken for an independent audit of every general subscription/POS flow.

### Acceptance matrix

| Requirement | Verdict | Evidence / blocker |
|---|---|---|
| Plan pricing source/config | PASS (source only) | `lib/pricing.ts`; tests in pricing/catalogue families. Production database plan rows unavailable without production DB access (prohibited). |
| Paystack amount/reference/currency/verification | NOT TESTED | Helper, route and security tests exist; no sandbox mock lifecycle run here. |
| Webhook HMAC and idempotency | NOT TESTED | Signature/idempotency test files exist; no current-run duplicate/out-of-order integration trace. |
| Subscription activation only after verified settlement | NOT TESTED end-to-end | Source/tests available, but no provider-to-entitlement journey performed. |
| Refund/reversal effect on revenue | NOT TESTED end-to-end | Targeted POS/payment tests exist; ledger and UI reconciliation not executed. |
| Empty settled ledger and legacy tender cases | NOT TESTED this turn | Named report/ledger tests exist; results on current SHA not yet run. |
| POS sales, tender, stock and report totals reconcile | NOT TESTED | Requires disposable DB and synthetic sales/refunds, then independent report comparison. |
| Offline sales do not disappear/duplicate | NOT TESTED in browser | Queue/sync unit tests and PR #63 history exist; no real offline/reconnect journey. |
| Payment retries/duplicate submit | NOT TESTED | No browser/network fault injection on this candidate. |
| Real-money / customer communication safety | PASS (boundary observed) | This audit made no payment, provider call or outbound notification. |

No values are inferred from an empty or unverified ledger. Currency values remain KES in code configuration; rounding and display were not visually verified in actual browser reports.

## Motion / responsive acceptance

PR #72 is merged and the repository includes design tokens, motion primitives, reduced-motion logic and motion test/evidence scripts. Existing `docs/agents/CONTROL_AND_MOTION_AUDIT.md` warns that many non-storefront routes do not share the same motion renderer and identifies broad acceptance gaps. GitHub PR #76 head `b76428b83fe896376f39850f5ac9fa42ad4c8b69` has a passing real-Chrome six-viewport screenshot job ([run 41243203509](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41243203509)); this is predecessor PR-head evidence, not a test of the current post-fix worktree/merge SHA. The local repository also contains six `landing-*.png` browser captures; their README scopes them to a public agent-programme informational page and signed-out paths. The 320px artifact visibly clips the last navigation label, and the desktop image is not clipped. Download of the PR artifact bundle failed because its GitHub artifact-storage hostname is outside the sandbox’s permitted egress hosts. The current candidate code SHA `0cd537d` later passed its own real-Chrome six-viewport capture and motion-capture workflows ([run 41246941290](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941290), [run 41246941314](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941314)). The capture artifacts could not be downloaded for pixel review, so no after-fix pixels or complete traces were visually reviewed.

| Area | Verdict | Scope evidence / missing test |
|---|---|---|
| `prefers-reduced-motion` logic | PASS (source/test presence only) | Motion policy and unit/browser scripts exist; not run here on current candidate. |
| Universal navigation/buttons/forms/modals/loading/empty states | NOT TESTED | No route-by-route rendered motion inventory or click-through recording. |
| POS, Studio, AI, Autopilot and admin motion | NOT TESTED | Existing scoped components do not prove universal inheritance. |
| Required viewports: 320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768 | CAPTURE WORKFLOW PASS; visual review pending | CI capture on candidate code SHA `0cd537d` passed; artifact pixels could not be downloaded. |
| Reduced motion visual behavior / no misleading amount animation | NOT TESTED | Need browser emulation and inspect all monetary statuses/states. |
| Accessibility: keyboard, focus, semantic labels, contrast, screen reader | NOT TESTED | No current-turn axe/keyboard run. |
| Performance / layout shift / smoothness | NOT TESTED | No browser metrics/recording inspected. |

No motion-system changes were made; this audit did correct the mobile marketing-nav sizing defect documented in `REMEDIATION_REGISTER.md`. No screenshot or recording was fabricated. Candidate CI capture workflows passed on code SHA `0cd537d`; inspect the generated artifacts when accessible, then complete reduced-motion + keyboard/A11y traces and broader route-by-route motion acceptance.