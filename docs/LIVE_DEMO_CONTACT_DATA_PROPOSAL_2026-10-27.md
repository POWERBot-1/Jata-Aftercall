# Live demo contact data — narrowly scoped, reversible change proposal (2026-10-27)

**Status: PROPOSAL ONLY — NOT APPLIED.** No production row was read through a database connection,
modified, exported or backed up in this session. Executing any statement below requires separate,
explicit owner authorization and an authorized Neon/database console. No credentials are included
here.

## 1. Why this proposal exists

A read-only text fetch of the four public demo pages on `https://jata-aftercall.vercel.app`
(2026-10-27) showed that the persisted demo rows still contain the historical placeholder
numbers, while the source fixture `lib/demoData.ts` already defines the official JATA demo line
`0724317010` for all four fictional businesses.

| Public slug (verified via read-only fetch) | Displayed phone / WhatsApp | Generated destinations |
| --- | --- | --- |
| `/b/nyumbani-kitchen` | `0700000001` | `https://wa.me/254700000001?...`, `tel:+254700000001` |
| `/b/marys-beauty-studio` | `0700000002` | `https://wa.me/254700000002?...`, `tel:+254700000002` |
| `/b/kamau-auto-care` | `0700000003` | `https://wa.me/254700000003?...`, `tel:+254700000003` |
| `/b/john-kamau-properties` | `0700000004` | `https://wa.me/254700000004?...`, `tel:+254700000004` |

All four pages were reachable and showed Directions from their configured addresses. Share was a
text-only control. **Verified fact.** The homepage also said “No demo page is currently available
to open” and the demo pages were labelled “TODAY'S OFFER” rather than the fictional-sample label.
The most likely cause is that the owner-bound `isVerifiedDemoRecord()` check no longer matches
those rows (owner identity and/or payment references). **Inference, NOT VERIFIED** — this session
had no authorized production database connection, so the actual `ownerId`, `status`,
`isPublished`, payment references and row values could not be read directly.

### Already implemented in code (no data change needed for the public links to work)

