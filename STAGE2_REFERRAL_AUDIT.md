# Stage 2 — Self-Service Referral Flow: implementation audit & plan

Date: 2026-09-29
Branch: `arena/01a0ed17-jata-aftercall` (session-fixed dedicated branch; PR target `main`)
Scope: **Stage 2 only.** No JATA Qi, no unrelated AFTERCALL changes, no production database or
configuration mutation.

---

## 1. Protected baseline (Stage 1) — must not change

| Baseline | Location | Stage 2 status |
| --- | --- | --- |
| `PUBLISH_REQUIRES_PAYMENT = true` | `lib/publication.ts` | untouched |
| `canSetPublished()` / `hasVerifiedPublicationRight()` | `lib/publication.ts` | untouched (no referral input is added to the signature) |
| Publish rejected (403) without verified payment | `app/api/business/route.ts` `PATCH` | untouched |
| Paystack verification / webhook HMAC / idempotency | `lib/paystack.ts`, `app/api/paystack/*` | untouched |
| Tenant boundary `guardTenantMutation` / `assertBusinessOwnership` | `lib/tenant.ts` | untouched |
| Public page visibility decision | `publicPageDecision()` | untouched |

Stage 2 adds **no** code path that sets `isPublished`. Referral state is never read by the
publication gate. This is pinned by new tests (`tests/security/referral-payment-boundary.test.ts`,
`tests/security/referral-security.test.ts`) and by the untouched Stage 1 suites
(`tests/unit/publication-gate.test.ts`, `tests/security/publication-access.test.ts`).

---

## 2. Current-state findings (read-only audit of the existing code)

1. **Registration already creates the first business atomically.** `lib/registration.ts`
   `registerOwner()` runs `prisma.$transaction` creating `User` → `Business` → `BusinessMember`
   in one transaction. This is the exact transaction the referral record must join, so
   *referral recording and first-business creation are atomic by construction*.
2. **`registerOwner()` is dependency-injected** (`hashPassword`, `transaction`, `logAudit`,
   `issueSession`, `adminEmails`). Referral behaviour can be added as an injected dependency, so
   the existing 6 regression tests in `tests/integration/registration-lifecycle.test.ts` keep
   passing unmodified (no referral context ⇒ no referral code path executes).
3. **The public business page `/b/[slug]` is the "public business experience"** — it is rendered
   for anonymous visitors and is the natural place for the referral CTA.
4. **Server Components cannot set cookies** in Next 15 (only Route Handlers / Server Actions can),
   so the referral link entry point must be a Route Handler, not a page.
5. **No existing model stores attribution**, so one additive table plus one additive column is the
   minimum required schema change.
6. **No production data backfill is needed** — referral codes are minted lazily on first eligible
   use, so existing `Business` rows do not have to be touched.

---

## 3. Design

### 3.1 Referral mechanism

* Each **business** gets an opaque, unguessable public code: 12 characters from a 32-symbol
  Crockford-like alphabet (`0-9A-HJKMNP-TV-Z`) ≈ 60 bits of entropy, generated with
  `crypto.randomBytes`. The code contains **no** tenant id, email, phone or slug.
* Link form: `{PUBLIC_BASE_URL}/r/<code>` → served by `app/r/[code]/route.ts` (GET, unauthenticated).
* The code is only minted for a business that is **published and not suspended**, so an
  unpublished/suspended business never has a usable referral link.
* The link leaks nothing private: the only referrer data rendered to a recipient is the public
  business **name** (already public on `/b/[slug]`).

### 3.2 Attribution (server-side, first-touch)

1. `GET /r/<code>` (anonymous, no auth):
   * normalises + validates the code → resolves the business/owner **server-side**;
   * re-checks eligibility (exists, published, not suspended, owner present);
   * refuses attribution to an already-signed-in visitor (existing customer, not a new signup);
   * **first-touch-wins**: if the browser already carries a valid, unexpired, unconverted
     attribution token, that token is kept — later links do **not** overwrite it;
   * otherwise writes a `Referral` row with `status = PENDING` and returns an httpOnly,
     `SameSite=Lax`, host-only cookie `jata_referral` holding a 256-bit random token;
     only the **SHA-256 hash** of that token is stored, so a database leak cannot be replayed;
   * `303` redirect to `/register?ref=<code>` (the `ref` param is display-only and is
     re-validated server-side before it is ever used).
2. `/register` (server component) resolves the referrer from `ref` for a friendly banner and
   passes the code to the form, which submits it alongside the cookie.
