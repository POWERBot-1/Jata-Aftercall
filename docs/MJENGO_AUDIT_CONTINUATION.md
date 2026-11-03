# MJENGO OS — audit continuation & controlled remediation plan

**Scope:** TAWA `b86b70a` → MJENGO OS on JATA AFTERCALL `19f11d9ecd8daad1db2aaf35cc1166425f871acc`. This document is **planning only** — no production migration, no merge, no deploy. PR #80 stays open/draft (`a1fc8c1`), local docs untracked. All defects are **open** until a code change + regression prove closure. PASS/FAIL/BLOCKED/NOT TESTED labels are literal.

> **Do not claim complete audit, successful remediation or production readiness without corresponding evidence. Stop before broad implementation, merge or deployment.**

---

## 1 — PR evidence (PASS, with caveat)

GitHub API 2026-11-02 for `https://github.com/POWERBot-1/Jata-Aftercall/pull/80`:
`state:open`, `draft:true`, `base.ref:main`, `base.sha:19f11d9ecd8daad1db2aaf35cc1166425f871acc`, `head.ref:arena/bc5b7fd6-jata-aftercall`, `head.sha:a1fc8c1f8d5f1a6558a3e27fe779e011b3af7780`, `changed_files:2`, `additions:311`, `deletions:0`.
Local `git diff --name-status origin/main...HEAD` matches: `docs/MJENGO_TAWA_PRELIMINARY_AUDIT.md` + `docs/MJENGO_TAWA_ROUTE_INVENTORY.md`. `1,372-file` figure observed earlier is `git diff --name-status 77e35ce...19f11d9` (original session base → current main, 477 commits) — not the PR delta. **NOT TESTED** — user's browser rendering of PR file list was not observed; cannot diagnose display discrepancy from API alone.

---

## 2 — Branding-derived HTML injection (P0, FAIL, BLOCKED for real-browser proof)

### 2.1 Source-to-sink (confirmed, isolated TAWA SQLite + jsdom, not prod)

```
source  server/routes/settings.js:34-66  PUT /api/v1/settings/branding
         mustPerm(req,'branding.manage'); body → String(body[f]).slice(0,200) → UPDATE tenant_branding
         No sanitization; any actor with branding.manage can persist <svg>/<img onerror>.

store   tenant_branding.business_name  (SQLite file /data/tawa.db)

read    server/routes/identity.js:15-26  GET /api/v1/brand (public; falls back to first ACTIVE tenant)
         SELECT * FROM tenant_branding → { branding: { business_name, tagline, ... } }  (raw, tainted)

load    web/js/main.js:35-39  loadBrand()  fetch('/api/v1/brand?host='+host) → store.brand.branding

format  server/modules/ai.js:158-203  copilot(db,tenantId,actorId,question)
         answer('ANALYSE', `For "${term}", best ... via ${r.supplier} ...`)  — no escaping;
         question echoed, term inserted via qs.replace(/.*for /,'').trim().

sink    web/js/pages/ai.js:48-59  ask()
         const m = h('div', { class:'ai-msg' }, h('div', { html: ans.answer }));
         plus branding injected via same path: ai page title uses store.brand.business_name.

sink    web/js/ui.js:10-16  h(tag,props,...)
         if (k==='html') el.innerHTML = v;  // generic sink
         also spark()/vbars() build SVG strings via h('div',{html:svg}) (trusted numbers, but pattern).

trigger Injected element renders; event attribute fires.
```

**Controlled reproductions (isolated, not real browser/CSP):**

1. *Stored* (from prior memory): temporary TAWA server (SQLite `mkdtemp`, `node:sqlite`) accepted `business_name: '<img src=x onerror="window.xss=1">'` (200), `GET /api/v1/brand` returned it, jsdom `runScripts:'dangerously'` + `dispatchEvent(new Event('error'))` → `inline_handler_executed:true` (`branding_update_status:200, brand_fetched:true, injected_element:true`).

2. *Reflected* (2026-11-02, fresh): `TAWA_DATA_DIR=/home/user/tawa-audit/test-data` stack + jsdom: `input.value='cheapest supplier for <img src=x onerror="self[\'xss\']=1">'` → `ask(v)` → server echoes term in `answer` → `h('div',{html: ...})` → `document.querySelector('.ai-chat img[onerror]')` exists; `img.dispatchEvent(new Event('error'))` → `window.xss===1` ⇒ `{injected_element:true, inline_handler_executed:true}`. Static HTML `GET /` returned `Content-Security-Policy: null` (no CSP). **Limit:** jsdom event dispatch is controlled; CSP not enforced in jsdom; no real-browser verification.

### 2.2 Why trivial input filtering fails

- `business_name` is **plain text** (display name), not rich text. Allowlist HTML is wrong primitive; correct fix is **text rendering**.
- TAWA's `server/routes/files.js:114` sets CSP on `/brand/logo` but `web/index.html:1-24` and API responses have **no CSP**. Even with fix, defense must not rely solely on CSP.
- Other sinks share the same `html` prop: `web/js/pages/settings.js` branding preview, potential `reports.js` CSV, `customers.js` name, `orders.js` item snap. Audit must enumerate all `h(...,{html:` call sites (found 3 in `ui.js`/`ai.js` + icon).

### 2.3 Controlled remediation design (plan, no code yet)

**Principle: untrusted strings are text, never HTML. Trusted formatting is DOM nodes, never string concatenation.**