- `lib/demoContact.ts#resolveDemoContacts()` replaces a missing, invalid or known placeholder
  number at **read time** with the fixture's official demo number, only for a row satisfying
  `isPublicDemoRow()` (fixed slug + exact fictional business name + no payment reference outside
  the seed's `demo-` namespace). It writes nothing to the database.
- `isPublicDemoRow()` is also used by the homepage and `/b/[slug]` demo labelling so the four
  working demo links and the “fictional sample” notice can appear even when the owner identity no
  longer matches. It never reclassifies a row with a real payment.
- `isVerifiedDemoRecord()` remains the strict, owner-bound verifier for any write/restore path and
  was not weakened.

The data change below is therefore an **optional consistency cleanup** of persisted rows, not a
prerequisite for the contact actions to function. **NOT VERIFIED in production:** the effect of the
code change on live rows will only be known after an authorized deployment and production check.

## 2. Exact scope of the proposed change

**Records:** exactly the four `Business` rows with slugs `nyumbani-kitchen`,
`marys-beauty-studio`, `kamau-auto-care`, `john-kamau-properties`.

**Fields:** only `Business.phone` and `Business.whatsapp` (plus the automatically maintained
`Business.updatedAt`, which raw SQL must set explicitly). No other column, table, plan, price,
subscription, payment, entitlement, DNS record, environment variable or storage object is touched.

**Target value:** `0724317010` — the official JATA demo contact already present in all four
`lib/demoData.ts` fixtures. This treats all four fictional demos as sharing one official demo line.

> **Owner decision required before execution:** confirm that all four demos should use the single
> official demo line. If the owner instead supplies distinct verified numbers for each fictional
> business, substitute those four values in the statements below. Do **not** assume a real
> customer's number from a slug, and never update a row whose current value is not one of the four
> known placeholders.

**Explicitly out of scope (observed, NOT changed here):** persisted `description`, `aftercallMsg`,
`Offer.title`, `Offer.subtitle`, `Offer.isActive` and `Offer.validUntil` still contain stale
marketing copy on production — for example “Today only”, “This week only”, “verified listings, no
brokers” and “viewing this weekend”. Those claims are misleading for a fictional demo and should
be handled in a **separate** content proposal with its own approval, because changing marketing
copy is a different decision from correcting a contact number. They are **NOT VERIFIED** against
an authoritative production content source in this session.

## 3. Preconditions — read-only verification (run first, save the output)

```sql
-- Read-only inventory. Do not continue unless exactly four rows are returned and every
-- currentPhone/currentWhatsapp is one of the known placeholders (or NULL).
SELECT b.id, b.slug, b.name, b.phone AS currentPhone, b.whatsapp AS currentWhatsapp,
       b."isPublished", b.status, u.email AS ownerEmail,
       (SELECT count(*) FROM "Payment" p
          WHERE p."businessId" = b.id
            AND p.reference NOT LIKE 'demo-%') AS nonDemoPayments
FROM "Business" b
LEFT JOIN "User" u ON u.id = b."ownerId"
WHERE b.slug IN ('nyumbani-kitchen','marys-beauty-studio','kamau-auto-care','john-kamau-properties')
ORDER BY b.slug;
```

Stop and escalate to the owner if:

- any row is missing, has a different `name` than its fixture, or is not `isPublished = true`;
- `nonDemoPayments > 0` on any row — that would indicate a real customer and must never be updated;
- any `currentPhone`/`currentWhatsapp` is a real number rather than `NULL` or one of
  `0700000001`…`0700000004` / `254700000001`…`254700000004`;
- fewer or more than four rows match.

Also require: a fresh Neon branch/snapshot or PITR restore point taken immediately before the
change, and a saved copy of the `SELECT` output above outside the database. No schema migration or
Prisma client regeneration is required — both columns already exist.

## 4. Proposed change (single transaction, guarded)

```sql
BEGIN;

UPDATE "Business" b
SET phone = '0724317010',
    whatsapp = '0724317010',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE b.slug IN ('nyumbani-kitchen','marys-beauty-studio','kamau-auto-care','john-kamau-properties')
  AND b.name IN ('Nyumbani Kitchen', 'Mary''s Beauty Studio', 'Kamau Auto Care', 'John Kamau Properties')
  AND (b.phone IS NULL OR b.phone IN
       ('0700000001','0700000002','0700000003','0700000004',
        '254700000001','254700000002','254700000003','254700000004'))
  AND (b.whatsapp IS NULL OR b.whatsapp IN
       ('0700000001','0700000002','0700000003','0700000004',
        '254700000001','254700000002','254700000003','254700000004'))
  AND b."isPublished" = true
  AND NOT EXISTS (
        SELECT 1 FROM "Payment" p
        WHERE p."businessId" = b.id AND p.reference NOT LIKE 'demo-%'
      )
RETURNING b.id, b.slug, b.phone, b.whatsapp, b."updatedAt";

-- COMMIT only when RETURNING shows exactly four rows, all with 0724317010.
-- Otherwise ROLLBACK immediately.
COMMIT;
```

No fake payment, invoice, subscription, receipt or entitlement row is created. No price, plan
key, billing interval or publication gate is altered.

## 5. Post-change validation (after an authorized deployment of the code change)

1. **Database:** re-run the read-only `SELECT` from §3; all four rows must show `0724317010` and
   `nonDemoPayments = 0`. Count of updated rows must be exactly 4.
2. **Number normalization:** `normalizeKePhone('0724317010')` → `254724317010`; the public page
   must render `https://wa.me/254724317010?text=...` and `tel:+254724317010`.
3. **Four demo pages:** open each `/b/<slug>` anonymously and verify all four labelled icon
   actions (WhatsApp, Call, Directions, Share), the fictional-sample notice, no `070000000X`
   destination, no horizontal overflow at 320/360/390/430/768/1366 widths, and no browser-console
   error. **PASS locally in a fixture; NOT TESTED in production.**
4. **Homepage:** the four demo links must be present and no “No demo page is currently available
   to open” message should remain. **NOT VERIFIED in production** until an authorized deployment.
5. **Real customers:** re-run the §3 `SELECT` for all other businesses to confirm no other row
   changed; compare against the saved pre-change inventory.

## 6. Rollback plan (reversible, no schema change)

If any validation fails, or the owner withdraws approval, restore the exact saved values. Because
the pre-change values are the four known placeholders, the reverse statement is deterministic:

```sql
BEGIN;
UPDATE "Business" SET phone = '0700000001', whatsapp = '0700000001', "updatedAt" = CURRENT_TIMESTAMP
 WHERE slug = 'nyumbani-kitchen'      AND phone = '0724317010' AND whatsapp = '0724317010';
UPDATE "Business" SET phone = '0700000002', whatsapp = '0700000002', "updatedAt" = CURRENT_TIMESTAMP
 WHERE slug = 'marys-beauty-studio'   AND phone = '0724317010' AND whatsapp = '0724317010';
UPDATE "Business" SET phone = '0700000003', whatsapp = '0700000003', "updatedAt" = CURRENT_TIMESTAMP
 WHERE slug = 'kamau-auto-care'       AND phone = '0724317010' AND whatsapp = '0724317010';
UPDATE "Business" SET phone = '0700000004', whatsapp = '0700000004', "updatedAt" = CURRENT_TIMESTAMP
 WHERE slug = 'john-kamau-properties' AND phone = '0724317010' AND whatsapp = '0724317010';
COMMIT;
```

If any row had `NULL` or a `2547…` placeholder before the change, use the saved §3 inventory
instead of the literals above. A Neon branch restore is the fallback if the saved inventory is
unavailable. Restoring the previous code revision also removes the read-time demo-contact
fallback, because `resolveDemoContacts()` is additive and touches only verified demo rows.

## 7. Approval and governance

- **Required:** explicit owner approval of the target number(s), a pre-change snapshot and an
  authorized operator to execute §3–§5 in the production Neon database.
- **Not performed here:** no production database connection, no `UPDATE`, no snapshot, no
  deployment, no merge. No credential, connection string or customer data was handled.
- **Separate approval still required** for: merging this branch, deploying it, changing DNS or
  environment variables, and any content/offer copy correction noted as out of scope.
