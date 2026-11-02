# MJENGO OS: preliminary source audit and delivery gate

This is **not a complete audit or an implementation**. Do not release MJENGO OS on the strength of this document. Source references below refer to TAWA at `b86b70a5b46654159e6afb823dedc5f55186ba8f`; line numbers do not refer to JATA AFTERCALL files. Findings describe the reference implementation, not necessarily the destination application's behavior.

## Provenance

- TAWA `arena/019ffaa6-tawa` resolved to the requested commit via `git ls-remote`; GitHub commit API confirmed the object.
- Destination `main` resolved to `19f11d9ecd8daad1db2aaf35cc1166425f871acc`. The session branch initially pointed at `77e35cec6a5726f569ab3febd3e7766300b14890`. After unshallowing, `git merge-base --is-ancestor` confirmed it was an ancestor of main; the session branch was fast-forwarded to that main commit before this documentation change.
- TAWA tracks 106 files, including a release tarball. A mechanical inventory of 201 route declarations appears in `MJENGO_TAWA_ROUTE_INVENTORY.md`; it is **not** the requested route-to-module-to-database-to-test coverage matrix. Comprehensive inspection of all files and capabilities remains outstanding.

## Findings

| Severity | Evidence | Consequence and reproduction |
|---|---|---|
| P0 | `server/core/auth.js:98-102,119,158-163` | A cookie wins token selection, but `viaCookie` is false if *any* Bearer header is present. Given a valid session cookie and an arbitrary `Authorization: Bearer x`, a mutation is authenticated with the cookie while `enforceCsrf` skips validation. Static code-path analysis; end-to-end exploit not executed. |
| P0 | `server/core/auth.js:88-90` | `X-Forwarded-For` is accepted without validating the immediate peer against trusted proxies. A direct client can supply an arbitrary first address. Static analysis; rate-limit impact not tested. |
| P0 | `server/modules/ledger.js:58-74` | The journal is balanced before each line is rounded and does not reject fractional minor units. Reproduction using Node 22: debit lines 0.4 and 0.4 and credit line 0.8 pass the balance comparison, but stored rounded totals are 0 and 1. This demonstrates the calculation, not a database integration test. |
| P0 | `server/modules/ledger.js:160-169` | Date conditions are on a LEFT JOIN to entries, but the sums use lines regardless of whether an entry matches. SQLite reproduction: one debit of 100 dated 2024-01-01 with a from date of 2025-01-01 returns 100 instead of 0. P&L calls this report at lines 175-176. |
| P0 | `server/modules/payments.js:172-184` | Credit repayment reduces an aggregate balance, and when zero marks one outstanding order fully paid without allocation. The update of credit accounts filters by customer ID, not tenant ID. Static analysis; schema constraints and exploitability across tenants require further verification. |
| P0 | `server/modules/payments.js:42-46` | An existing idempotency key returns the existing intent without checking that the new request payload matches. Static analysis; concurrent behavior not tested. |
| P0 | `server/adapters/payments.js:45-49,89-91,121-123,160-162`; `server/modules/payments.js:299-320` | Refund adapters manufacture success references rather than provide durable independent provider confirmation; payment code may then post a refund. Manual bank confirmation is a human attestation (`server/adapters/payments.js:150-158`), not independent bank verification. This is not suitable for a live payment integration. |
| P1 | `server/routes/files.js:10,13-28,45-66` | Uploaded image bytes are stored as a database BLOB; unknown image signatures yield null dimensions but are not rejected, and SVG uses a denylist rather than a robust sanitization or rejection strategy. Static analysis; no malicious-file exploit was executed. |

## Integration constraints and proposed gates

1. Keep TAWA as a domain reference only; do not import its server, SQLite data, demo seeds, deployment, or browser SPA. Use destination authentication, authorization, durable storage, Prisma/PostgreSQL and Paystack. Review current destination implementations and migrations before choosing models.
2. Keep `BUSINESS_POS` independent. At the verified destination base `lib/pricing.ts:293` specifies KES 499 for 30 days. Add `MJENGO_OS` only with independently checked subscription, workspace and expiry semantics, KES 2,000 per 30 days, and tests for both directions of entitlement isolation. Existing customer entitlements must remain unchanged.
3. Before feature code: complete the source audit and capability/route/data/test matrix, and audit destination prerequisites. Prioritize server-derived tenancy and ownership constraints, transactional financial invariants, webhook/refund reconciliation, and adversarial database tests with an isolated PostgreSQL instance. Do not mark provider simulations as production.
4. Use forward-only migrations; never execute against production for verification. External side effects require a durable outbox and retry/reconciliation design. Human bank confirmations must be identified as attestations. Sensitive generated recommendations require permission and approval before execution.

## Evidence and open work

- PASS: source ref and destination main verified; branch fast-forwarded to main.
- PASS: two isolated calculation/query reproductions above, with no external database or production data.
- FAIL: reference source defects identified above remain unremediated. None is evidence that the destination is fixed or vulnerable.
- NOT TESTED: complete source tree, frontend/XSS, auth/tenant isolation beyond the noted paths, all financial and operational flows, destination security and existing entitlements, full test suite, build, lint, typecheck, migrations, browser UI and screenshots.
- NOT IMPLEMENTED: MJENGO OS product, subscriptions, workspace, migrations, security remediation, financial infrastructure, business features and adversarial tests.
- BLOCKED for production release: audit and implementation are incomplete; live provider and isolated-database integration evidence is absent. Production readiness: **NO**.