1. **Backend (Neon/Prisma):** preserve raw input but enforce invariant: `business_name` is **TEXT**. Add server validation: `z.string().trim().min(1).max(200)` + reject `<` `>` if present *or* store as-is but mark as `taint=text`. Do not attempt server-side HTML sanitization as primary fix — rendering choice is authoritative.

2. **Frontend safe primitive:** replace sink with safe one:
   ```js
   // Before (vulnerable):
   h('div', { html: ans.answer })
   // After (safe):
   h('div', { class: 'ai-msg' }, document.createTextNode(ans.answer))
   // or for formatting: build DOM nodes, never innerHTML:
   function mdSafe(text) { // for AI answers that need **bold** etc.
     // trusted markdown → DOM: allow only <b><i><code><a> with href allowlist, no event attrs.
     // Use DOMPurify with strict allowlist if rich text required; default: textContent only.
   }
   ```

3. **Enumerate all sinks:** `grep -rn "{ html" web/js/` → `ui.js:15, 287, 310, ai.js:53`. Add lint rule: `no-restricted-syntax` for `html:` prop without `/* safe-html: DOMPurify */` comment + test.

4. **Branding specifically:** `web/js/main.js` `store.brand.business_name` must be rendered via `textContent` everywhere (header, AI title, reports). Add helper `brandNameEl()` that returns text node.

5. **CSP defense-in-depth (separate verification):** Next.js `next.config.js` headers: `Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; img-src 'self' https: data:;` + `X-Frame-Options: DENY`. Verify in **real browser** (Playwright/Chromium), not jsdom. Test helper: page loads with `?csp-test=<img onerror>` → `page.locator('img[onerror]')` absent, `content-security-policy` header present, `page.evaluate(() => window.xss)` undefined.

6. **Regression tests (isolated, then real DB):**
   - `branding.html-injection.stored.test.js`: as Owner, `PUT /settings/branding {business_name:'<img src=x onerror=...>'}` → `GET /brand` returns same string → frontend renders → `locator('img[onerror]').count()==0`, `textContent` contains literal `<img`.
   - `ai.html-injection.reflected.test.js`: `POST /ai/ask {question:'<svg onload=alert(1)> hello'}` → response `answer` contains literal, render → no element created, no event fired. Include `svg`, `script`, `iframe`, `javascript:` payloads.
   - `branding.validation.test.js`: `PUT ... business_name:'a'.repeat(201)` → 400, `business_name:''` → 400.
   - Real-browser CSP test: navigate to `/` with injected brand pre-seeded, assert no execution + header.

7. **Status:** FAIL (open, not fixed). No destination code changed yet — this plan stops before implementation.

---

## 3 — Journal immutability & integrity (P0, FAIL, BLOCKED for Neon repro)

### 3.1 TAWA defect (confirmed)

- `server/db/migrations/003_sales_money.sql:257-273`: `journal_lines` has `BEFORE UPDATE` trigger only; **no `BEFORE DELETE`** trigger. `journal_entries` has both.
- `server/modules/ledger.js:203-210` `verifyLedgerIntegrity()`:
  ```sql
  SELECT e.id, SUM(l.debit), SUM(l.credit) FROM journal_entries e
  JOIN journal_lines l ON l.entry_id=e.id  -- INNER JOIN
  GROUP BY e.id HAVING SUM(l.debit) != SUM(l.credit)
  ```
  → entry with **0 lines** disappears from result; `ok:true` even after deleting both lines.
- **Repro** (isolated TAWA): `postEntry()` → 2 lines, `DELETE FROM journal_lines WHERE entry_id=?`, `verifyLedgerIntegrity()` → `{ok:true, unbalanced_entries:[], balanced:true}` (false negative). 7-migration runner idempotency smoke PASS (fresh DB only).

### 3.2 Destination state & friction (Neon/Prisma)

From `prisma/schema.prisma:3052-3097` and `prisma/migrations/20261027000000_pos_erp_pro/migration.sql:188-242`:

```prisma
model ErpJournal {
  id String @id @default(cuid())
  businessId String
  business Business @relation(fields:[businessId], references:[id], onDelete:Cascade)
  // ... journalNumber, entryDate, description, sourceType, sourceId, status, currencyCode, postedAt, postedById, reversedById, reversalOfId, reversalReason, createdById
  @@unique([businessId, journalNumber])
}
model ErpJournalLine {
  id String @id @default(cuid())
  businessId String
  business Business @relation(fields:[businessId], references:[id], onDelete:Cascade)
  journalId String        // plain string, no Prisma relation
  accountCode String
  accountId String        // plain string, no relation to LedgerAccount/ErpAccount
  branchId String?
  description String?
  debitCents Int @default(0)
  creditCents Int @default(0)
  @@index([journalId])
}
```

- `ErpJournalLine.journalId` / `accountId` are **unconstrained strings** — no FK to `ErpJournal`/`ErpAccount`. `migration.sql:238-242` adds only `FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE` for lines, not journal FK. So Neon does **not** prevent `DELETE FROM "ErpJournalLine" WHERE "journalId"='...'`.

