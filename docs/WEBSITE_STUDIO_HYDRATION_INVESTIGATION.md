# Website Studio — hydration investigation (2026-10-12)

## Verified starting state / limits of historical evidence

- Repository `POWERBot-1/Jata-Aftercall`; branch `arena/7b28a123-jata-aftercall`; starting local/remote/PR HEAD **45e537c20ca2b5c78092f706c840fce8870d0fe8**, clean worktree, PR41 OPEN/DRAFT.
- Exact-head CI38214337060/job114695435397/runner068d914caa71d4881a3d2889fa55fcbd28869a9c SUCCESS; bot6119277469 verifies native2034 PASS+1 preserved expected, Website17/POS22, authenticated133, existing browser/HTTP358. No source reset/reconstruction or unrelated work discarded.
- Historical d72c7bc CI38212061750/job114688223495/bot6118943323 reports132 PASS/1 FAIL and ONE React418. Its old listener accumulated a message only, **no route, frame, seed, component stack or SSR snapshot**. Immediate page/stack logging was added in5f0a298; subsequent source-equivalent passes do not establish historical resolution.
- Attempted `gh run view38212061750 --job114688223495 --log`: exit1/EOF retrieving Actions logs from the restricted results host. The PR failure output remains accessible but still has no route/stack. Do not invent the original failing route or claim causal certainty.

## Reproduction BEFORE application edits

Actual source tree for the booking route:

`RootLayout → ProductThemeProvider → /b/[slug]/book/page.tsx → server loadStorefront/ownership decision → StorefrontShell → BookingClient`.

The unchanged BookingClient generated initial days in `useMemo` from `new Date()`, created **local midnight**, converted it with `toISOString().slice(0,10)`, then formatted labels on the client using local `toLocaleDateString`. SSR and hydration each independently repeated this calculation.

Controlled time **2026-10-12T06:24:00Z**:

| Execution | First rendered date label | Result |
|---|---|---|
|Actual component SSR, server UTC|Mon,12 Oct|Reference SSR|
|Same actual component, client Africa/Nairobi|Sun,11 Oct|Different initial HTML; local midnight converts to previous UTC date|
|Real Chromium153 mobile360×740, UTC control|Mon,12 Oct before/after|No recoverable errors|
|Real Chromium153 mobile360×740, Nairobi|Mon,12 Oct SSR → Sun,11 Oct client|React425 text mismatch, React418 hydration failures, React423 root client fallback|
|Server23:59:59Z, client00:00:01Z next day|Calendar advances independently|Different initial HTML even with identical timezone|

The browser fixture renders the **actual BookingClient and actual React/DOM**. Only Next Link is adapted to an `<a>` for isolation. It is not a native DB/authentication/production-Next or physical-device test. No app QA route/provider/mock payment was introduced. Scratch logs live under ignored `.cache/verification/phase2`.

Added the initial SSR equality regressions before fixing application source: **4 FAIL/2 PASS** on unchanged code. These fail for Nairobi/Kathmandu/Auckland and UTC-midnight rollover. This is a reproducible booking defect and a concrete root cause for that reproduction. **The unlocalized historical418 cannot conclusively be attributed to it.**

## Targeted fix / invariants

- `lib/experience/bookingCalendar.ts`: captures14 date-only choices on the server, deterministic UTC date keys and English/en-KE weekday/month labels; no client timezone/clock/ICU dependence. Invalid server dates fail safely; leap/day/year bounds tested.
- `app/b/[slug]/book/page.tsx` passes this serialized calendar to the existing client component after the unchanged server storefront/preview-ownership checks.
- `BookingClient` renders the exact supplied calendar and still submits the selected date key to the same server endpoint. No `suppressHydrationWarning`, client-only calendar placeholder, authentication mock or force click.
- Existing UTC deployment date-key convention retained. **No booking availability, past-time, capacity, deposit/payment, ownership, entitlement or publication rule changed.** Dates are still choices, not server-guaranteed availability; the server offers/validates slots as before.
- Browser date labels remain present in SSR/no-JS HTML; same accessible fields, pressed-state buttons, responsive layout and actual form submission retained.

## Regression evidence / commands

- `npx vitest run tests/unit/booking-hydration.test.ts`:12 PASS after fix (initial complete HTML parity across4 timezones and midnight, server HTML/form retained,14-day calendar/determinism/leap/year/invalid-clock tests).
- `CHROME_PATH=<actual Chrome> npm run test:browser:studio-hydration`:25 PASS,0 FAIL/SKIP. Six actual isolated component hydration cases (UTC/Nairobi/Kathmandu/New York/Auckland/midnight), SSR-readable dates/zero recoverable errors/exact labels/real selected-state interaction; negative control proves a genuinely different server label still triggers the detector. The negative control is confined to that fixture, never filters app errors.
- Local lint/types/syntax/whitespace PASS. Full local suite157 PASS/12 DB-e2e SKIP files;1979 PASS/108 DB-e2e SKIP/2087. Native local journey BLOCKED without the approved disposable database/native engine; not inferred from these tests.
- Existing required authenticated-cookie runner now uses a Nairobi visitor and adds **27 real Next SSR navigations** over retail/food/salon, UTC/Nairobi/New York, home/item/shop or booking; the3 booking visits require raw server HTML date labels exactly equal hydrated client labels. Its existing final zero-runtime/zero-forbidden-request gate is unchanged. Safe route/timezone/status diagnostics retained in results; no cookies/query payloads logged.
- CI runs the25-check isolated regression alongside the connected production/authenticated suite; missing Chrome is BLOCKED/exit2, never accepted as a passing skip. Exact native source/run/job/results are recorded in release evidence after normal push.

## Acceptance / next action

This fixes the **proven booking SSR clock/timezone defect**. Historical aggregate418 attribution remains OPEN unless more route-specific evidence identifies it; neither repeated green runs nor this similarity retroactively proves its source. Keep runtime failures mandatory and investigate any recurrence from its actual route/stack.

After native verification, proceed to advisory-by-advisory compatible remediation, then reusable business recipes. All108 master blocks/A–X/all7 stages remain mandatory. Storage DEFERRED; persistent originals/providers BLOCKED; no uploads/provider activation/provisioning/spending/production data, merge or production deployment.


## First native result / separate shop Server Component defect

Phase2 source **b670cd9e496ed8a205d6783bf7f0da16d85f12dc**, CI38216557166/job114702549703 **FAILED**, actual bot6119577130. Native167files2046 PASS+1 expected/2047, Website17/POS22/connected build PASS. Nairobi customer actual booking201/persisted service/owner board PASS after calendar fix. Additional real SSR probe identified `/b/[slug]/shop`500, not a hydration error: server ShopPage called `priceBandsFor` imported from `CatalogueClient` marked `"use client"`. Next logged “Attempted to call priceBandsFor() from the server … on the client”, digest1930353472. Authenticated117 PASS/1 FAIL; remaining SSR probes/final checks/downstream browser steps NOT RUN; exact cleanup/stop PASS.

Root cause established from actual route/server log BEFORE change. The pure existing price-band function is moved byte-for-byte to `lib/experience/catalogue.ts`; ShopPage imports it from the server-safe module, client component retains browsing behavior. No calculation/price authority/tenant/entitlement/commerce rule altered. New boundary regression fails before fix (1FAIL/3 arithmetic PASS), then all4 PASS; shared-module ownership/arithmetic/sparse/unpriced/input-immutability tests retained. Required shop SSR assertion is NOT removed. Fresh native correction-head required before Phase3 changes.
