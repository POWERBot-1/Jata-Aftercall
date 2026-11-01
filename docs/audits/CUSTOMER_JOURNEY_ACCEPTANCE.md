# Customer journey acceptance

**Verdict: NOT FULLY TESTED end-to-end.** Candidate code SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1` has passing GitHub workflows for a disposable-PostgreSQL journey, migrations, full suite and real-Chrome captures. These are meaningful current-candidate evidence but do not represent every plan/product journey below or complete production integrations. No real customer data, money, email or notification was used; production/provider state was not changed.

## Journey matrix

| Journey | Required path | Current evidence | Result / next test |
|---|---|---|---|
| Monthly base plan | Homepage → monthly KES 149 → registration → verified checkout → active entitlement → dashboard → cancel/expire/logout | Pricing source and payment/auth/entitlement tests. No payment or browser. | NOT TESTED; isolated payment mock/test mode required. |
| Annual plan | Homepage → annual KES 999 → registration → checkout → 365-day entitlement → dashboard → renewal/cancel/logout | Pricing source has 365 days; catalogue tests exist. | NOT TESTED; verify exact duration and UI display on synthetic ledger. |
| AI Front Desk | Discover product → buy KES 499/month → configure business → publish → customer asks → grounded answer / failure fallback | AI route/service, entitlement and grounding tests exist. | NOT TESTED; compare answer only with synthetic authoritative business facts; test unpaid/expired direct API denial. |
| Website Studio | Discover → buy KES 999/month → create → choose template/category → durable upload → draft → preview → publish → public mobile page → unpublish | Studio pages, APIs and media tests exist; durable runtime provider configuration not verified. | NOT TESTED; launch gate until durable storage/publish run succeeds without public leakage. |
| Business POS | Discover → KES 499/month → configure catalogue → sale → receipt/payment state → stock decrement → report → refund/return | POS pages/APIs and targeted tests exist, including offline queue and tenant isolation. | NOT TESTED; disposable DB end-to-end and ledger/report reconciliation required. |
| JATA Autopilot | View Standard/Pro/Enterprise pricing → subscribe → configure/consent → Preview Mode → propose → merchant approval → action/audit/kill switch | Pricing/configuration and policy tests exist; PR #77 completeness failure is unrelated but overall release gate failed. | NOT TESTED; verify all sensitive actions require approval and expiry denies access. |
| Failure paths | Declined, pending, wrong amount, invalid signature, duplicate webhook, expired plan, provider timeout, mail unavailable, storage failure | The candidate's failure-control workflow passes; individual business/payment/storage outcomes are not all exercised here. | PARTIAL; complete matrix remains untested on live provider settings. |

## Acceptance steps still needed

1. Use test-only accounts and an isolated disposable PostgreSQL database seeded with synthetic tenants A/B. Capture sign-up, verification, payment callback/webhook and activation without live mail or money.
2. For each product plan, test provider pending/failure/success, incorrect amount/currency/reference, duplicate callback/webhook and expiry; assert server state and visible message agree.
3. Test all paid routes by direct request as unauthenticated, wrong tenant, non-admin, unpaid, expired and revoked-session users.
4. Exercise Studio upload → refresh/relogin → durable object retrieval → publish/unpublish → public page, including invalid MIME/size and provider failure.
5. Exercise POS sale, duplicate retry, offline queued order reconnect, conflict, refund, stock/tender/report reconciliation and tenant isolation.
6. Test logout and session revocation, mobile/desktop viewports, keyboard and reduced-motion.
7. Retain the actual browser trace and screenshots, exact SHA, test command and results. Do not use production API settings.