- `lib/erp/accounting.ts:259-360` `postJournalTx()` **creates parent POSTED first**, then loops `tx.erpJournalLine.create()` (6-10 lines). `tests/integration/erp-pro-postgres.test.ts:94` cleanup does `await prisma.erpJournalLine.deleteMany({ where: { journalId: id } })` — direct delete. A naive `BEFORE INSERT ON ErpJournalLine BLOCK if parent status=POSTED` would **break current flow** (parent already POSTED when lines inserted). Likewise `reverseJournal:428` does `tx.erpJournal.update({ where:{id:journal.id}, data:{reversedById:reversal.id}})` on a POSTED original — blanket `BEFORE UPDATE ON ErpJournal` block would break reversal linkage.

- No `ErpJournal` status constraint at DB level (`status String @default("DRAFT")`); only app checks `lib/erp/accounting.ts:401-402`.

### 3.3 Controlled remediation design (plan, needs Neon verification)

**Goal: append-only, balanced, tamper-evident ledger in Postgres without breaking existing posting/reversal.**

**A. Lifecycle redesign (application):**

1. **Two-phase commit:** `postJournalTx` must create journal as `DRAFT` with lines, then seal:
   ```ts
   // inside tx:
   const journal = await tx.erpJournal.create({ data: { status:'DRAFT', ... }});
   for (line of lines) await tx.erpJournalLine.create({ data: { journalId:journal.id, ... }});
   // validate balance after all lines inserted (re-read sum)
   const sums = await tx.erpJournalLine.aggregate({ where:{journalId:journal.id}, _sum:{debitCents:true, creditCents:true}});
   if (sums._sum.debitCents !== sums._sum.creditCents) throw new AccountingError('UNBALANCED',400);
   await tx.erpJournal.update({ where:{id:journal.id}, data:{ status:'POSTED', postedAt:new Date() }});
   ```
   This makes `DRAFT` the only state where lines may be inserted.

2. **Reverse:** create new `RJV` journal via same two-phase, then link original:
   ```ts
   const reversal = await postJournalTx(tx, { reversalOfId: original.id, ... mirrored });
   await tx.erpJournal.update({ where:{id:original.id, status:'POSTED', reversedById:null}, data:{ reversedById: reversal.id }});
   // WHERE guards prevent double-reverse / TOCTOU
   ```

**B. Database protections (Prisma migration `20261XXXXX_journal_immutability`):**

```sql
-- 1. Add FKs (additive, verify no orphan lines pre-exist):
ALTER TABLE "ErpJournalLine" ADD CONSTRAINT "ErpJournalLine_journalId_fkey"
  FOREIGN KEY ("journalId") REFERENCES "ErpJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpJournalLine" ADD CONSTRAINT "ErpJournalLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "ErpAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Business FK already exists; keep CASCADE there.

-- 2. Immutability triggers — respect lifecycle:
CREATE OR REPLACE FUNCTION block_posted_journal_line_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."businessId" IS DISTINCT FROM NEW."businessId" THEN
    RAISE EXCEPTION 'ErpJournalLine businessId immutable';
  END IF;
  -- If parent is POSTED, block mutation:
  IF EXISTS (SELECT 1 FROM "ErpJournal" j WHERE j.id = COALESCE(NEW."journalId", OLD."journalId") AND j."status" = 'POSTED') THEN
    RAISE EXCEPTION 'posted journal lines are immutable';
  END IF;
  RETURN NEW; -- for UPDATE allowed only when parent DRAFT
END $$ LANGUAGE plpgsql;

CREATE TRIGGER erpjl_no_update_posted BEFORE UPDATE ON "ErpJournalLine"
  FOR EACH ROW EXECUTE FUNCTION block_posted_journal_line_mutation();
CREATE TRIGGER erpjl_no_delete_posted BEFORE DELETE ON "ErpJournalLine"
  FOR EACH ROW EXECUTE FUNCTION block_posted_journal_line_mutation(); -- OLD only, NEW is null so check OLD.journalId

-- 3. Journal sealing: once POSTED, only allowed transition is setting reversedById (and updatedAt):
CREATE OR REPLACE FUNCTION block_posted_journal_update() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'posted journal status immutable except DRAFT→POSTED sealing';
    END IF;
    IF NEW."postedAt" IS DISTINCT FROM OLD."postedAt" THEN
      RAISE EXCEPTION 'postedAt immutable';
    END IF;
    -- Allow only reversal linkage, nothing else:
    IF (NEW."reversedById" IS DISTINCT FROM OLD."reversedById" AND (
         NEW."description" IS DISTINCT FROM OLD."description" OR
         NEW."entryDate" IS DISTINCT FROM OLD."entryDate" OR
         NEW."journalNumber" IS DISTINCT FROM OLD."journalNumber"
       )) THEN
      RAISE EXCEPTION 'posted journal immutable except reversedById';
    END IF;
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'POSTED' THEN
    -- sealing: require lines exist and balance (could also be app-only)
    IF NOT EXISTS (SELECT 1 FROM "ErpJournalLine" l WHERE l."journalId"=NEW.id) THEN
      RAISE EXCEPTION 'cannot post journal with no lines';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER erpj_no_mutate_posted BEFORE UPDATE ON "ErpJournal"
  FOR EACH ROW EXECUTE FUNCTION block_posted_journal_update();
CREATE TRIGGER erpj_no_delete BEFORE DELETE ON "ErpJournal" FOR EACH ROW EXECUTE FUNCTION block_posted_journal_update();
-- For DRAFT journal DELETE: allow (or restrict per policy). If append-only from creation, block DELETE even on DRAFT.

-- 4. Integrity support: materialized balance or at least CHECKs:
ALTER TABLE "ErpJournalLine" ADD CONSTRAINT erpjl_exclusive CHECK (( "debitCents" > 0 OR "creditCents" > 0) AND NOT ("debitCents" > 0 AND "creditCents" > 0));
```

