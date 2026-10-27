# Seeded demo/admin account audit — 2026-10-27

**Scope.** Premium Transformation Phase 4. A source-level audit of every account the
application can seed, against the owner's *conditional retention* rule: keep a seeded account
only after verifying existence, authentication, privileges, exposure and tenant isolation.
Per the standing instruction, **no account was modified, rotated, disabled or deleted** during
this audit, and no production database was probed.

**Method.** Static review of `prisma/seed.ts`, `scripts/restore-demo-businesses.ts`,
`lib/demoData.ts`, `lib/registration.ts`, `lib/tenant.ts`, `lib/auth.ts`, the auth API routes,
the admin layout and `DEPLOYMENT.md`, plus the executable regression guard
`tests/unit/seeded-account-audit.test.ts` (14 tests). Credential *literals* are not repeated
in this document; they live in `prisma/seed.ts` and the local-dev section of `DEPLOYMENT.md`.

## 1. Inventory

| # | Account (email source) | Stored role | Purpose | Password handling |
 | --- | --- | --- | --- | --- |
| 1 | Admin — `ADMIN_EMAILS` env var, fallback `admin@jata.link` | `ADMIN` | Local/dev platform administration of plans, payments, businesses, subscriptions | bcrypt cost-10 hash via `bcrypt.hash(...)`; written only to `passwordHash` |
| 2 | Demo owner — constant `DEMO_OWNER_EMAIL` = `demo@jata.link` (`lib/demoData.ts`) | `CUSTOMER`, plus `OWNER` membership on the four demo businesses | Owns the four fictional demo pages shown on the public landing and `/b/<slug>` routes | Same bcrypt treatment; never plaintext |

Both seeded passwords satisfy the application's own 8-character minimum
(`lib/password-reset.ts` `PASSWORD_MIN_LENGTH = 8`) and include upper, lower, digit and symbol
characters. They are nevertheless **shared, source-visible fixtures**, which drives the
retention conditions in §5.

## 2. Findings

### 2.1 Existence — PASS (source), BLOCKED (production)

- The seed creates/updates both users with `upsert`; re-runs are idempotent and never create
  duplicates (`prisma/seed.ts`).
- Seeding is **manual only**: `package.json` script `seed → tsx prisma/seed.ts`. The deploy gate
  (`scripts/migrate.sh`) runs `prisma migrate deploy` and explicitly never seeds
  (`DEPLOYMENT.md` lines 64–66, 97–98). There is no `/api/seed`, `/api/migrate` or `/api/init`
  route — asserted by the regression test.
- **BLOCKED:** whether either row exists in the production Neon database today cannot be
  determined from the sandbox (no credentials, and probing is out of scope). Owner verification
  steps are in §6.

### 2.2 Authentication — PASS (source)

- Passwords are verified with bcrypt (`verifyPassword` in `lib/auth.ts`); no plaintext compare.
- `POST /api/auth/login` is rate-limited (`auth-login`, 20 requests / 60 s) and returns a single
  generic `Invalid credentials` response for unknown email and wrong password alike, so the
  accounts cannot be enumerated through distinguishable responses.
- Every successful login writes a `USER_LOGIN` audit record (`lib/audit.ts`), and sessions are
  bound to the user's `sessionVersion`, so a future password/reset flow can invalidate existing
  sessions server-side.
- Password reset is TTL-bound (30-minute token, 15-minute cooldown — `lib/password-reset.ts`).

### 2.3 Privileges — PASS (source)

- The admin console has a **server-side** gate in `app/admin/layout.tsx`: no session →
  `/login`; any role other than `ADMIN` → `/dashboard`. The marker pill `Platform admin` is
  cosmetic; the redirect is the control.
- The demo owner is seeded as `CUSTOMER`, never `ADMIN` (asserted in the regression test). Its
  elevated access is limited to `OWNER` membership rows on the four demo businesses, and all
  business mutations route through `guardTenantMutation` / `assertBusinessOwnership`
  (`lib/tenant.ts`), which fail closed when the role lookup fails and assign zero weight to an
  unknown role (`ROLE_WEIGHT[role] ?? 0`).
- The seed will skip (never overwrite) a demo slug whose row is owned by another user or that
  carries a non-demo payment, so re-seeding cannot take over a real customer's business.

### 2.4 Exposure — PASS with conditions

- The four demo businesses are **intentionally public** at `/b/<slug>` and on the landing
  showcase; all copy is labelled fictional and the payments carry the `demo-` reference prefix
  (`DEMO_PAYMENT_PREFIX`), which the codebase treats as non-revenue everywhere.