3. `POST /api/auth/register` reads **both** the cookie token and the submitted code, resolves the
   attribution **from the database**, re-validates the referrer server-side, and then — inside the
   existing registration transaction — updates the `Referral` row to `CONVERTED` with
   `referredUserId` (the new user) and `referredBusinessId` (the business created in that same
   transaction).
4. Client analytics events are **never** the authoritative record: `POST /api/analytics/event`
   accepts only known event types and cannot write a `Referral` row (pinned by test).

### 3.3 Validation / security matrix

| Case | Enforcement | Result |
| --- | --- | --- |
| Valid referral | code resolves to published, non-suspended business | attribution → CONVERTED |
| Invalid / tampered code | strict charset + length check, DB lookup | no attribution; plain redirect, no reason leaked |
| Nonexistent referrer | DB miss | no attribution |
| Unpublished referrer | `isPublished !== true` | no code minted, no attribution |
| Suspended / ineligible referrer | `status === "SUSPENDED"` | no code minted, no attribution |
| Self-referral | same owner id, or matching referrer email/phone at claim time | row marked `REJECTED`, registration still succeeds |
| Repeated attempts | `PENDING` token reused; `CONVERTED` row cannot be re-claimed (`updateMany` guarded on `status = PENDING`) | one conversion per attribution |
| First-touch wins | existing valid PENDING token is never overwritten | first referrer is credited |
| A → B → C chains | only the *direct* referrer is recorded (no ancestor credit) | chain of depth 2 recorded as two rows |
| Ordinary registration | no code/token present ⇒ referral path not executed | unchanged behaviour |
| Tenant isolation | attribution row carries `referrerUserId`; claim re-checks `business.ownerId === referrerUserId` | cross-tenant mismatch rejected |
| No publication bypass | publication gate has no referral input | referred business stays unpublished until payment |

### 3.4 Payment / publication boundary

* Referred businesses are created exactly like any other: `isPublished: false`, `status: PENDING`.
* Referral origin is not an input to `canSetPublished()` or `hasVerifiedPublicationRight()`.
* `PATCH /api/business { isPublished: true }` on a referred business with no verified payment is
  still `403` — pinned by a new PATCH-level test.
* Paystack initialisation, verification, webhook HMAC and idempotency are untouched.

### 3.5 Database (additive only)

```prisma
// new enum
enum ReferralStatus { PENDING CONVERTED REJECTED EXPIRED }

// new table (no FKs by design: additive, no cascade risk, attribution survives deletion)
model Referral {
  id, code, referrerUserId, referrerBusinessId?,
  referredUserId? (unique ⇒ one referral per referred user = first-touch at the DB level),
  referredBusinessId?, status, tokenHash (unique), rejectReason?,
  createdAt, expiresAt, convertedAt
}

// additive column
Business.referralCode String? @unique
```

Migration `prisma/migrations/20260929000000_referral_stage2/migration.sql` contains **only**
`CREATE TYPE`, `CREATE TABLE`, `ALTER TABLE … ADD COLUMN` and `CREATE INDEX` statements. Nothing
is dropped, altered destructively, or backfilled.

**Operator action required (NOT performed by this change):** applying the migration to the
production database. The repository's existing build gate (`scripts/build.sh` → `scripts/migrate.sh`)
runs `prisma migrate deploy` when `DATABASE_URL` is configured, so the migration is applied as part
of an operator-authorised deployment. This change performs no production migration or data
mutation itself.

### 3.6 UI

* `components/BusinessPage.tsx`: a subtle, mobile-friendly footer CTA ("Own a business like X?
  Create your page") rendered only when the business has an eligible code.
* `app/register/page.tsx`: an invitation banner naming only the public referrer business.
* `components/ReferralShareCard.tsx` on the dashboard per published business: copy / WhatsApp-share
  the owner's own referral link (self-service sharing).
* No referral PII (tokens, ids, emails, phones, internal reasons) is rendered or returned.

### 3.7 Tests

New suites: `tests/unit/referral-code.test.ts`, `tests/unit/referral-eligibility.test.ts`,
`tests/integration/referral-link-route.test.ts`, `tests/integration/referral-registration.test.ts`,
`tests/security/referral-security.test.ts`, `tests/security/referral-payment-boundary.test.ts`.
Plus the full existing suite and the required gates: `npm test`, `npm run lint`,
`npx tsc --noEmit`, `npm run build`, `git diff --check`, `npm audit`.

### 3.8 Governance

* Work committed to `arena/01a0ed17-jata-aftercall` and pushed; PR opened against `main`;
  **not merged**.
* Independent read-only verification is performed from the exact PR head SHA in a clean clone
  outside the working tree.
* Stage 2 is **not** declared production-ready until: PR independently verified → explicitly
  merged → deployed → post-merge production verification succeeds.