*Why conditional:* trigger inspects `ErpJournal.status` at mutation time → lines of `DRAFT` parent can be inserted; once parent sealed to `POSTED`, further INSERT/UPDATE/DELETE blocked. This fits current flow after refactoring to DRAFT-first. If refactoring is deferred, alternative is to block only `UPDATE`/`DELETE` and allow `INSERT` regardless — but that permits adding lines to POSTED journal, which must be forbidden. So DRAFT-first is preferred.

**C. Integrity verification hardening (application `verifyLedgerIntegrity`):**

Current TAWA `LEFT JOIN journal_lines ... LEFT JOIN journal_entries ... WHERE ... GROUP BY` masks bugs. Hardened version:

```sql
-- 1. Unbalanced posted/reversed journals:
SELECT j.id, j."journalNumber", COALESCE(SUM(l."debitCents"),0) AS debits, COALESCE(SUM(l."creditCents"),0) AS credits
FROM "ErpJournal" j LEFT JOIN "ErpJournalLine" l ON l."journalId"=j.id
WHERE j."businessId"=$1 AND j."status" IN ('POSTED','REVERSED')
GROUP BY j.id HAVING COALESCE(SUM(l."debitCents"),0) != COALESCE(SUM(l."creditCents"),0);

-- 2. Posted journals with zero lines:
SELECT j.id FROM "ErpJournal" j LEFT JOIN "ErpJournalLine" l ON l."journalId"=j.id
WHERE j."businessId"=$1 AND j."status" IN ('POSTED','REVERSED')
GROUP BY j.id HAVING COUNT(l.id)=0;

-- 3. Orphan lines (FK violation; should be impossible after FK):
SELECT l.id FROM "ErpJournalLine" l LEFT JOIN "ErpJournal" j ON j.id=l."journalId"
WHERE l."businessId"=$1 AND j.id IS NULL;

-- 4. Account mismatch (line businessId != journal businessId):
SELECT l.id FROM "ErpJournalLine" l JOIN "ErpJournal" j ON j.id=l."journalId"
WHERE l."businessId"=$1 AND l."businessId" != j."businessId";

-- 5. Trial-balance date scoping: filter entryDate in WHERE, not LEFT JOIN condition:
SELECT code, SUM(l."debitCents") ... FROM "ErpJournalLine" l JOIN "ErpJournal" j ON j.id=l."journalId"
WHERE j."businessId"=$1 AND j."entryDate" BETWEEN $2 AND $3 GROUP BY j."businessId", l."accountCode"
```

*Limitation:* tamper detection cannot prove deletion of a **balanced pair** that leaves no trace (0-sum). Needs independent commitment: hash chain (`prevHash = hash(prevEntry)`, `entryHash = hash(lines+prevHash)`) or period-close hash stored externally + WORM backup. Plan that as follow-up; at minimum count + hash stored on `ErpJournal` at post time.

**D. Direct SQL mutation tests (isolated Neon branch, never prod):**

- `journal.immutability.posted-line-update.test.ts`: post a journal (DRAFT→POSTED flow), then `prisma.$executeRaw` `UPDATE "ErpJournalLine" SET "debitCents"=999 WHERE "journalId"=$1` → expect `P0001 posted journal lines are immutable` rejection.
- `journal.immutability.posted-line-delete.test.ts`: same, `DELETE FROM "ErpJournalLine" WHERE ...` → expect trigger error; then `verifyLedgerIntegrity` still reports `ok:true` because tamper was blocked (not because it missed).
- `journal.lifecycle.draft-then-post.test.ts`: create DRAFT, insert 2 lines, seal POSTED, attempt extra line insert → blocked.
- `journal.integrity.missing-deleted-unbalanced-orphan.test.ts`: (if FK not yet) manually create unbalanced/zero-line/orphan via raw SQL bypassing triggers (using app-role that bypasses? Instead test via `replica` role with triggers disabled — shows detector catches it). Else test that detector finds known bad seed.
- `journal.concurrency.double-post.test.ts`: two concurrent `postJournalTx` with same `idempotencyKey` → only one `ErpJournal` inserted, second returns existing; test uses `Promise.all`.

**E. Migration safety:** additive only, `ON DELETE RESTRICT` for lines prevents cascade delete of journal with lines (business intent). Verify `20261027000000_pos_erp_pro` already uses `ON DELETE CASCADE` for business → deleting business deletes journals/lines (acceptable). Document decision.

**Status:** FAIL (open). No migration written yet; plan above stops before `prisma migrate` execution. Verify against existing `erp-pro-postgres` integration tests before finalizing trigger conditions (especially `reversedById` linkage and period `ensurePeriod` side effects).

---

## 4 — Revisited defects (all remain FAIL until regression proves fix)

### 4.1 CSRF (`server/core/auth.js:98-163`, `server/app.js:106-109`)