- The accounts themselves are not listed on any public page or API. The only way to exercise
  them is through the authenticated login.
- **Condition:** the source-visible passwords make any *production* deployment of these rows
  publicly guessable. Retention in production is acceptable only behind the controls in §5.

### 2.5 Tenant isolation — PASS (source)

- Demo rows are tied to the single `demo@jata.link` user; the restore script
  (`scripts/restore-demo-businesses.ts`) refuses to create demo rows for any other account and
  never creates users.
- Media/object storage keys are tenant-prefixed (`tenants/<businessId>/…`, `lib/storage/keys.ts`),
  so even the demo account cannot address another tenant's objects.
- The demo businesses' subscriptions/payments are fixture data scoped to those business rows;
  they never appear in Paystack verification flows, which only accept real verified references.

## 3. What was NOT tested (honest gaps)

| Check | Status | Why |
 | --- | --- | --- |
| Do the two users exist in the production Neon database? | BLOCKED | No production credentials in sandbox; direct DB access would itself be a privileged action |
| Have the seeded passwords been rotated in production? | BLOCKED | Same reason; `sessionVersion`/audit rows are production data |
| Recent login/audit history for either account | NOT TESTED | Requires production read access to the `AuditLog` table |
| Live login/rate-limit behaviour over HTTPS | NOT TESTED | Sandbox has no browser and restricted egress; source + unit tests only |
| Vercel/Neon environment configuration of `ADMIN_EMAILS` | BLOCKED | No environment values are retrieved or printed by this task |

## 4. Conditional retention decision (recommendation, not an action)

The accounts may be **retained** because each has a continuing functional purpose (admin
console; public demo showcase) and the source-level controls above are sound, **provided all of
the following hold**. If any condition cannot be met, the corresponding account should be
rotated or removed in a separate, explicitly approved change:

1. **Admin account**
   - Production admin email is set via `ADMIN_EMAILS` to a real, monitored owner inbox rather
     than the `admin@jata.link` fallback, *or* the fallback account's password is rotated to a
     unique secret stored only in a password manager.
   - The account is expected to be used; if no owner claims it, disable it (set a new random
     password / revoke sessions by bumping `sessionVersion`) rather than leaving the fixture
     credential live.
2. **Demo owner**
   - Keep while the public demo pages remain a marketing feature; the row is harmless as long
     as its password is rotated to a non-source value in any deployment reachable from the
     internet, because the source-visible fixture password is the only material weakness.
   - Demo data must continue to carry the `demo-` payment prefix and fictional-only labels.
3. **Both**
   - No production deployment may keep the literal fixture passwords from `prisma/seed.ts`.
     Rotation is an owner action (dashboard + targeted script); this task deliberately does not
     perform it.
   - Re-verify after rotation using the §6 steps, and confirm `USER_LOGIN` audit entries match
     expected activity.

## 5. Why no action was taken here

The standing instruction for this task is audit-only: do not modify, rotate, delete or disable
seeded accounts, and never request or expose credentials. All findings are therefore source
evidence plus a regression test; every production-state question is left as an explicit,
repeatable owner check rather than guessed at.

## 6. Owner verification runbook (production, read-only first)

1. In the Neon SQL editor (or a read-only connection), list the accounts:
   `SELECT email, role, "createdAt", "sessionVersion" FROM "User"
    WHERE email IN ('admin@jata.link', 'demo@jata.link');`
2. For each existing row, review recent activity:
   `SELECT action, "createdAt" FROM "AuditLog"
    WHERE "actorId" = '<userId>' ORDER BY "createdAt" DESC LIMIT 20;`
3. Confirm the four demo businesses are demo-owned and demo-prefixed:
   `SELECT slug, "ownerId" FROM "Business" WHERE slug IN
    ('nyumbani-kitchen','marys-beauty-studio','kamau-auto-care','john-kamau-properties');`
   and `SELECT reference FROM "Payment" WHERE reference LIKE 'demo-%';`
4. Decide retention against §4. If rotation is required, do it through the password reset flow
   or an approved, audited admin script — never by editing the seed file and redeploying, which
   would re-publish a source-visible password.

## 7. Automated evidence

`tests/unit/seeded-account-audit.test.ts` pins, at source level: the exact role pair
(`ADMIN` + `CUSTOMER`), bcrypt-only password storage, the demo-owner constant, demo payment
prefixing, the skip-when-not-exclusively-demo guard, absence of any web-triggerable seed route,
the admin layout role gate, login rate limiting and generic errors, the restore-script account
restriction, tenant guard exports, audit logging, and the "migrate never seeds" deployment rule.
Run: `npx vitest run tests/unit/seeded-account-audit.test.ts`.
