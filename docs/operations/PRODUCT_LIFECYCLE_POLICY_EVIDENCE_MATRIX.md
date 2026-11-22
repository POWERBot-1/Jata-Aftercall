# Lifecycle product policy evidence matrix

**Status:** SOURCE EVIDENCE ONLY — NOT OWNER-APPROVED POLICY  
**Reviewed branch:** `arena/lifecycle-producer-contract-20261122`  
**Reviewed revision before this document:** `a4278f6345538571d4f4afdb55e0311da40dd4c4`

This matrix records current application-code behaviour to support owner review. Existing entitlement behaviour is not automatically a safe lifecycle-producer policy. The observer must not call mutating entitlement synchronisation functions.

## 1. Product-by-product evidence

| Product | Current source-code behaviour | Observer/producers must not assume |
|---|---|---|
| Business Page | Shared `Subscription`; `MONTHLY` and `ANNUAL` are billing plan keys. | That a particular transition key, cancellation treatment or grace duration is owner-approved for automated expiry work. |
| Website Studio | Shared `Subscription`, plan key `INTERACTIVE_BUSINESS`. Reader checks team-free access before subscription lookup. Cancellation is checked after payment/subscription-active gate. Grace boundary is stored `graceUntil` or `expiresAt`. | That subscription-only expiry means effective access is lost; team-free may grant access without a paid subscription. Do not call `syncInteractiveEntitlement` from a read-only producer. |
| AI Front Desk | Shared `Subscription`, four explicit tier keys. A subscription on another product denies AI even if an old AI entitlement remains. Suspended and cancelled states deny access. A verified PAID payment or active billing status participates in the decision. Grace is stored `graceUntil`, otherwise `expiresAt`; no fallback duration is calculated in the pure evaluator. | That a generic paid Payment row alone identifies AI Front Desk, or that payment state can replace the product plan key. |
| Business POS | Dedicated `PosSubscription`. Cancellation is checked first and wins. Active billing states are ACTIVE/EXPIRING/PAST_DUE. Effective boundary is stored `graceUntil` or `expiresAt`. A status beyond that boundary is expired. | That missing `graceUntil` creates a grace period. Current decision function falls back to `expiresAt`. Payment/configuration/publication also affect entitlement, but should not be pulled into an expiry query without a specific approved reason. |
| Autopilot | Dedicated `AutopilotSubscription`. SUSPENDED and EXPIRED are terminal denials. If stored `graceUntil` is absent and `expiresAt` exists, the pure evaluator calculates `expiresAt + AUTOPILOT_GRACE_DAYS` (3 days). CANCELLED is treated as ended when expiry has passed; before then the remaining time is still evaluated. | That cancellation is immediately terminal, or that a generic observer may omit the three-day fallback. Do not use a synchronising entitlement reader in a read-only producer. |
| MJENGO OS | Dedicated `MjengoSubscription`. CANCELLED wins first; SUSPENDED is denied; active states are ACTIVE/EXPIRING/PAST_DUE. Effective boundary is stored `graceUntil` or `expiresAt`. The settlement path writes grace as expiry plus `MJENGO_GRACE_DAYS` (3 days). The entitlement reader also checks matching PAID payment evidence and entitlement status. | That a missing stored grace value should be synthesized by the observer without policy approval, or that payment rows are the authoritative expiry source. Avoid `syncMjengoEntitlement`, which writes. |
| ERP PRO | Dedicated `ErpProSubscription` / `ErpProEntitlement` are the current model family. The inspected access path calls `syncErpEntitlement`, which is not a safe read-only producer dependency. | That calling the normal access helper is read-only, or that historical `ErpSubscription` rows are active ERP PRO source rows. |

## 2. Evidence-level distinctions

1. **Stored grace versus calculated grace:** POS, Website Studio, AI Front Desk and MJENGO evaluators use stored grace when present and otherwise fall back to expiry. Autopilot explicitly calculates a three-day fallback when stored grace is absent. These are materially different rules.
2. **Cancellation is not uniform:** POS and MJENGO check cancellation before other entitlement branches. Website Studio and AI Front Desk check payment/subscription validity before cancellation. Autopilot cancellation is time-dependent relative to expiry.
3. **Payment is corroborating, not a universal expiry source:** MJENGO and AI Front Desk consult payment evidence as part of entitlement decisions. Product identity still comes from the authoritative product subscription/plan discriminator. A generic paid payment cannot safely classify a product lifecycle.
4. **Team-free is a separate access path:** Website Studio explicitly returns a synthetic entitlement for team-free businesses before querying paid subscription. Other product readers also have team-free access logic; each product's precedence must be individually verified before a lifecycle producer makes access-related claims.
5. **Entitlement readers may write:** Website Studio exposes `syncInteractiveEntitlement`; MJENGO exposes `syncMjengoEntitlement`; ERP access imports and invokes `syncErpEntitlement`. A read-only producer must use explicit minimal Prisma projections rather than these synchronisation paths.

## 3. Required owner decisions

The code observations above do not resolve these decisions. Record explicit approvals before changing producer behaviour:

- Whether the lifecycle observer reports subscription state only, or effective product entitlement state.
- Per-product treatment of cancellation before expiry and after expiry.
- Per-product precedence for SUSPENDED, CANCELLED, REFUNDED, PENDING, PAID and historical entitlement rows.
- Whether missing grace uses stored expiry only, an approved fallback, or manual review for each product.
- Whether invalid/inverted timestamps are excluded, counted as manual review, or treated under another explicit policy.
- Whether team-free businesses are excluded from subscription inventory counts, counted separately, or represented in a distinct non-billing category.
- Whether payment corroboration is necessary for a given product's observer classification, and the exact minimal evidence allowed.
- Exact transition vocabulary, source-version fencing and stale-snapshot handling.

## 4. Acceptance-test implications

Tests must assert existing code behaviour and separately assert the future approved producer policy. Do not make the producer policy silently inherit every current reader quirk.

Required fixtures include:
- Autopilot null grace with expiry and exact three-day boundary.
- POS cancellation with an otherwise active subscription.
- Website Studio team-free access with no paid subscription.
- AI Front Desk subscription on a non-AI plan with a stale active AI entitlement.
- MJENGO suspended subscription where payment is refunded/not PAID.
- Each product with stored grace, no grace, inverted grace, null expiry and boundary-equal timestamps.
- ERP PRO source rows from dedicated tables and preserved legacy ERP tables.

## 5. Gate status

- **PASS:** current-code distinctions above are documented from the named source readers and settlement paths.
- **BLOCKED:** owner approval of the producer policy and transition vocabulary.
- **NOT TESTED:** disposable PostgreSQL source inventory, cross-product policy parity, pagination consistency, tenant isolation and replay.
- **PROHIBITED:** production enqueue, worker/scheduler activation, subscription/entitlement/payment/access mutation, provider calls, migration, deployment or merge.

No application code, database, production configuration or runtime state was changed by this evidence matrix.