- **Defect:** cookie-bearer confusion: `resolveAuth` sets `viaCookie = !!cookie && !bearer`; supplying `Authorization: Bearer arbitrary` with valid session cookie → `viaCookie:false` → `enforceCsrf` returns early → mutation without CSRF header. Also `clientIp` trusts first `x-forwarded-for`, rate-limit key spoofable, lockout 8→LOCKED permanent DoS.
- **Isolated repro:** in-memory `resolveAuth(db, {headers:{cookie:'tawa_session='+validToken, authorization:'Bearer arbitrary'}})` → `{authenticated:true, viaCookie:false, result:'accepted'}` (no CSRF check).
- **Remediation design:**
  1. `resolveAuth` must prioritize cookie **and validate bearer independently** — if `authorization` present, it must be a valid API key or valid bearer session; arbitrary string → 401, not fallback to `viaCookie:false`. Simpler: `viaCookie = !!cookie` (bearer presence does not clear flag) **and** `enforceCsrf` must check `auth.session.csrf` regardless of `viaCookie` unless explicitly `fromApiKey`.
  2. `enforceCsrf` must also reject mutations where `origin`/`referer` header mismatches `Host` (double defense). Add `SameSite=Lax` is already set; require `Sec-Fetch-Site: same-origin` in addition.
  3. `clientIp` must respect `TRUSTED_PROXY_CIDRS` env — only trust `x-forwarded-for` if `req.socket.remoteAddress` in allowlist; otherwise use `remoteAddress`.
  4. Rate limit: use Redis/Neon `pg_advisory_lock` or Vercel KV, not `Map`.
  5. Lockout: `status='LOCKED'` must expire (`locked_until + 15min`) or use exponential backoff per IP+user, not permanent.
  6. Destination `lib/auth.ts`/`lib/tenant.ts`: verify `resolveTenant` from `session.userId` → `BusinessMember` → `businessId`, never `req.body.businessId`. Every financial mutation `assertPeriodOpen` etc. already rechecks but needs DB-level check too.
- **Regression:** HTTP matrix (real server):
  - `POST /api/v1/settings/branding` with valid cookie + valid `x-tawa-csrf` → 200.
  - Same with cookie + arbitrary bearer + no CSRF → 403 (currently 200 — FAIL).
  - Cookie + missing CSRF → 403.
  - Bearer-only with valid API key (read scope) → 200 without CSRF (expected).
  - Bearer-only with invalid bearer → 401.
  - Spoofed `x-forwarded-for: 1.1.1.1` without trusted proxy → `clientIp` ignores, rate-limit still by `remoteAddress`.
- **Status:** FAIL (open, not fixed).

### 4.2 Duplicate stock reservation (`server/modules/inventory.js:53-77`, `server/modules/sales.js:161-162`)

- **Defect:** `reserveStock` iterates `items` array without deduplication; `SELECT on_hand FROM stock_levels WHERE product_id=? AND warehouse_id=?` per line, then `UPDATE stock_levels SET reserved = reserved + ?` per line. Two lines of same product `qty:1` each against `on_hand:1` → `reserved:2` (oversell). No `FOR UPDATE` or atomic `WHERE reserved+qty <= on_hand`.
- **Repro:** actual TAWA `createOrder(db, {items:[{product_id:p, qty:1},{product_id:p, qty:1}]})` with `on_hand=1` → `{on_hand:1,reserved:2}` confirmed.
- **Remediation design:**
  1. Aggregate: `const byProduct = Map(group items by product_id → sum qty)`.
  2. Atomic reserve: `UPDATE stock_levels SET reserved = reserved + $qty WHERE product_id=$id AND warehouse_id=$wh AND (on_hand - reserved) >= $qty RETURNING *` — if `rowCount==0`, throw `INSUFFICIENT_STOCK`.
  3. For Postgres Prisma: `prisma.$transaction` with `SELECT ... FOR UPDATE` or `UPDATE ... WHERE` as above; handle serialization failure `P2034` retry.
  4. Add DB `CHECK (reserved <= on_hand)` on `StockLevel` (exists? verify).
  5. Destination `lib/pos/inventory.ts` must adopt same pattern; audit `PosSale` idempotency table for same-product lines.
- **Regression:**
  - Duplicate-line same product → 409 `INSUFFICIENT_STOCK`.
  - Concurrent `POST /sales/orders` last-unit race: `Promise.all([order1, order2])` where each asks 1 of 1 → exactly one succeeds.
  - Release/fulfil/expire paths decrement `reserved` correctly (test cancel + timeout).
- **Status:** FAIL (open).

### 4.3 Payout simulation (`server/adapters/payments.js:121-162`, `server/modules/payouts.js:27-42`)

- **Defect:** sandbox adapters synthesize `receipt_no`/`refund_ref` locally; `createOutboundPayout` promotes `sandbox_provider_records.status='PENDING'` → `SUCCESS` before settlement. `bank_manual` attestation is `UPDATE ... SET status='SUCCESS', receipt_no='BNK...'` — not bank webhook. No provider confirmation required.
- **Remediation design:**
  1. `createOutboundPayout` must require `actorId` with `payouts.execute` perm + second approver if amount > threshold (segregation).
  2. After `createIntent`+`initiateIntent`, provider call must be explicit: `PaystackProvider.transfer({amount, recipient})` → returns `transfer_code`/`reference`; only on `status:success` → `verifyAndSettle`. On `pending` → return `PROCESSING` + outbox poller.
  3. Webhook handler `handleWebhook` must verify `HMAC` with real secret (`config.paystackWebhookSecret`), not sandbox default, and log `provider_event_id` dedupe at DB layer (`UNIQUE(provider, provider_event_id)` with `NOT NULL`).
  4. Manual bank flow: distinct `BankAttestation` table (`attested_by`, `attested_at`, `statement_ref`, `external_confirmation_id`) — never auto-promotes; settlement only after `attested` + reconciler marks `VERIFIED`.
  5. Destination `lib/payments/providers/paystack.ts` must be reviewed — ensure it does not synthesize success (current code not audited here).
