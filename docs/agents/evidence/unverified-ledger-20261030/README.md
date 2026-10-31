# Synthetic unverified-ledger display evidence

These six full-page screenshots were captured in Chromium at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768. Each was individually inspected for text, layout and horizontal clipping. The unusually large number is fictional and tests exact formatting/wrapping; it is not a real payment, commission or earnings claim.

A synthetic signed-in account and technically ACTIVE application were created in a disposable loopback PostgreSQL 18.6 database using a test-only Prisma WASM/pg harness. The summary HTTP response was intercepted and replaced with a synthetic fixture; it was not a real ledger or Paystack result. The browser check also exercised failed/malformed responses and a suspended application. Fixture accounts were removed after the test. No provider was contacted.

This is evidence for this one default-off display only, not the full agent journey, provider integration, live data, verified earnings, payout readiness, all modal states or complete accessibility acceptance.