- **Regression:** payout to supplier → `PROCESSING` until webhook/poll returns `SUCCESS` with real `receipt_no`; without confirmation, `verifyLedgerIntegrity` shows no outbound payment; duplicate webhook with same `provider_event_id` → idempotent dedupe.
- **Status:** FAIL (open).

### 4.4 Credit & refunds (`server/modules/payments.js:172-184,299-334`, `server/modules/sales.js:applyCreditSale`)

- **Defect:** `refundPayment` synthesis (see above) + `createIntent` idempotency replay `SELECT id FROM orders WHERE tenant_id=? AND idempotency_key=?` returns old intent **without comparing new payload** (`amount`, `purpose`, `customer_id`). Conflicting replay silently returns old intent. `applyCreditRepayment` reduces `credit_accounts.balance` by `Math.min(intent.amount, balance)` then if `balance==0` marks `ORDER BY created_at LIMIT 1` `PAID` — wrong order, no allocation.
- **Remediation design:**
  1. Add `payload_hash TEXT NOT NULL` (or `payloadFingerprint`) to `payment_intents`/`PosSaleIdempotency`. On replay: compute `hash(newBody)` compare with stored; equal → return `replayed:true` (200), not equal → `409 CONFLICT {code:'IDEMPOTENCY_CONFLICT', existing:..., hash:...}`.
  2. Refund: call `PaystackProvider.refund({transaction, amount})` → provider returns `refund_ref`; store with `status:PROCESSING` until webhook confirms `REFUNDED`. Total refunds `SUM(refunds.amount WHERE status IN ('AUTHORIZED','PROCESSED'))` already checked before call — keep guard, add `FOR UPDATE` on payment row.
  3. Credit repayment: introduce `ErpPaymentAllocation` (already exists in schema `lib/erp/accounting.ts:320+`?) — each repayment intent must allocate to specific `invoiceId`/`orderId` lines; marking `PAID` per allocation, not random oldest.
  4. Destination `lib/pos/sales.ts` checkout idempotency table (`20261102000000_pos_sale_idempotency`) — verify it has fingerprint.
- **Regression:**
  - Same idempotency key + same body → 200 replayed, no second order/payment.
  - Same key + different amount → 409.
  - Refund larger than captured → 409 before provider call.
  - Credit repayment of KES 5000 with two orders 3000/2000 → allocations 3000+2000, both PAID.
- **Status:** FAIL (open).

---

## 5 — JATA AFTERCALL / Neon / Prisma compatibility assessment

### 5.1 Current destination reality (read-only inspection 2026-11-02)

- **Pricing & entitlements:** `lib/pricing.ts:290-294` canonical fallback rows `BUSINESS_POS 499/30d`, `ERP_PRO 3000/30d (JATA BOS PRO)`, `JATA_AUTOPILOT 2499/30d`; `HOMEPAGE_POS_PLAN_KEY="BUSINESS_POS"` presentation only (private). `lib/pos/entitlement.ts:18-20` `POS_PLAN_KEY="BUSINESS_POS"`, `POS_PLAN_PRICE_KES=499`, `assertBusinessPosPricing` guards checkout; `lib/erp/entitlement.ts` `ERP_PLAN_KEY="ERP_PRO"` with `assertErpPlanPricing` (not shown but referenced). `lib/autopilot/entitlement.ts` guards Autopilot. **No `MJENGO_OS` key exists yet** — plan missing.
- **Ledger:** `lib/erp/accounting.ts:259-360` `postJournalTx` as described (POSTED-first friction); `prisma/schema.prisma:3052-3097` models above; no journal-triggers yet. `lib/erp/access.ts` gate checks ERP entitlement.
- **Inventory/POS:** `prisma/migrations/20261003000000_business_pos` etc. create `PosProduct`, `PosSale`, `StockLot`; `quantity` is `Float` (float risk persists). No reservation trigger.
- **Storage:** `lib/storage/index.ts` selects R2 vs local via `STORAGE_PROVIDER` env; fail-closed (throws if `R2_*` missing) — but prod availability not verified (no `GET /api/storage/health`).
- **Payments:** `lib/paystack.ts` + `lib/payments/` exist but not audited in this pass; `PaymentTransaction.providerTransactionId` is CheckoutRequestID correlation.
- **Migrations:** 40+ Prisma migrations additive only (see `prisma/migrations/*/migration.sql` header comments) — safe to run on prod but need new journal-immutability migration that respects existing data.
- **Workspace:** `app/(dashboard)/erp` and `app/(dashboard)/pos` separate (per spec §80) — POS workspace uses `lib/pos/guard.ts`, ERP uses `lib/erp/access.ts`; neither should import TAWA SPA.

### 5.2 Compatibility gaps (what must change before MJENGO_OS)

| Gap | TAWA assumption | JATA gap | Fix gate (isolated, no prod) |
|---|---|---|---|
| Journal FKs | `REFERENCES journal_entries(id)` + triggers | Prisma `journalId`/`accountId` strings, only `businessId` FK | Migration adds FKs + trigger with lifecycle-aware logic + Prisma `@relation` (or at least index + trigger) |
| Quantity precision | `REAL` float (bug) | `Float` in Prisma | New migration `Decimal` or `Int` millis; backfill via `ROUND(qty*1000)` verification |
| Auth tenant | `tenant_id` in session + `resolveAuth` | NextAuth session with `userId→BusinessMember→businessId` | Audit `lib/tenant.ts` every `businessId` sourcing; add test `client-supplied businessId` → 403 |
| Idempotency | `UNIQUE(tenant_id, idempotency_key)` no payload check | Similar, no fingerprint | Migration adds `payloadHash TEXT` + app conflict check |
| Providers | sandbox `mpesa_sandbox` | Paystack live | Map `PROVIDER_FOR` to `paystack` + `manualBank` with attestation table; remove sandbox promotion |
| Hosting | `node:http` + SQLite file | Vercel Edge/Node + Neon Postgres | Replace `BEGIN IMMEDIATE` with Prisma `$transaction` + `forUpdate` or conditional `UPDATE ... WHERE` |

### 5.3 MJENGO_OS vs BUSINESS_POS — separate entitlements (KES 2,000 vs 499)

**Requirement:** `MJENGO_OS` (KES 2,000 / 30 days) and `BUSINESS_POS` (KES 499 / 30 days) are **separate entitlements, subscriptions, workspaces and billing**; neither grants the other; preserve existing POS customers.

**Design (no code, just plan):**

1. **PlanConfig:** Add `MJENGO_OS` row:
   ```ts
   { key:"MJENGO_OS", name:"MJENGO OS — Hardware Business OS", priceKES:2000, durationDays:30, isActive:true }
   // keep BUSINESS_POS 499, ERP_PRO 3000, JATA_AUTOPILOT 2499 unchanged
   ```
   Seed migration `20261XXXXX_mjengo_os_plan` with `INSERT INTO "PlanConfig" ("key","priceKES","durationDays",...) VALUES ('MJENGO_OS',2000,30) ON CONFLICT("key") DO NOTHING;` Do **not** seed demo purchase.

2. **Entitlement gate:** new `lib/mjengo/entitlement.ts` mirroring `lib/pos/entitlement.ts`/`lib/erp/entitlement.ts`:
   ```ts
   export const MJENGO_PLAN_KEY="MJENGO_OS", MJENGO_PRICE=2000, MJENGO_DAYS=30;
   export function assertMjengoPricing(plan){ return plan.key===MJENGO_PLAN_KEY && plan.priceKES===2000 && plan.durationDays===30; }
   export function deriveMjengoEntitlement({subscription, entitlement, paidPayment, now}): EntitlementState { ... same pattern: CANCELLED>no-sub>wrong-plan>inactive>ACTIVE with grace ... }
   ```
   Gate: `requireMjengoAccess(req)` checks `businessId` from trusted identity → `Subscription` where `planKey=MJENGO_OS` and `status IN ('ACTIVE','EXPIRING','PAST_DUE')` and `entitlement.status != SUSPENDED`. If false → `402 PAYMENT_REQUIRED` with `reason` and `nextAction:"pay"`.

3. **Workspace isolation:** `app/(dashboard)/mjengo` (or `/dashboard/mjengo`) separate from `app/(dashboard)/pos` (`/dashboard/pos`) and `app/(dashboard)/erp`. No route imports TAWA SPA; use Next.js `app/` with existing `components/` + `lib/designSystem.ts`. Navigation item `Mjengo OS` visible only when `deriveMjengoEntitlement().entitled` true (but route still server-gates).

4. **Billing:** MJENGO_OS purchase lives only in its workspace (`/dashboard/mjengo/subscription`), uses same Paystack flow but with `assertMjengoPricing` at checkout; `publiclyListedPlans()` must **exclude** `MJENGO_OS` (add to `PRIVATE_PLAN_KEYS` in `lib/pricing.ts`) — only marketing card `MJENGO_OS_FALLBACK_CARD` may show, linking to `/products/mjengo-os` detail (presentation only). This mirrors `BUSINESS_POS`/`ERP_PRO` pattern.

5. **Regression:**
   - Existing `BUSINESS_POS` customer (499 active, MJENGO_OS not purchased) → `deriveMjengoEntitlement` → `entitled:false, status:NONE, nextAction:pay` — MJENGO routes 402.
   - MJENGO_OS customer (2000 active, POS not purchased) → `derivePosEntitlement` → `entitled:false` — POS routes 402.
   - Both purchased → both entitled, workspaces independent.
   - Checkout with `planKey=MJENGO_OS` but `priceKES=1999` → `assertMjengoPricing` 400.
   - Preserve: migration does not touch existing `BUSINESS_POS` rows; test by reading one existing POS subscription before/after MJENGO migration.

---

## 6 — Test & verification matrix (controlled, isolated)

All tests run on **isolated Neon branch** (`neonctl branching` or `DATABASE_URL` override) or **in-memory SQLite for TAWA-only logic**; never production; no real customer seed.

| # | Area | Regression name | Scenario | Expected | Status |
|---|---|---|---|---|---|
| 1 | Branding stored | `branding.stored-html.test` | `PUT /settings/branding {business_name:'<img onerror=>…'}` → `GET /brand` → render | literal text, no `img[onerror]` | FAIL (open) |
| 2 | AI reflected | `ai.reflected-html.test` | `POST /ai/ask {question:'<svg onload=…>'}` → `answer` → render | literal, no `svg[onload]` | FAIL (open) |
| 3 | CSP header | `csp.header.test` | `GET /` with seeded hostile brand, real browser | `content-security-policy: default-src 'self' …`, no execution | BLOCKED (no real browser) |
| 4 | Journal delete | `journal.delete-posted-line.test` | post → `DELETE FROM ErpJournalLine` | trigger `P0001 … immutable` | FAIL (no trigger yet) |
| 5 | Journal update | `journal.update-posted-line.test` | post → `UPDATE … SET debitCents=…` | trigger block | FAIL |
| 6 | Journal empty | `journal.zero-line-posted.test` | post then (if possible) delete lines → `verifyLedgerIntegrity` | detects `zero_line` | FAIL (detector wrong) |
| 7 | Lifecycle seal | `journal.draft-then-post.test` | create DRAFT+lines then seal POSTED, then extra line | blocked after seal | NOT TESTED (flow not yet) |
| 8 | CSRF cookie+bearer | `auth.csrf.cookie-bearer.test` | valid cookie + arbitrary bearer, no CSRF | 403 | FAIL (currently 200) |
| 9 | CSRF missing | `auth.csrf.missing.test` | cookie auth, no CSRF header | 403 | FAIL |
| 10 | Reservation dup | `inventory.duplicate-line.test` | 1+1 of 1 stock in one order | 409 `INSUFFICIENT_STOCK` | FAIL |
| 11 | Reservation race | `inventory.concurrent-race.test` | 2 concurrent last-unit orders | exactly one succeeds | NOT TESTED (no Postgres) |
| 12 | Idempotency same | `payments.idempotency.same.test` | same key + same body twice | 200 replayed, one record | FAIL (no fingerprint) |
| 13 | Idempotency conflict | `payments.idempotency.conflict.test` | same key + different amount | 409 | FAIL |
| 14 | Payout confirm | `payout.confirmation.test` | outbound payout → no auto-success until webhook | `PROCESSING` until verified | FAIL |
| 15 | Entitlement sep | `billing.mjengo-vs-pos.test` | POS-only user → MJENGO route | 402 | NOT TESTED (MJENGO key missing) |
| 16 | Direct SQL | `sql.mutation.journal.test` | raw `prisma.$executeRaw` delete posted line | blocked by trigger | NOT TESTED |

**Browser:** jsdom repros are **not** proof; real-browser harness (Playwright) must run `npx playwright test` with seeded brand payloads + `page.evaluate`. Currently **BLOCKED** (no browser installed in sandbox — `ls ~/.cache/ms-playwright` showed empty; need `npx playwright install chromium` in CI).

**Production evidence:** none collected; `gh api /pulls/80` + static reads only. No `DATABASE_URL`, no Vercel env inspected (per constraint).

---

## 7 — What remains (exhaustive audit incomplete)

- **Source files:** 74 of 106 still title-scan only (most frontend pages, `scripts/validate`, `seed/catalog`, `docs/*`, 7 migrations not deep). Line-by-line review, route→module→table→perm→test matrix, and frontend sink enumeration outstanding.
- **Destination:** `lib/auth.ts`, `lib/tenant.ts`, `lib/payments/providers/paystack.ts`, `lib/storage/index.ts` prod config, `lib/erp/*`, `lib/pos/*` full compatibility + period-close immutability not yet line-read; `prisma/schema.prisma` 59 migrations diff not reviewed.
- **Tests:** ledger period, entitlement expiry/upgrade, reservation expiration, payroll segregation, file SVG, admin privilege escalation — all adversarial tests listed above pending.
- **Infra:** CSP real browser, Postgres concurrency (`SERIALIZABLE` retry), trigger migration dry-run on isolated branch — not executed.

---

## 8 — Acceptance gates before merge/deploy

1. **Security gate:** all P0 regressions green (CSRF, XSS stored+reflected + CSP, journal triggers, reservation, payout/credit) — code + test evidence on isolated DB, not `npm test` alone.
2. **Ledger gate:** append-only enforced at DB, `verifyLedgerIntegrity` detects missing/orphan/unbalanced, period close, reversal linkage, tamper hash documented.
3. **Entitlement gate:** `MJENGO_OS` (2000) and `BUSINESS_POS` (499) server-authoritative, workspaces isolated, existing POS customers preserved (before/after snapshot test).
4. **Audit gate:** 106-file register shows reviewed sections per file with line ranges + findings; route→DB→test matrix 201 rows; packaged tarball unpacked.
5. **Review gate:** PR approved, no draft, 2-file delta replaced by actual implementation commits (separate streams: identity, ledger, payments, inventory, mjengo), `prisma migrate` tested on staging branch.

Until then: **production readiness = NO. Do not merge PR #80, do not deploy, do not push these two docs.**

---

*Local working docs: `docs/MJENGO_TAWA_SOURCE_COVERAGE.md` (register detail) + this continuation plan. Both untracked (`??`), not in PR. Verification commands: `git diff --name-status origin/main...HEAD`, `gh api repos/POWERBot-1/Jata-Aftercall/pulls/80`, `git ls-files | sort`, `wc -l server/**/*.js`.*
