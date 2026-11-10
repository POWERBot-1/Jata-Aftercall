Source: GitHub Actions, "Journey against a real database" run 42869947953, job 130018210984.
Feature head: 9e18fbf4f9a3b07cc48006c0eca952028ddf817d
Runner checkout: 2189141bf4f1dfa5cc28507455800abaa23a7be2
Workflow conclusion: success (14m45s)

Verification passed for feature head `9e18fbf4f9a3b07cc48006c0eca952028ddf817d` (runner checkout `2189141bf4f1dfa5cc28507455800abaa23a7be2`). [Run 42869947953](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/42869947953).

### Full native DB suite

```
Test Files  413 passed (413)
      Tests  4791 passed (4791)
```

### Experience journey

```
Test Files  1 passed (1)
      Tests  17 passed (17)
```

### Business POS journey

```
Test Files  1 passed (1)
      Tests  33 passed (33)
```

### Control authenticated deny-path/API/browser/screenshots (not positive-role acceptance)

```
PASS  anonymous protected API is denied — HTTP 401
PASS  authenticated /api/control/overview remains policy-pending — HTTP 403; code=POLICY_PENDING
PASS  authenticated /api/control/businesses remains policy-pending — HTTP 403; code=POLICY_PENDING
PASS  authenticated /control pending state 320x568 — HTTP 200; content=true; noHorizontalOverflow=true; pageErrors=0
PASS  browser page is on the expected application origin — page=http://localhost:39429; app=http://localhost:39429
PASS  valid same-origin business suspension is explicitly denied by pending policy — HTTP 403; code=POLICY_PENDING; error=Control access remains disabled. The owner-approved policy denies all 90 role/capability combinations.
PASS  denied mutation leaves disposable business unchanged — status=PENDING
PASS  journey provisions no Control grant — before=0; after=0
PASS  denied API action emits no misleading success audit event — before=0; after=0
PASS  authenticated /control pending state 360x800 — HTTP 200; content=true; noHorizontalOverflow=true; pageErrors=0
PASS  authenticated /control pending state 390x844 — HTTP 200; content=true; noHorizontalOverflow=true; pageErrors=0
PASS  authenticated /control pending state 430x932 — HTTP 200; content=true; noHorizontalOverflow=true; pageErrors=0
PASS  authenticated /control pending state 768x1024 — HTTP 200; content=true; noHorizontalOverflow=true; pageErrors=0
PASS  authenticated /control pending state 1366x768 — HTTP 200; content=true; noHorizontalOverflow=true; pageErrors=0
PASS  no application success audit event persisted for denied journey — before=0; after=0
```

### Production HTTP isolation smoke

```
PASS /dev/motion-preview?preference=immersive: production returns 404
PASS /dev/motion-preview?preference=immersive: no fixture storefront/canvas data in response HTML
PASS /dev/motion-preview?preference=immersive: production DENY survives ARENA_LIVE_PREVIEW=1
PASS /dev/immersive-preview: production returns 404
PASS /dev/immersive-preview: no fixture storefront/canvas data in response HTML
PASS /dev/immersive-preview: production DENY survives ARENA_LIVE_PREVIEW=1
PASS /dev/media-preview: production returns 404
PASS /dev/media-preview: no fixture storefront/canvas data in response HTML
PASS /dev/media-preview: production DENY survives ARENA_LIVE_PREVIEW=1
9 passed, 0 failed, 0 skipped. Temporary server stopped. Not a deployment/database/provider check.
```

### Authenticated production HTTP/browser/DB journey (synthetic entitlement, no provider)

```
PASS isolated seeded canonical Website Studio plan
PASS anonymous private API refused
PASS retail: actual HTTP registration
PASS retail: server-issued HttpOnly/Secure/SameSite session
PASS retail: JWT not accessible to browser JS
PASS retail: owner saves own business profile
PASS retail: actual tenant catalogue write
PASS retail: safe structured creation through HTTP (201) — status=201, format=2
PASS retail: registered category recipe is seeded with real catalogue source
PASS retail: authenticated guarded edit
PASS retail: monotonic draft revision
PASS retail: draft not automatically published
PASS retail: customer cannot see draft-query content
PASS retail: publish UI returns 403
PASS retail: unpaid refusal is financial, not an incomplete fixture
PASS retail: actual design UI save
PASS retail: saved UI content and draft revision persist
PASS retail: stale edit refused without overwrite
PASS retail: raw unsupported recipe/authority config refused without overwrite
PASS retail: actual recipe detail UI save off
PASS retail: recipe v1 detail persists without publication
PASS retail: preview marker exists in authoritative draft — draftVersion=4; marker=QA first retail 21da65eb
PASS retail: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS retail: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS retail: private preview faithfully hides owner-disabled recipe fact
PASS retail: actual recipe detail UI save on
PASS retail: recipe v1 detail persists without publication
PASS retail: preview marker exists in authoritative draft — draftVersion=5; marker=QA first retail 21da65eb
PASS retail: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS retail: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS retail: private preview faithfully shows owner-enabled recipe fact
PASS retail: actual recipe layout UI save
PASS retail: recipe v1 registered layout persists without publication
PASS retail: preview marker exists in authoritative draft — draftVersion=6; marker=QA first retail 21da65eb
PASS retail: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS retail: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS retail: private preview faithfully applies owner-selected registered recipe layout
PASS retail: recipe editing does not alter authoritative prices or require dummy rows
PASS retail: preview does not publish
PASS retail: synthetic stored entitlement recognized — status=200, entitled=true, failed=
PASS retail: publish UI returns 200
PASS retail: exact reviewed content/version published and snapshotted — review=6, published=6, history=6
PASS retail: customer sees content
PASS retail: explicit Lite customer page has no Motion/Three download
PASS retail: no-JS mobile real catalogue/contact HTML
PASS retail: no-JS mobile recipe/correct facts readable without overflow
PASS retail: no-JS mobile owner-selected recipe presentation
PASS retail: real tenant call/WhatsApp/directions paths
PASS retail: customer catalogue has functional category recipe and real fact
PASS retail: published owner-selected recipe presentation
PASS retail: actual category-appropriate availability filter
PASS retail: actual search/no-match/recovery preserves owned item and price
PASS retail: authenticated guarded edit
PASS retail: monotonic draft revision
PASS retail: preview marker exists in authoritative draft — draftVersion=7; marker=QA unpublished retail 21da65eb
PASS retail: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS retail: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS retail: customer cannot see draft-query content
PASS retail: preview/live snapshot isolation
PASS retail: published restore is draft-only/monotonic
PASS retail: live item reads real scoped catalogue
PASS retail: touch-size customer cart is visible with correct price
PASS retail: browser HTTP quote ignores forged prices
PASS retail: provider-free gate creates no customer payment/order
PASS food: actual HTTP registration
PASS food: server-issued HttpOnly/Secure/SameSite session
PASS food: JWT not accessible to browser JS
PASS food: owner saves own business profile
PASS food: actual tenant catalogue write
PASS food: safe structured creation through HTTP (201) — status=201, format=2
PASS food: registered category recipe is seeded with real catalogue source
PASS food: authenticated guarded edit
PASS food: monotonic draft revision
PASS food: draft not automatically published
PASS food: customer cannot see draft-query content
PASS food: publish UI returns 403
PASS food: unpaid refusal is financial, not an incomplete fixture
PASS food: actual design UI save
PASS food: saved UI content and draft revision persist
PASS food: stale edit refused without overwrite
PASS food: raw unsupported recipe/authority config refused without overwrite
PASS food: actual recipe detail UI save off
PASS food: recipe v1 detail persists without publication
PASS food: preview marker exists in authoritative draft — draftVersion=4; marker=QA first food 21da65eb
PASS food: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS food: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS food: private preview faithfully hides owner-disabled recipe fact
PASS food: actual recipe detail UI save on
PASS food: recipe v1 detail persists without publication
PASS food: preview marker exists in authoritative draft — draftVersion=5; marker=QA first food 21da65eb
PASS food: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS food: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS food: private preview faithfully shows owner-enabled recipe fact
PASS food: actual recipe layout UI save
PASS food: recipe v1 registered layout persists without publication
PASS food: preview marker exists in authoritative draft — draftVersion=6; marker=QA first food 21da65eb
PASS food: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS food: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS food: private preview faithfully applies owner-selected registered recipe layout
PASS food: recipe editing does not alter authoritative prices or require dummy rows
PASS food: preview does not publish
PASS food: synthetic stored entitlement recognized — status=200, entitled=true, failed=
PASS food: publish UI returns 200
PASS food: exact reviewed content/version published and snapshotted — review=6, published=6, history=6
PASS food: customer sees content
PASS food: explicit Lite customer page has no Motion/Three download
PASS food: no-JS mobile real catalogue/contact HTML
PASS food: no-JS mobile recipe/correct facts readable without overflow
PASS food: no-JS mobile owner-selected recipe presentation
PASS food: real tenant call/WhatsApp/directions paths
PASS food: customer catalogue has functional category recipe and real fact
PASS food: published owner-selected recipe presentation
PASS food: actual category-appropriate availability filter
PASS food: actual search/no-match/recovery preserves owned item and price
PASS food: authenticated guarded edit
PASS food: monotonic draft revision
PASS food: preview marker exists in authoritative draft — draftVersion=7; marker=QA unpublished food 21da65eb
PASS food: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS food: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS food: customer cannot see draft-query content
PASS food: preview/live snapshot isolation
PASS food: published restore is draft-only/monotonic
PASS food: live item reads real scoped catalogue
PASS food: touch-size customer cart is visible with correct price
PASS food: browser HTTP quote ignores forged prices
PASS food: provider-free gate creates no customer payment/order
PASS salon: actual HTTP registration
PASS salon: server-issued HttpOnly/Secure/SameSite session
PASS salon: JWT not accessible to browser JS
PASS salon: owner saves own business profile
PASS salon: actual tenant catalogue write
PASS salon: safe structured creation through HTTP (201) — status=201, format=2
PASS salon: registered category recipe is seeded with real catalogue source
PASS salon: authenticated guarded edit
PASS salon: monotonic draft revision
PASS salon: draft not automatically published
PASS salon: customer cannot see draft-query content
PASS salon: publish UI returns 403
PASS salon: unpaid refusal is financial, not an incomplete fixture
PASS salon: actual design UI save
PASS salon: saved UI content and draft revision persist
PASS salon: stale edit refused without overwrite
PASS salon: raw unsupported recipe/authority config refused without overwrite
PASS salon: actual recipe detail UI save off
PASS salon: recipe v1 detail persists without publication
PASS salon: preview marker exists in authoritative draft — draftVersion=4; marker=QA first salon 21da65eb
PASS salon: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS salon: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS salon: private preview faithfully hides owner-disabled recipe fact
PASS salon: actual recipe detail UI save on
PASS salon: recipe v1 detail persists without publication
PASS salon: preview marker exists in authoritative draft — draftVersion=5; marker=QA first salon 21da65eb
PASS salon: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS salon: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS salon: private preview faithfully shows owner-enabled recipe fact
PASS salon: actual recipe layout UI save
PASS salon: recipe v1 registered layout persists without publication
PASS salon: preview marker exists in authoritative draft — draftVersion=6; marker=QA first salon 21da65eb
PASS salon: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS salon: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS salon: private preview faithfully applies owner-selected registered recipe layout
PASS salon: recipe editing does not alter authoritative prices or require dummy rows
PASS salon: preview does not publish
PASS salon: synthetic stored entitlement recognized — status=200, entitled=true, failed=
PASS salon: publish UI returns 200
PASS salon: exact reviewed content/version published and snapshotted — review=6, published=6, history=6
PASS salon: customer sees content
PASS salon: explicit Lite customer page has no Motion/Three download
PASS salon: no-JS mobile real catalogue/contact HTML
PASS salon: no-JS mobile recipe/correct facts readable without overflow
PASS salon: no-JS mobile owner-selected recipe presentation
PASS salon: real tenant call/WhatsApp/directions paths
PASS salon: customer catalogue has functional category recipe and real fact
PASS salon: published owner-selected recipe presentation
PASS salon: no irrelevant stock/cart assumptions in service recipe
PASS salon: actual duration filter restores owned service
PASS salon: actual search/no-match/recovery preserves owned item and price
PASS salon: authenticated guarded edit
PASS salon: monotonic draft revision
PASS salon: preview marker exists in authoritative draft — draftVersion=7; marker=QA unpublished salon 21da65eb
PASS salon: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS salon: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS salon: customer cannot see draft-query content
PASS salon: preview/live snapshot isolation
PASS salon: published restore is draft-only/monotonic
PASS salon: live item reads real scoped catalogue
PASS salon: actual server offers configured future slot — status=200, slots=["11:00","14:00"]
PASS salon: booking UI has actual selected slot/customer fields — {"selectedTime":true,"namePresent":true,"phonePresent":true}
PASS salon: actual browser booking (zero deposit, no provider)
PASS salon: customer booking persists with real tenant/service and unpaid state
PASS salon: authenticated owner receives the browser booking
PASS professional: actual HTTP registration
PASS professional: server-issued HttpOnly/Secure/SameSite session
PASS professional: JWT not accessible to browser JS
PASS professional: owner saves own business profile
PASS professional: actual tenant catalogue write
PASS professional: actual fixed consultation write, not a dummy Product
PASS professional: safe structured creation through HTTP (201) — status=201, format=2
PASS professional: registered category recipe is seeded with real catalogue source
PASS professional: authenticated guarded edit
PASS professional: monotonic draft revision
PASS professional: draft not automatically published
PASS professional: anonymous unpublished enquiry refused without a ledger write — status=404, leads=0, error="This business is not accepting enquiries right now."
PASS professional: owned draft enquiry form is readable/noindex but submission disabled
PASS professional: customer cannot see draft-query content
PASS professional: publish UI returns 403
PASS professional: unpaid refusal is financial, not an incomplete fixture
PASS professional: actual design UI save
PASS professional: saved UI content and draft revision persist
PASS professional: stale edit refused without overwrite
PASS professional: raw unsupported recipe/authority config refused without overwrite
PASS professional: actual recipe detail UI save off
PASS professional: recipe v1 detail persists without publication
PASS professional: preview marker exists in authoritative draft — draftVersion=4; marker=QA first professional 21da65eb
PASS professional: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS professional: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS professional: private preview faithfully hides owner-disabled recipe fact
PASS professional: actual recipe detail UI save on
PASS professional: recipe v1 detail persists without publication
PASS professional: preview marker exists in authoritative draft — draftVersion=5; marker=QA first professional 21da65eb
PASS professional: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS professional: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS professional: private preview faithfully shows owner-enabled recipe fact
PASS professional: actual recipe layout UI save
PASS professional: recipe v1 registered layout persists without publication
PASS professional: preview marker exists in authoritative draft — draftVersion=6; marker=QA first professional 21da65eb
PASS professional: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS professional: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS professional: private preview faithfully applies owner-selected registered recipe layout
PASS professional: recipe editing does not alter authoritative prices or require dummy rows
PASS professional: preview does not publish
PASS professional: synthetic stored entitlement recognized — status=200, entitled=true, failed=
PASS professional: publish UI returns 200
PASS professional: exact reviewed content/version published and snapshotted — review=6, published=6, history=6
PASS professional: customer sees content
PASS professional: explicit Lite customer page has no Motion/Three download
PASS professional: no-JS mobile real catalogue/contact HTML
PASS professional: no-JS mobile recipe/correct facts readable without overflow
PASS professional: no-JS mobile owner-selected recipe presentation
PASS professional: real tenant call/WhatsApp/directions paths
PASS professional: customer catalogue has functional category recipe and real fact
PASS professional: published owner-selected recipe presentation
PASS professional: no irrelevant stock/cart assumptions in service recipe
PASS professional: short-duration filter selects actual consultation, not unpriced quote work
PASS professional: actual duration filter restores owned service
PASS professional: actual search/no-match/recovery preserves owned item and price
PASS professional: authenticated guarded edit
PASS professional: monotonic draft revision
PASS professional: preview marker exists in authoritative draft — draftVersion=7; marker=QA unpublished professional 21da65eb
PASS professional: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS professional: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS professional: customer cannot see draft-query content
PASS professional: preview/live snapshot isolation
PASS professional: published restore is draft-only/monotonic
PASS professional: live item reads real scoped catalogue
PASS professional: quote facet selects owned request-only service
PASS professional: booking facet selects actual fixed-price consultation
PASS professional: actual request-only form has no fake date/slots/price and correct owned service
PASS professional: actual browser enquiry acknowledged only after persistence
PASS professional: request persists with exact tenant/service/contact, no appointment or marketing
PASS professional: unchanged browser request replay returns same durable ID once
PASS professional: changed retry refused without overwrite
PASS professional: anonymous ledger read cannot leak customer contacts
PASS professional: forged tenant/amount/confirmation fields refused
PASS professional: foreign service cannot be attached to request
PASS professional: authenticated owner receives durable request, no raw replay metadata
PASS professional: actual owner enquiry board receives browser request
PASS professional: enquiry creates no booking/order/payment or dummy Product
PASS professional: old quote booking entry routes to enquiry instead of unreachable slots
PASS professional: no-JS mobile request facts/contact fallback readable
PASS professional: fixed consultation still uses server availability
PASS professional: actual fixed zero-deposit appointment retains existing booking flow
PASS professional: fixed booking belongs to real consultation and stays unpaid/provider-free
PASS technical: actual HTTP registration
PASS technical: server-issued HttpOnly/Secure/SameSite session
PASS technical: JWT not accessible to browser JS
PASS technical: owner saves own business profile
PASS technical: actual tenant catalogue write
PASS technical: actual fixed consultation write, not a dummy Product
PASS technical: safe structured creation through HTTP (201) — status=201, format=2
PASS technical: registered category recipe is seeded with real catalogue source
PASS technical: authenticated guarded edit
PASS technical: monotonic draft revision
PASS technical: draft not automatically published
PASS technical: anonymous unpublished enquiry refused without a ledger write — status=404, leads=0, error="This business is not accepting enquiries right now."
PASS technical: owned draft enquiry form is readable/noindex but submission disabled
PASS technical: customer cannot see draft-query content
PASS technical: publish UI returns 403
PASS technical: unpaid refusal is financial, not an incomplete fixture
PASS technical: actual design UI save
PASS technical: saved UI content and draft revision persist
PASS technical: stale edit refused without overwrite
PASS technical: raw unsupported recipe/authority config refused without overwrite
PASS technical: actual recipe detail UI save off
PASS technical: recipe v1 detail persists without publication
PASS technical: preview marker exists in authoritative draft — draftVersion=4; marker=QA first technical 21da65eb
PASS technical: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS technical: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS technical: private preview faithfully hides owner-disabled recipe fact
PASS technical: actual recipe detail UI save on
PASS technical: recipe v1 detail persists without publication
PASS technical: preview marker exists in authoritative draft — draftVersion=5; marker=QA first technical 21da65eb
PASS technical: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS technical: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS technical: private preview faithfully shows owner-enabled recipe fact
PASS technical: actual recipe layout UI save
PASS technical: recipe v1 registered layout persists without publication
PASS technical: preview marker exists in authoritative draft — draftVersion=6; marker=QA first technical 21da65eb
PASS technical: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS technical: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS technical: private preview faithfully applies owner-selected registered recipe layout
PASS technical: recipe editing does not alter authoritative prices or require dummy rows
PASS technical: preview does not publish
PASS technical: synthetic stored entitlement recognized — status=200, entitled=true, failed=
PASS technical: publish UI returns 200
PASS technical: exact reviewed content/version published and snapshotted — review=6, published=6, history=6
PASS technical: customer sees content
PASS technical: explicit Lite customer page has no Motion/Three download
PASS technical: no-JS mobile real catalogue/contact HTML
PASS technical: no-JS mobile recipe/correct facts readable without overflow
PASS technical: no-JS mobile owner-selected recipe presentation
PASS technical: real tenant call/WhatsApp/directions paths
PASS technical: customer catalogue has functional category recipe and real fact
PASS technical: published owner-selected recipe presentation
PASS technical: no irrelevant stock/cart assumptions in service recipe
PASS technical: short-duration filter selects actual consultation, not unpriced quote work
PASS technical: actual duration filter restores owned service
PASS technical: actual search/no-match/recovery preserves owned item and price
PASS technical: authenticated guarded edit
PASS technical: monotonic draft revision
PASS technical: preview marker exists in authoritative draft — draftVersion=7; marker=QA unpublished technical 21da65eb
PASS technical: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS technical: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS technical: customer cannot see draft-query content
PASS technical: preview/live snapshot isolation
PASS technical: published restore is draft-only/monotonic
PASS technical: live item reads real scoped catalogue
PASS technical: quote facet selects owned request-only service
PASS technical: booking facet selects actual fixed-price consultation
PASS technical: actual request-only form has no fake date/slots/price and correct owned service
PASS technical: actual browser enquiry acknowledged only after persistence
PASS technical: request persists with exact tenant/service/contact, no appointment or marketing
PASS technical: unchanged browser request replay returns same durable ID once
PASS technical: changed retry refused without overwrite
PASS technical: anonymous ledger read cannot leak customer contacts
PASS technical: forged tenant/amount/confirmation fields refused
PASS technical: foreign service cannot be attached to request
PASS technical: authenticated owner receives durable request, no raw replay metadata
PASS technical: actual owner enquiry board receives browser request
PASS technical: enquiry creates no booking/order/payment or dummy Product
PASS technical: old quote booking entry routes to enquiry instead of unreachable slots
PASS technical: no-JS mobile request facts/contact fallback readable
PASS technical: fixed consultation still uses server availability
PASS technical: actual fixed zero-deposit appointment retains existing booking flow
PASS technical: fixed booking belongs to real consultation and stays unpaid/provider-free
PASS farm: actual HTTP registration
PASS farm: server-issued HttpOnly/Secure/SameSite session
PASS farm: JWT not accessible to browser JS
PASS farm: owner saves own business profile
PASS farm: actual tenant catalogue write
PASS farm: safe structured creation through HTTP (201) — status=201, format=2
PASS farm: registered category recipe is seeded with real catalogue source
PASS farm: authenticated guarded edit
PASS farm: monotonic draft revision
PASS farm: draft not automatically published
PASS farm: customer cannot see draft-query content
PASS farm: publish UI returns 403
PASS farm: unpaid refusal is financial, not an incomplete fixture
PASS farm: actual design UI save
PASS farm: saved UI content and draft revision persist
PASS farm: stale edit refused without overwrite
PASS farm: raw unsupported recipe/authority config refused without overwrite
PASS farm: actual recipe detail UI save off
PASS farm: recipe v1 detail persists without publication
PASS farm: preview marker exists in authoritative draft — draftVersion=4; marker=QA first farm 21da65eb
PASS farm: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS farm: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS farm: private preview faithfully hides owner-disabled recipe fact
PASS farm: actual recipe detail UI save on
PASS farm: recipe v1 detail persists without publication
PASS farm: preview marker exists in authoritative draft — draftVersion=5; marker=QA first farm 21da65eb
PASS farm: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS farm: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS farm: private preview faithfully shows owner-enabled recipe fact
PASS farm: actual recipe layout UI save
PASS farm: recipe v1 registered layout persists without publication
PASS farm: preview marker exists in authoritative draft — draftVersion=6; marker=QA first farm 21da65eb
PASS farm: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS farm: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS farm: private preview faithfully applies owner-selected registered recipe layout
PASS farm: recipe editing does not alter authoritative prices or require dummy rows
PASS farm: preview does not publish
PASS farm: synthetic stored entitlement recognized — status=200, entitled=true, failed=
PASS farm: publish UI returns 200
PASS farm: exact reviewed content/version published and snapshotted — review=6, published=6, history=6
PASS farm: customer sees content
PASS farm: explicit Lite customer page has no Motion/Three download
PASS farm: no-JS mobile real catalogue/contact HTML
PASS farm: no-JS mobile recipe/correct facts readable without overflow
PASS farm: no-JS mobile owner-selected recipe presentation
PASS farm: real tenant call/WhatsApp/directions paths
PASS farm: customer catalogue has functional category recipe and real fact
PASS farm: published owner-selected recipe presentation
PASS farm: actual category-appropriate availability filter
PASS farm: actual search/no-match/recovery preserves owned item and price
PASS farm: authenticated guarded edit
PASS farm: monotonic draft revision
PASS farm: preview marker exists in authoritative draft — draftVersion=7; marker=QA unpublished farm 21da65eb
PASS farm: Mobile authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":388,"widthCap":390,"frameWidth":388,"overflow":false}
PASS farm: Desktop authenticated draft iframe/readable/noindex — {"noindex":true,"notice":true,"width":1230,"widthCap":1280,"frameWidth":1230,"overflow":false}
PASS farm: customer cannot see draft-query content
PASS farm: preview/live snapshot isolation
PASS farm: published restore is draft-only/monotonic
PASS farm: live item reads real scoped catalogue
PASS farm: touch-size customer cart is visible with correct price
PASS farm: browser HTTP quote ignores forged prices
PASS farm: provider-free gate creates no customer payment/order
PASS retail: actual SSR UTC home
PASS retail: actual SSR UTC /item/cmwazz5uq000bb95qztepdra1
PASS retail: actual SSR UTC /shop
PASS retail: actual SSR Africa/Nairobi home
PASS retail: actual SSR Africa/Nairobi /item/cmwazz5uq000bb95qztepdra1
PASS retail: actual SSR Africa/Nairobi /shop
PASS retail: actual SSR America/New_York home
PASS retail: actual SSR America/New_York /item/cmwazz5uq000bb95qztepdra1
PASS retail: actual SSR America/New_York /shop
PASS food: actual SSR UTC home
PASS food: actual SSR UTC /item/cmwazzmtp002nb95qg45xqxk5
PASS food: actual SSR UTC /shop
PASS food: actual SSR Africa/Nairobi home
PASS food: actual SSR Africa/Nairobi /item/cmwazzmtp002nb95qg45xqxk5
PASS food: actual SSR Africa/Nairobi /shop
PASS food: actual SSR America/New_York home
PASS food: actual SSR America/New_York /item/cmwazzmtp002nb95qg45xqxk5
PASS food: actual SSR America/New_York /shop
PASS salon: actual SSR UTC home
PASS salon: actual SSR UTC /item/cmwb002gv004zb95qwx58b1kc
PASS salon: actual SSR UTC /book
PASS salon: actual SSR/client calendar identical in UTC
PASS salon: actual SSR Africa/Nairobi home
PASS salon: actual SSR Africa/Nairobi /item/cmwb002gv004zb95qwx58b1kc
PASS salon: actual SSR Africa/Nairobi /book
PASS salon: actual SSR/client calendar identical in Africa/Nairobi
PASS salon: actual SSR America/New_York home
PASS salon: actual SSR America/New_York /item/cmwb002gv004zb95qwx58b1kc
PASS salon: actual SSR America/New_York /book
PASS salon: actual SSR/client calendar identical in America/New_York
PASS professional: actual SSR UTC home
PASS professional: actual SSR UTC /item/cmwb00jxk007hb95qpyc03h5c
PASS professional: actual SSR UTC /shop
PASS professional: actual SSR UTC /enquire
PASS professional: actual SSR UTC /book
PASS professional: actual SSR/client calendar identical in UTC
PASS professional: actual SSR Africa/Nairobi home
PASS professional: actual SSR Africa/Nairobi /item/cmwb00jxk007hb95qpyc03h5c
PASS professional: actual SSR Africa/Nairobi /shop
PASS professional: actual SSR Africa/Nairobi /enquire
PASS professional: actual SSR Africa/Nairobi /book
PASS professional: actual SSR/client calendar identical in Africa/Nairobi
PASS professional: actual SSR America/New_York home
PASS professional: actual SSR America/New_York /item/cmwb00jxk007hb95qpyc03h5c
PASS professional: actual SSR America/New_York /shop
PASS professional: actual SSR America/New_York /enquire
PASS professional: actual SSR America/New_York /book
PASS professional: actual SSR/client calendar identical in America/New_York
PASS technical: actual SSR UTC home
PASS technical: actual SSR UTC /item/cmwb014w600adb95q8y36q7xf
PASS technical: actual SSR UTC /shop
PASS technical: actual SSR UTC /enquire
PASS technical: actual SSR UTC /book
PASS technical: actual SSR/client calendar identical in UTC
PASS technical: actual SSR Africa/Nairobi home
PASS technical: actual SSR Africa/Nairobi /item/cmwb014w600adb95q8y36q7xf
PASS technical: actual SSR Africa/Nairobi /shop
PASS technical: actual SSR Africa/Nairobi /enquire
PASS technical: actual SSR Africa/Nairobi /book
PASS technical: actual SSR/client calendar identical in Africa/Nairobi
PASS technical: actual SSR America/New_York home
PASS technical: actual SSR America/New_York /item/cmwb014w600adb95q8y36q7xf
PASS technical: actual SSR America/New_York /shop
PASS technical: actual SSR America/New_York /enquire
PASS technical: actual SSR America/New_York /book
PASS technical: actual SSR/client calendar identical in America/New_York
PASS farm: actual SSR UTC home
PASS farm: actual SSR UTC /item/cmwb01qj700d9b95qjcjv2r3y
PASS farm: actual SSR UTC /shop
PASS farm: actual SSR Africa/Nairobi home
PASS farm: actual SSR Africa/Nairobi /item/cmwb01qj700d9b95qjcjv2r3y
PASS farm: actual SSR Africa/Nairobi /shop
PASS farm: actual SSR America/New_York home
PASS farm: actual SSR America/New_York /item/cmwb01qj700d9b95qjcjv2r3y
PASS farm: actual SSR America/New_York /shop
PASS cross-tenant GET /api/experience refused
PASS cross-tenant PATCH /api/experience refused
PASS cross-tenant PATCH /api/experience refused
PASS cross-tenant POST /api/experience/publish refused
PASS cross-tenant GET /api/experience/versions refused
PASS cross-tenant GET /api/experience/history refused
PASS cross-tenant GET /api/studio/health refused
PASS cross-tenant GET /api/bookings refused
PASS cross-tenant GET /api/storefront/enquiry refused
PASS cross-tenant GET /api/storefront/enquiry refused
PASS cross-tenant attempts do not mutate foreign draft/live
PASS foreign owner workspace is not-found/noindex and does not leak its design
PASS food: customer cannot see draft-query content
PASS representative business types have distinct rendered information architectures (not palette/family labels) — distinct=6/6; groups=[["retail"],["food"],["salon"],["professional"],["technical"],["farm"]]
PASS expired entitlement refuses publish and preserves content
PASS logout removes server cookie and private API access
PASS real UI password login succeeds
PASS real cookie login restores only own workspace
HYDRATION SAMPLE {"category":"retail","route":"/dashboard/businesses/cmwazz5tb0003b95quh1676rd/preview","attempt":1,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":269,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3049 theme-root@3749 theme-root@3837 theme-root@4537 theme-root@4627 body@5667 state-div@5731 cmt-$@5746 route-root@5837 main@9676 cmt-$@21875 r-script@21961 nextF@21997 nextF@22011 nextF@22056 theme-root@22591","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"retail","route":"/dashboard/businesses/cmwazz5tb0003b95quh1676rd/preview","attempt":2,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":272,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3049 theme-root@3749 theme-root@3837 theme-root@4537 theme-root@4627 body@5667 state-div@5731 cmt-$@5746 route-root@5837 main@9676 cmt-$@21875 r-script@21961 nextF@21997 nextF@22011 nextF@22056 theme-root@22591","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"retail","route":"/dashboard/businesses/cmwazz5tb0003b95quh1676rd/preview","attempt":3,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":275,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3049 theme-root@3749 theme-root@3837 theme-root@4537 theme-root@4627 body@5667 state-div@5731 cmt-$@5746 route-root@5837 main@9676 cmt-$@21875 r-script@21961 nextF@21997 nextF@22011 nextF@22056 theme-root@22591","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"food","route":"/dashboard/businesses/cmwazzmt0002fb95qaq5uul3u/preview","attempt":1,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":278,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,catalogue,cmt-$,r-script,nextF,nextF,nextF","rawOffsets":"theme-root@3025 theme-root@3725 theme-root@3813 theme-root@4513 theme-root@4603 body@5643 state-div@5707 cmt-$@5722 route-root@5813 main@9621 catalogue@11023 cmt-$@22911 r-script@22997 nextF@23033 nextF@23047 nextF@23092","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"food","route":"/dashboard/businesses/cmwazzmt0002fb95qaq5uul3u/preview","attempt":2,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":282,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,catalogue,cmt-$,r-script,nextF,nextF,nextF","rawOffsets":"theme-root@3025 theme-root@3725 theme-root@3813 theme-root@4513 theme-root@4603 body@5643 state-div@5707 cmt-$@5722 route-root@5813 main@9621 catalogue@11023 cmt-$@22911 r-script@22997 nextF@23033 nextF@23047 nextF@23092","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"food","route":"/dashboard/businesses/cmwazzmt0002fb95qaq5uul3u/preview","attempt":3,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":285,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,catalogue,cmt-$,r-script,nextF,nextF,nextF","rawOffsets":"theme-root@3025 theme-root@3725 theme-root@3813 theme-root@4513 theme-root@4603 body@5643 state-div@5707 cmt-$@5722 route-root@5813 main@9621 catalogue@11023 cmt-$@22911 r-script@22997 nextF@23033 nextF@23047 nextF@23092","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"salon","route":"/dashboard/businesses/cmwb002g5004rb95qm5sv6e24/preview","attempt":1,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":288,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3037 theme-root@3737 theme-root@3825 theme-root@4525 theme-root@4615 body@5655 state-div@5719 cmt-$@5734 route-root@5825 main@9738 cmt-$@22590 r-script@22676 nextF@22712 nextF@22726 nextF@22771 theme-root@23306","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"salon","route":"/dashboard/businesses/cmwb002g5004rb95qm5sv6e24/preview","attempt":2,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":292,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3037 theme-root@3737 theme-root@3825 theme-root@4525 theme-root@4615 body@5655 state-div@5719 cmt-$@5734 route-root@5825 main@9738 cmt-$@22590 r-script@22676 nextF@22712 nextF@22726 nextF@22771 theme-root@23306","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"salon","route":"/dashboard/businesses/cmwb002g5004rb95qm5sv6e24/preview","attempt":3,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":296,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3037 theme-root@3737 theme-root@3825 theme-root@4525 theme-root@4615 body@5655 state-div@5719 cmt-$@5734 route-root@5825 main@9738 cmt-$@22590 r-script@22676 nextF@22712 nextF@22726 nextF@22771 theme-root@23306","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"professional","route":"/dashboard/businesses/cmwb00jwv0079b95qdtnlgwc2/preview","attempt":1,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":299,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3121 theme-root@3821 theme-root@3909 theme-root@4609 theme-root@4699 body@5739 state-div@5803 cmt-$@5818 route-root@5909 main@9911 cmt-$@22068 r-script@22154 nextF@22190 nextF@22204 nextF@22249 theme-root@22784","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"professional","route":"/dashboard/businesses/cmwb00jwv0079b95qdtnlgwc2/preview","attempt":2,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":302,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3121 theme-root@3821 theme-root@3909 theme-root@4609 theme-root@4699 body@5739 state-div@5803 cmt-$@5818 route-root@5909 main@9911 cmt-$@22068 r-script@22154 nextF@22190 nextF@22204 nextF@22249 theme-root@22784","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"professional","route":"/dashboard/businesses/cmwb00jwv0079b95qdtnlgwc2/preview","attempt":3,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":305,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3121 theme-root@3821 theme-root@3909 theme-root@4609 theme-root@4699 body@5739 state-div@5803 cmt-$@5818 route-root@5909 main@9911 cmt-$@22068 r-script@22154 nextF@22190 nextF@22204 nextF@22249 theme-root@22784","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"technical","route":"/dashboard/businesses/cmwb014v900a5b95qc95n0nll/preview","attempt":1,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":309,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3085 theme-root@3785 theme-root@3873 theme-root@4573 theme-root@4663 body@5703 state-div@5767 cmt-$@5782 route-root@5873 main@9842 cmt-$@23016 r-script@23102 nextF@23138 nextF@23152 nextF@23197 theme-root@23732","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"technical","route":"/dashboard/businesses/cmwb014v900a5b95qc95n0nll/preview","attempt":2,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":313,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3085 theme-root@3785 theme-root@3873 theme-root@4573 theme-root@4663 body@5703 state-div@5767 cmt-$@5782 route-root@5873 main@9842 cmt-$@23016 r-script@23102 nextF@23138 nextF@23152 nextF@23197 theme-root@23732","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
HYDRATION SAMPLE {"category":"technical","route":"/dashboard/businesses/cmwb014v900a5b95qc95n0nll/preview","attempt":3,"throttle":4,"page":"own-owner","ok":true,"order":"div,div,div,script#_R_,script,script,next-route-announcer","rawSeq":317,"rawStatus":200,"rawOrder":"theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-root,main,cmt-$,r-script,nextF,nextF,nextF,theme-root","rawOffsets":"theme-root@3085 theme-root@3785 theme-root@3873 theme-root@4573 theme-root@4663 body@5703 state-div@5767 cmt-$@5782 route-root@5873 main@9842 cmt-$@23016 r-script@23102 nextF@23138 nextF@23152 nextF@23197 theme-root@23732","rawBodyHead":"<body class=\"min-h-screen bg-zinc-50 text-zinc-900 antialiased\"><div hidden=\"\"><!--$--><!--/$--></div><div class=\"jata-p"}
M418 DIAG XTENANT {"kind":"cross-tenant","business":"food","session":"first-owner","route":"/dashboard/businesses/cmwazzmt0002fb95qaq5uul3u/preview","status":200,"markerSeen":false,"diag":{"iframePresent":false,"topUrl":"/dashboard/businesses/cmwazzmt0002fb95qaq5uul3u/preview","topReadyState":"complete","iframes":0,"bodyChildren":28,"bodyTextLength":17681,"markerInTopDocument":false,"passwordFields":0,"nextErrorOverlay":false,"scripts":20,"topTextHead":"◐AppearanceLime Spark / GraphiteChoose your JATA themeLime Spark / GraphiteEnergetic, modern, and action-oriented with a"}}
PASS food: another tenant's session cannot read this draft preview — {"status":200,"markerSeen":false}
M418 DIAG XTENANT {"kind":"positive-control","business":"food","session":"own-owner","route":"/dashboard/businesses/cmwazzmt0002fb95qaq5uul3u/preview","status":200,"markerSeen":true}
PASS food: owning session still reads its own draft preview (control) — {"status":200,"markerSeen":true}
M418 DIAG XTENANT {"kind":"cross-tenant","business":"salon","session":"first-owner","route":"/dashboard/businesses/cmwb002g5004rb95qm5sv6e24/preview","status":200,"markerSeen":false,"diag":{"iframePresent":false,"topUrl":"/dashboard/businesses/cmwb002g5004rb95qm5sv6e24/preview","topReadyState":"complete","iframes":0,"bodyChildren":28,"bodyTextLength":17681,"markerInTopDocument":false,"passwordFields":0,"nextErrorOverlay":false,"scripts":20,"topTextHead":"◐AppearanceLime Spark / GraphiteChoose your JATA themeLime Spark / GraphiteEnergetic, modern, and action-oriented with a"}}
PASS salon: another tenant's session cannot read this draft preview — {"status":200,"markerSeen":false}
M418 DIAG XTENANT {"kind":"positive-control","business":"salon","session":"own-owner","route":"/dashboard/businesses/cmwb002g5004rb95qm5sv6e24/preview","status":200,"markerSeen":true}
PASS salon: owning session still reads its own draft preview (control) — {"status":200,"markerSeen":true}
M418 DIAG XTENANT {"kind":"cross-tenant","business":"professional","session":"first-owner","route":"/dashboard/businesses/cmwb00jwv0079b95qdtnlgwc2/preview","status":200,"markerSeen":false,"diag":{"iframePresent":false,"topUrl":"/dashboard/businesses/cmwb00jwv0079b95qdtnlgwc2/preview","topReadyState":"complete","iframes":0,"bodyChildren":28,"bodyTextLength":17681,"markerInTopDocument":false,"passwordFields":0,"nextErrorOverlay":false,"scripts":20,"topTextHead":"◐AppearanceLime Spark / GraphiteChoose your JATA themeLime Spark / GraphiteEnergetic, modern, and action-oriented with a"}}
PASS professional: another tenant's session cannot read this draft preview — {"status":200,"markerSeen":false}
M418 DIAG XTENANT {"kind":"positive-control","business":"professional","session":"own-owner","route":"/dashboard/businesses/cmwb00jwv0079b95qdtnlgwc2/preview","status":200,"markerSeen":true}
PASS professional: owning session still reads its own draft preview (control) — {"status":200,"markerSeen":true}
M418 DIAG XTENANT {"kind":"cross-tenant","business":"technical","session":"first-owner","route":"/dashboard/businesses/cmwb014v900a5b95qc95n0nll/preview","status":200,"markerSeen":false,"diag":{"iframePresent":false,"topUrl":"/dashboard/businesses/cmwb014v900a5b95qc95n0nll/preview","topReadyState":"complete","iframes":0,"bodyChildren":28,"bodyTextLength":17681,"markerInTopDocument":false,"passwordFields":0,"nextErrorOverlay":false,"scripts":20,"topTextHead":"◐AppearanceLime Spark / GraphiteChoose your JATA themeLime Spark / GraphiteEnergetic, modern, and action-oriented with a"}}
PASS technical: another tenant's session cannot read this draft preview — {"status":200,"markerSeen":false}
M418 DIAG XTENANT {"kind":"positive-control","business":"technical","session":"own-owner","route":"/dashboard/businesses/cmwb014v900a5b95qc95n0nll/preview","status":200,"markerSeen":true}
PASS technical: owning session still reads its own draft preview (control) — {"status":200,"markerSeen":true}
M418 DIAG XTENANT {"kind":"cross-tenant","business":"farm","session":"first-owner","route":"/dashboard/businesses/cmwb01qhs00d1b95qg6f2tfj0/preview","status":200,"markerSeen":false,"diag":{"iframePresent":false,"topUrl":"/dashboard/businesses/cmwb01qhs00d1b95qg6f2tfj0/preview","topReadyState":"complete","iframes":0,"bodyChildren":28,"bodyTextLength":17681,"markerInTopDocument":false,"passwordFields":0,"nextErrorOverlay":false,"scripts":20,"topTextHead":"◐AppearanceLime Spark / GraphiteChoose your JATA themeLime Spark / GraphiteEnergetic, modern, and action-oriented with a"}}
PASS farm: another tenant's session cannot read this draft preview — {"status":200,"markerSeen":false}
M418 DIAG XTENANT {"kind":"positive-control","business":"farm","session":"own-owner","route":"/dashboard/businesses/cmwb01qhs00d1b95qg6f2tfj0/preview","status":200,"markerSeen":true}
PASS farm: owning session still reads its own draft preview (control) — {"status":200,"markerSeen":true}
PASS SSR body order: hydration bootstrap scripts never lead the content (M11 #418 regression) — {"status":"PASS","checked":15,"required":15,"inverted":[]}
PASS no original uploads/media writes introduced
PASS no external/provider/disallowed browser requests — []
PASS no uncaught browser runtime errors — []
PASS retail: exact-id fixture cleanup
PASS food: exact-id fixture cleanup
PASS salon: exact-id fixture cleanup
PASS professional: exact-id fixture cleanup
PASS technical: exact-id fixture cleanup
PASS farm: exact-id fixture cleanup
M418E BEGIN 26 buffered evidence lines
M418 DIAG XTENANT {"kind":"cross-tenant","business":"food","session":"first-owner","route":"/dashboard/businesses/cmwazzmt0002fb95qaq5uul3u/preview","status":200,"markerSeen":
M418 DIAG XTENANT {"kind":"positive-control","business":"food","session":"own-owner","route":"/dashboard/businesses/cmwazzmt0002fb95qaq5uul3u/preview","status":200,"markerSeen
M418 DIAG XTENANT {"kind":"cross-tenant","business":"salon","session":"first-owner","route":"/dashboard/businesses/cmwb002g5004rb95qm5sv6e24/preview","status":200,"markerSeen"
M418 DIAG XTENANT {"kind":"positive-control","business":"salon","session":"own-owner","route":"/dashboard/businesses/cmwb002g5004rb95qm5sv6e24/preview","status":200,"markerSee
M418 DIAG XTENANT {"kind":"cross-tenant","business":"professional","session":"first-owner","route":"/dashboard/businesses/cmwb00jwv0079b95qdtnlgwc2/preview","status":200,"mark
M418 DIAG XTENANT {"kind":"positive-control","business":"professional","session":"own-owner","route":"/dashboard/businesses/cmwb00jwv0079b95qdtnlgwc2/preview","status":200,"ma
M418 DIAG XTENANT {"kind":"cross-tenant","business":"technical","session":"first-owner","route":"/dashboard/businesses/cmwb014v900a5b95qc95n0nll/preview","status":200,"markerS
M418 DIAG XTENANT {"kind":"positive-control","business":"technical","session":"own-owner","route":"/dashboard/businesses/cmwb014v900a5b95qc95n0nll/preview","status":200,"marke
M418 DIAG XTENANT {"kind":"cross-tenant","business":"farm","session":"first-owner","route":"/dashboard/businesses/cmwb01qhs00d1b95qg6f2tfj0/preview","status":200,"markerSeen":
M418 DIAG XTENANT {"kind":"positive-control","business":"farm","session":"own-owner","route":"/dashboard/businesses/cmwb01qhs00d1b95qg6f2tfj0/preview","status":200,"markerSeen
M418 GATE PASS: all required samples and checks passed
M418E PAIR dom=div,div,div,script#_R_,script,script,next-rout raw=theme-root,theme-root,theme-root,theme-root,th :: professional a3
M418E PAIR dom=div,div,div,script#_R_,script,script,next-rout raw=theme-root,theme-root,theme-root,theme-root,th :: technical a1
M418E PAIR dom=div,div,div,script#_R_,script,script,next-rout raw=theme-root,theme-root,theme-root,theme-root,th :: technical a2
M418E PAIR dom=div,div,div,script#_R_,script,script,next-rout raw=theme-root,theme-root,theme-root,theme-root,th :: technical a3
M418E RESP seq=271 len=53039 t:40057/b/qa-retail-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=272 len=53039 t:40057/b/qa-retail-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=274 len=53039 t:40057/b/qa-retail-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=275 len=53039 t:40057/b/qa-retail-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=284 len=56173 ost:40057/b/qa-food-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=285 len=56173 ost:40057/b/qa-food-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=320 len=56173 ost:40057/b/qa-food-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=321 len=56173 ost:40057/b/qa-food-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=295 len=55021 st:40057/b/qa-salon-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=296 len=55021 st:40057/b/qa-salon-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=324 len=55021 st:40057/b/qa-salon-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=325 len=55021 st:40057/b/qa-salon-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=304 len=53037 7/b/qa-professional-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=305 len=53037 7/b/qa-professional-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=328 len=53037 7/b/qa-professional-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=329 len=53037 7/b/qa-professional-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=316 len=55984 0057/b/qa-technical-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=317 len=55984 0057/b/qa-technical-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=332 len=55984 0057/b/qa-technical-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=333 len=55984 0057/b/qa-technical-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=336 len=54868 ost:40057/b/qa-farm-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E RESP seq=337 len=54868 ost:40057/b/qa-farm-21da65eb?preview=draft&v=0 :: theme-root,theme-root,theme-root,theme-root,theme-root,body,state-div,cmt-$,route-ro
M418E END
530 passed, 0 failed, 0 skipped. Authenticated production-HTTP/browser/native-DB checks; synthetic entitlement, NOT provider payment/physical Android/full engine proof. Temporary server stopped.
HYDRATION SAMPLES required=15 ok=15 failed=0 unresolved=0 missing=0 malformed=0 auxiliary=66 duplicates=0
M418 GATE PASS: all required samples and checks passed
```

### Actual isolated booking SSR/hydration (timezone/midnight)

```
PASS UTC: crawlable SSR date choices
PASS UTC: zero recoverable/uncaught hydration errors
PASS UTC: identical server/client calendar
PASS UTC: real accessible selection/form retained
PASS Nairobi: crawlable SSR date choices
PASS Nairobi: zero recoverable/uncaught hydration errors
PASS Nairobi: identical server/client calendar
PASS Nairobi: real accessible selection/form retained
PASS Kathmandu: crawlable SSR date choices
PASS Kathmandu: zero recoverable/uncaught hydration errors
PASS Kathmandu: identical server/client calendar
PASS Kathmandu: real accessible selection/form retained
PASS New York: crawlable SSR date choices
PASS New York: zero recoverable/uncaught hydration errors
PASS New York: identical server/client calendar
PASS New York: real accessible selection/form retained
PASS Auckland: crawlable SSR date choices
PASS Auckland: zero recoverable/uncaught hydration errors
PASS Auckland: identical server/client calendar
PASS Auckland: real accessible selection/form retained
PASS midnight rollover: crawlable SSR date choices
PASS midnight rollover: zero recoverable/uncaught hydration errors
PASS midnight rollover: identical server/client calendar
PASS midnight rollover: real accessible selection/form retained
PASS negative control: real mismatch detector fails closed
25 passed, 0 failed, 0 skipped. Actual isolated SSR/hydration; native/device/provider acceptance separate.
```

### Hydration #418 controlled race reproduction (widened $RC/$RV gap)

```
HYDRATION RACE RESULT {"synthetic":{"arms":[{"arm":"synthetic-leading-scripts","errors418":2,"recovered":["Minified React error #418; visit https://reactjs.org/docs/error-decoder.html?invariant=418 for the full message or use the non-minified dev environment for full","Minified React error #418; visit https://reactjs.org/docs/error-decoder.html?invariant=418 for the full message or use the non-minified dev environment for full"],"uncaught":[]},{"arm":"synthetic-parse-frontier","errors418":1,"recovered":["Minified React error #418; visit https://reactjs.org/docs/error-decoder.html?invariant=418 for the full message or use the non-minified dev environment for full","Minified React error #423; visit https://reactjs.org/docs/error-decoder.html?invariant=423 for the full message or use the non-minified dev environment for full"],"uncaught":[]},{"arm":"synthetic-control","errors418":0,"recovered":[],"uncaught":[]}]},"forced":{"iterations":8,"errors418":0,"otherErrors":0,"details":[]},"control":{"iterations":3,"errors418":0,"otherErrors":0,"details":[]}}
```

### Hydration replay-cursor regression (positive control + shipped runtime)

```
browser-side runtime: react 19.2.8 / react-dom 19.2.8
microtask       reproducing loads 5/5   server DOM discarded 5/5
timeout-0       reproducing loads 5/5   server DOM discarded 5/5
resolved-before reproducing loads 0/5   server DOM discarded 0/5
late-50ms       reproducing loads 0/5   server DOM discarded 0/5
PASS (positive control): 19.2.8 reproduces the defect in 10 load(s), so the harness still exercises the replay path.
browser-side runtime: react 19.3.0-canary-278794d7-20261002 / react-dom 19.3.0-canary-278794d7-20261002
microtask       reproducing loads 0/5   server DOM discarded 0/5
timeout-0       reproducing loads 0/5   server DOM discarded 0/5
resolved-before reproducing loads 0/5   server DOM discarded 0/5
late-50ms       reproducing loads 0/5   server DOM discarded 0/5
PASS: no reproducing arm reproduced and both controls stayed clean on 19.3.0-canary-278794d7-20261002.
```

### Actual Motion browser

```
PASS no JavaScript desktop: actual local synthetic illustration loaded
PASS no JavaScript desktop: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"ssr","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS no JavaScript desktop: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS no JavaScript desktop: no mini chunk or animation
PASS no JavaScript desktop: no uncaught page errors
PASS no JavaScript 360px phone: actual local synthetic illustration loaded
PASS no JavaScript 360px phone: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"ssr","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS no JavaScript 360px phone: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS no JavaScript 360px phone: no mini chunk or animation
PASS no JavaScript 360px phone: no uncaught page errors
PASS actual mini desktop: actual local synthetic illustration loaded
PASS actual mini desktop: no mini fetch before an eligible intersection
PASS actual mini desktop: real mini chunk and real native animate calls — requests=1, native calls=2
PASS actual mini desktop: heading, exact price, sections and core links remain readable — {"mode":"motion","engine":"mini","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":2,"cleanStyles":true,"overflow":0,"calls":2,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS actual mini desktop: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS actual mini desktop: scoped effects never touch the outside marker
PASS actual mini desktop: finite completion clears inline styles and animations — {"mode":"motion","engine":"mini","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":4,"cancels":8,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS actual mini desktop: no uncaught page errors
PASS actual mini touch phone: actual local synthetic illustration loaded
PASS actual mini touch phone: no mini fetch before an eligible intersection
PASS actual mini touch phone: real mini chunk and real native animate calls — requests=1, native calls=2
PASS actual mini touch phone: heading, exact price, sections and core links remain readable — {"mode":"motion","engine":"mini","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":2,"cleanStyles":true,"overflow":0,"calls":2,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS actual mini touch phone: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS actual mini touch phone: scoped effects never touch the outside marker
PASS actual mini touch phone: finite completion clears inline styles and animations — {"mode":"motion","engine":"mini","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":4,"cancels":8,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS touch commerce: primary tap target is at least44px — {"x":275.71875,"y":480.078125,"height":44,"width":64.28125}
PASS touch commerce: real cart adds without a motion-dependent action
PASS touch commerce: fixed cart is visible in viewport, not trapped by the theme root — {"top":238.40625,"bottom":740,"height":501.59375,"visible":true,"rootBackdrop":"none","headerPosition":"sticky"}
PASS touch commerce: quantity increases with exact149-unit subtotal298
PASS touch commerce: quantity decreases without changing catalogue price
PASS touch commerce: cart closes by touch, no hover/keyboard required
PASS actual mini touch phone: no uncaught page errors
PASS owner Lite: actual local synthetic illustration loaded
PASS owner Lite: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"owner-lite","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS owner Lite: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS owner Lite: zero mini download and native animation — owner-lite
PASS owner Lite: no uncaught page errors
PASS theme without motion: actual local synthetic illustration loaded
PASS theme without motion: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"owner-lite","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":0,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS theme without motion: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS theme without motion: zero mini download and native animation — owner-lite
PASS theme without motion: no uncaught page errors
PASS initial reduced motion: actual local synthetic illustration loaded
PASS initial reduced motion: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"reduced-motion","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS initial reduced motion: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS initial reduced motion: zero mini download and native animation — reduced-motion
PASS initial reduced motion: no uncaught page errors
PASS Save-Data: actual local synthetic illustration loaded
PASS Save-Data: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"save-data","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS Save-Data: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS Save-Data: zero mini download and native animation — save-data
PASS Save-Data: no uncaught page errors
PASS 3G signal: actual local synthetic illustration loaded
PASS 3G signal: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"slow-connection","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS 3G signal: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS 3G signal: zero mini download and native animation — slow-connection
PASS 3G signal: no uncaught page errors
PASS low memory: actual local synthetic illustration loaded
PASS low memory: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"low-resources","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS low memory: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS low memory: zero mini download and native animation — low-resources
PASS low memory: no uncaught page errors
PASS no IntersectionObserver: actual local synthetic illustration loaded
PASS no IntersectionObserver: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"observer-unavailable","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS no IntersectionObserver: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS no IntersectionObserver: zero mini download and native animation — observer-unavailable
PASS no IntersectionObserver: no uncaught page errors
PASS nested independent CSS scope: actual local synthetic illustration loaded
PASS owner Lite cannot force an independently owned nested scope static — {"animationName":"eb-motion-slide"}
PASS nested independent CSS scope: no uncaught page errors
PASS observer never fires: actual local synthetic illustration loaded
PASS observer never fires: heading, exact price, sections and core links remain readable — {"mode":"motion","engine":"idle","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS observer never fires: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS observer never fires: no hidden state or unnecessary mini fetch
PASS observer never fires: no uncaught page errors
PASS blocked mini chunk: actual local synthetic illustration loaded
PASS blocked mini chunk: heading, exact price, sections and core links remain readable — {"mode":"motion","engine":"css","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":1,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS blocked mini chunk: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS blocked mini chunk: actual finite CSS fallback, no mini animations
PASS blocked mini chunk: CSS animation finishes and content remains visible
PASS blocked mini chunk: no uncaught page errors
PASS hung mini chunk: actual local synthetic illustration loaded
PASS hung mini chunk: heading, exact price, sections and core links remain readable — {"mode":"motion","engine":"css","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":2,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS hung mini chunk: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS hung mini chunk: actual finite CSS fallback, no mini animations
PASS hung mini chunk: CSS animation finishes and content remains visible
PASS hung mini chunk: no uncaught page errors
PASS no Web Animations API: actual local synthetic illustration loaded
PASS no Web Animations API: heading, exact price, sections and core links remain readable — {"mode":"motion","engine":"css","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":1,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS no Web Animations API: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS no Web Animations API: actual finite CSS fallback, no mini animations
PASS no Web Animations API: CSS animation finishes and content remains visible
PASS no Web Animations API: no uncaught page errors
PASS no animation enumeration API: actual local synthetic illustration loaded
PASS no animation enumeration API: heading, exact price, sections and core links remain readable — {"mode":"motion","engine":"css","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS no animation enumeration API: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS no animation enumeration API: actual finite CSS fallback, no mini animations
PASS no animation enumeration API: CSS animation finishes and content remains visible
PASS no animation enumeration API: no uncaught page errors
PASS partial native animation failure: actual local synthetic illustration loaded
PASS partial native failure: heading, exact price, sections and core links remain readable — {"mode":"motion","engine":"css","reason":"eligible","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":1,"cleanStyles":true,"overflow":0,"calls":1,"cancels":1,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS partial native failure: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS partial native failure: started effect cancelled and CSS fallback used
PASS partial native failure: no residual animations or hidden content
PASS partial native animation failure: no uncaught page errors
PASS live reduced-motion preference: actual local synthetic illustration loaded
PASS live reduced motion: active effects cancelled and later sections stay still — {"mode":"lite","engine":"static","reason":"reduced-motion","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":2,"cancels":2,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS live reduced motion: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"reduced-motion","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":2,"cancels":2,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS live reduced motion: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS live reduced-motion preference: no uncaught page errors
PASS preference changes during lazy import: actual local synthetic illustration loaded
PASS lazy import race: no animation after reduced-motion change
PASS lazy import race: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"reduced-motion","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":0,"cancels":0,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS lazy import race: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS preference changes during lazy import: no uncaught page errors
PASS live network constraints: actual local synthetic illustration loaded
PASS live Save-Data: cancel active controls and retain content
PASS live 3G: remains Lite
PASS live network constraints: heading, exact price, sections and core links remain readable — {"mode":"lite","engine":"static","reason":"slow-connection","heading":"Fresh coastal dishes","headingVisible":true,"price":"KES 149","priceVisible":true,"wrappers":5,"wrappersReadable":true,"activeAnimations":0,"cleanStyles":true,"overflow":0,"calls":2,"cancels":2,"outsideUnchanged":true,"hasShopLink":true,"hasCallLink":true,"hasWhatsAppLink":true,"canvasCount":0}
PASS live network constraints: no horizontal overflow, canvas or global motion flag — overflow=0px
PASS live network constraints: no uncaught page errors
PASS React scope unmount: actual local synthetic illustration loaded
PASS unmount: removed scope cannot animate after preference/network events — {"scopeAbsent":true,"calls":2,"cancels":2}
PASS React scope unmount: no uncaught page errors
124 passed, 0 failed, 0 skipped. Physical Android, production LCP/INP/CLS, real payments/providers NOT RUN by this script.
```

### Immersive browser regression

```
PASS  static first paint: image in server HTML without JavaScript
PASS  3D: decision is eligible and renders  ({"reason":"eligible","mode":"3d","canvasCount":1,"canvasVisible":true,"imageVisible":false})
PASS  3D: canvas visible and static image removed  ({"reason":"eligible","mode":"3d","canvasCount":1,"canvasVisible":true,"imageVisible":false})
PASS  3D: model fetched over HTTPS  (requests=2)
PASS  3D: no uncaught page errors
PASS  failed load: reason model-load-failed, static image, no canvas  ({"reason":"model-load-failed","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  no WebGL: reason no-webgl, static image, no canvas  ({"reason":"no-webgl","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  reduced motion: reason reduced-motion, static image, no canvas  ({"reason":"reduced-motion","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  Save-Data: reason save-data, no canvas  ({"reason":"save-data","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  mobile 2 GB: reason low-memory, static image, no canvas  ({"reason":"low-memory","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  mobile memory unknown: reason memory-unknown, no canvas  ({"reason":"memory-unknown","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  opt-in: preference lite never shows 3D  ({"reason":"not-opted-in","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  opt-in: preference motion never shows 3D  ({"reason":"not-opted-in","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  opt-in: preference auto never shows 3D  ({"reason":"not-opted-in","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  unsafe: unsupported/unsafe GLB graph retains image, no canvas or uncaught errors  ({"reason":"model-load-failed","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  compressed: unsupported/unsafe GLB graph retains image, no canvas or uncaught errors  ({"reason":"model-load-failed","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  reduce: live change disposes3D and restores static immediately  ({"reason":"reduced-motion","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  save-data: live change disposes3D and restores static immediately  ({"reason":"save-data","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  context loss: static image, removed canvas, no uncaught exception  ({"reason":"model-load-failed","mode":"static","canvasCount":0,"canvasVisible":false,"imageVisible":true})
PASS  turntable: finite8-second budget stops actual GPU draws  (draws=483->483)
PASS  manual keyboard: orbit renders on demand after automatic budget  (draws=483->484)
PASS  manual touch: orbit works without hover/keyboard  (draws=484->485)
22 passed, 0 failed, 0 skipped
```

### Responsive layout regression

```
PASS  phone 360x740: no horizontal overflow  (overflowX=0px)
PASS  phone 360x740: heading visible  (Immersive preview (development harness))
PASS  phone 360x740: product image visible
PASS  desktop 1280x800: no horizontal overflow  (overflowX=0px)
PASS  desktop 1280x800: heading visible  (Immersive preview (development harness))
PASS  desktop 1280x800: product image visible
PASS  reduced motion (phone): content still visible, no overflow
7 passed, 0 failed, 0 skipped
```

### Registered family geometry/SSR/touch browser

```
PASS cinematic/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"cinematic","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--standard eb-hero--has-media","heroHeight":608,"body":"stack","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--spotlight","gallery":"panorama","galleryColumns":"450px 450px 450px 450px 450px 450px","chapters":0,"productStage":false}}
PASS cinematic/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS cinematic/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS cinematic/1280px desktop/no-JS: semantic chapter anchors resolve
PASS editorial/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"editorial","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":378,"body":"paired","gridColumns":"640px 640px","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"paired","galleryColumns":"282px 282px","chapters":0,"productStage":false}}
PASS editorial/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS editorial/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS editorial/1280px desktop/no-JS: semantic chapter anchors resolve
PASS luxury/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"luxury","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--centered eb-hero-treatment--standard eb-hero--has-media","heroHeight":523,"body":"paired","gridColumns":"640px 640px","catalogue":"eb-grid eb-grid--auto eb-catalog--spotlight","gallery":"paired","galleryColumns":"282px 282px","chapters":0,"productStage":false}}
PASS luxury/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS luxury/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS luxury/1280px desktop/no-JS: semantic chapter anchors resolve
PASS minimal/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"minimal","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--band eb-hero-treatment--standard eb-hero--has-media","heroHeight":363,"body":"stack","gridColumns":"none","catalogue":"eb-grid eb-grid--list","gallery":"grid","galleryColumns":"201.594px 201.594px 201.609px 201.594px 201.609px","chapters":0,"productStage":false}}
PASS minimal/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS minimal/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS minimal/1280px desktop/no-JS: semantic chapter anchors resolve
PASS magazine/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"magazine","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":378,"body":"magazine","gridColumns":"640px 640px","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"masonry","galleryColumns":"repeat(auto-fill, minmax(min(100%, 192px), 1fr))","chapters":0,"productStage":false}}
PASS magazine/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS magazine/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS magazine/1280px desktop/no-JS: semantic chapter anchors resolve
PASS marketplace/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"marketplace","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--band eb-hero-treatment--standard eb-hero--has-media","heroHeight":363,"body":"stack","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--grid","gallery":"strip","galleryColumns":"260px 260px 260px 260px 260px 260px","chapters":0,"productStage":false}}
PASS marketplace/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS marketplace/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS marketplace/1280px desktop/no-JS: semantic chapter anchors resolve
PASS product-first/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"product-first","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":378,"body":"stage","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--spotlight","gallery":"strip","galleryColumns":"260px 260px 260px 260px 260px 260px","chapters":0,"productStage":false}}
PASS product-first/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS product-first/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS product-first/1280px desktop/no-JS: semantic chapter anchors resolve
PASS storytelling/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"storytelling","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--standard eb-hero--has-media","heroHeight":608,"body":"chapters","gridColumns":"none","catalogue":"eb-grid eb-grid--list","gallery":"panorama","galleryColumns":"450px 450px 450px 450px 450px 450px","chapters":5,"productStage":false}}
PASS storytelling/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS storytelling/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS storytelling/1280px desktop/no-JS: semantic chapter anchors resolve
PASS spatial/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"spatial","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--centered eb-hero-treatment--stage eb-hero--has-media","heroHeight":523,"body":"stage","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"mosaic","galleryColumns":"344px 344px 344px","chapters":0,"productStage":true}}
PASS spatial/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS spatial/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS spatial/1280px desktop/no-JS: semantic chapter anchors resolve
PASS interactive-showroom/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"interactive-showroom","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--stage eb-hero--has-media","heroHeight":378,"body":"stage","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--carousel","gallery":"strip","galleryColumns":"260px 260px 260px 260px 260px 260px","chapters":0,"productStage":true}}
PASS interactive-showroom/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS interactive-showroom/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS interactive-showroom/1280px desktop/no-JS: semantic chapter anchors resolve
PASS gallery/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"gallery","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--standard eb-hero--has-media","heroHeight":608,"body":"magazine","gridColumns":"640px 640px","catalogue":"eb-grid eb-grid--auto eb-catalog--grid","gallery":"masonry","galleryColumns":"repeat(auto-fill, minmax(min(100%, 192px), 1fr))","chapters":0,"productStage":false}}
PASS gallery/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS gallery/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS gallery/1280px desktop/no-JS: semantic chapter anchors resolve
PASS split-screen/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"split-screen","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":378,"body":"paired","gridColumns":"640px 640px","catalogue":"eb-grid eb-grid--auto eb-catalog--grid","gallery":"paired","galleryColumns":"282px 282px","chapters":0,"productStage":false}}
PASS split-screen/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS split-screen/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS split-screen/1280px desktop/no-JS: semantic chapter anchors resolve
PASS fullscreen-media/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"fullscreen-media","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--poster eb-hero--has-media","heroHeight":704,"body":"stack","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"panorama","galleryColumns":"450px 450px 450px 450px 450px 450px","chapters":0,"productStage":false}}
PASS fullscreen-media/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS fullscreen-media/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS fullscreen-media/1280px desktop/no-JS: semantic chapter anchors resolve
PASS scrollytelling/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"scrollytelling","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--band eb-hero-treatment--standard eb-hero--has-media","heroHeight":363,"body":"chapters","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"paired","galleryColumns":"486.797px 486.812px","chapters":5,"productStage":false}}
PASS scrollytelling/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS scrollytelling/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS scrollytelling/1280px desktop/no-JS: semantic chapter anchors resolve
PASS cardless-immersive/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"cardless-immersive","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--stage eb-hero--has-media","heroHeight":608,"body":"stage","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"mosaic","galleryColumns":"344px 344px 344px","chapters":0,"productStage":true}}
PASS cardless-immersive/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS cardless-immersive/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS cardless-immersive/1280px desktop/no-JS: semantic chapter anchors resolve
PASS map-driven/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"map-driven","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":378,"body":"location-led","gridColumns":"none","catalogue":"eb-grid eb-grid--list","gallery":"paired","galleryColumns":"410px 410px","chapters":0,"productStage":false}}
PASS map-driven/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS map-driven/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS map-driven/1280px desktop/no-JS: semantic chapter anchors resolve
PASS catalog/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"catalog","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--band eb-hero-treatment--standard eb-hero--has-media","heroHeight":363,"body":"stack","gridColumns":"none","catalogue":"eb-comparison","gallery":"grid","galleryColumns":"201.594px 201.594px 201.609px 201.594px 201.609px","chapters":0,"productStage":false}}
PASS catalog/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS catalog/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS catalog/1280px desktop/no-JS: semantic chapter anchors resolve
PASS portfolio/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"portfolio","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":378,"body":"magazine","gridColumns":"640px 640px","catalogue":"eb-grid eb-grid--auto eb-catalog--spotlight","gallery":"masonry","galleryColumns":"repeat(auto-fill, minmax(min(100%, 192px), 1fr))","chapters":0,"productStage":false}}
PASS portfolio/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS portfolio/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS portfolio/1280px desktop/no-JS: semantic chapter anchors resolve
PASS service-journey/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"service-journey","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--centered eb-hero-treatment--standard eb-hero--has-media","heroHeight":523,"body":"chapters","gridColumns":"none","catalogue":"eb-grid eb-grid--list","gallery":"paired","galleryColumns":"486.797px 486.812px","chapters":5,"productStage":false}}
PASS service-journey/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS service-journey/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS service-journey/1280px desktop/no-JS: semantic chapter anchors resolve
PASS experimental/1280px desktop/no-JS: actual registered renderer and essential HTML — {"family":"experimental","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--centered eb-hero-treatment--standard eb-hero--has-media","heroHeight":523,"body":"magazine","gridColumns":"640px 640px","catalogue":"eb-grid eb-grid--auto eb-catalog--carousel","gallery":"mosaic","galleryColumns":"184px 184px 184px","chapters":0,"productStage":false}}
PASS experimental/1280px desktop/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS experimental/1280px desktop/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS experimental/1280px desktop/no-JS: semantic chapter anchors resolve
PASS cinematic/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"cinematic","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"stack","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--spotlight","gallery":"panorama","galleryColumns":"230px 230px 230px 230px 230px 230px","chapters":0,"productStage":false}}
PASS cinematic/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS cinematic/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS cinematic/360px phone/no-JS: semantic chapter anchors resolve
PASS editorial/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"editorial","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"paired","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"paired","galleryColumns":"320px","chapters":0,"productStage":false}}
PASS editorial/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS editorial/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS editorial/360px phone/no-JS: semantic chapter anchors resolve
PASS luxury/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"luxury","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--centered eb-hero-treatment--standard eb-hero--has-media","heroHeight":421,"body":"paired","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--spotlight","gallery":"paired","galleryColumns":"320px","chapters":0,"productStage":false}}
PASS luxury/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS luxury/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS luxury/360px phone/no-JS: semantic chapter anchors resolve
PASS minimal/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"minimal","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--band eb-hero-treatment--standard eb-hero--has-media","heroHeight":333,"body":"stack","gridColumns":"none","catalogue":"eb-grid eb-grid--list","gallery":"grid","galleryColumns":"320px","chapters":0,"productStage":false}}
PASS minimal/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS minimal/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS minimal/360px phone/no-JS: semantic chapter anchors resolve
PASS magazine/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"magazine","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"magazine","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"masonry","galleryColumns":"repeat(auto-fill, minmax(min(100%, 192px), 1fr))","chapters":0,"productStage":false}}
PASS magazine/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS magazine/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS magazine/360px phone/no-JS: semantic chapter anchors resolve
PASS marketplace/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"marketplace","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--band eb-hero-treatment--standard eb-hero--has-media","heroHeight":333,"body":"stack","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--grid","gallery":"strip","galleryColumns":"230px 230px 230px 230px 230px 230px","chapters":0,"productStage":false}}
PASS marketplace/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS marketplace/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS marketplace/360px phone/no-JS: semantic chapter anchors resolve
PASS product-first/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"product-first","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"stage","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--spotlight","gallery":"strip","galleryColumns":"230px 230px 230px 230px 230px 230px","chapters":0,"productStage":false}}
PASS product-first/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS product-first/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS product-first/360px phone/no-JS: semantic chapter anchors resolve
PASS storytelling/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"storytelling","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"chapters","gridColumns":"none","catalogue":"eb-grid eb-grid--list","gallery":"panorama","galleryColumns":"230px 230px 230px 230px 230px 230px","chapters":5,"productStage":false}}
PASS storytelling/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS storytelling/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS storytelling/360px phone/no-JS: semantic chapter anchors resolve
PASS spatial/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"spatial","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--centered eb-hero-treatment--stage eb-hero--has-media","heroHeight":421,"body":"stage","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"mosaic","galleryColumns":"320px","chapters":0,"productStage":true}}
PASS spatial/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS spatial/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS spatial/360px phone/no-JS: semantic chapter anchors resolve
PASS interactive-showroom/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"interactive-showroom","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--stage eb-hero--has-media","heroHeight":562,"body":"stage","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--carousel","gallery":"strip","galleryColumns":"230px 230px 230px 230px 230px 230px","chapters":0,"productStage":true}}
PASS interactive-showroom/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS interactive-showroom/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS interactive-showroom/360px phone/no-JS: semantic chapter anchors resolve
PASS gallery/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"gallery","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"magazine","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--grid","gallery":"masonry","galleryColumns":"repeat(auto-fill, minmax(min(100%, 192px), 1fr))","chapters":0,"productStage":false}}
PASS gallery/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS gallery/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS gallery/360px phone/no-JS: semantic chapter anchors resolve
PASS split-screen/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"split-screen","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"paired","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--grid","gallery":"paired","galleryColumns":"320px","chapters":0,"productStage":false}}
PASS split-screen/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS split-screen/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS split-screen/360px phone/no-JS: semantic chapter anchors resolve
PASS fullscreen-media/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"fullscreen-media","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--poster eb-hero--has-media","heroHeight":651,"body":"stack","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"panorama","galleryColumns":"230px 230px 230px 230px 230px 230px","chapters":0,"productStage":false}}
PASS fullscreen-media/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS fullscreen-media/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS fullscreen-media/360px phone/no-JS: semantic chapter anchors resolve
PASS scrollytelling/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"scrollytelling","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--band eb-hero-treatment--standard eb-hero--has-media","heroHeight":333,"body":"chapters","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"paired","galleryColumns":"320px","chapters":5,"productStage":false}}
PASS scrollytelling/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS scrollytelling/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS scrollytelling/360px phone/no-JS: semantic chapter anchors resolve
PASS cardless-immersive/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"cardless-immersive","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--overlay eb-hero-treatment--stage eb-hero--has-media","heroHeight":562,"body":"stage","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--editorial","gallery":"mosaic","galleryColumns":"320px","chapters":0,"productStage":true}}
PASS cardless-immersive/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS cardless-immersive/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS cardless-immersive/360px phone/no-JS: semantic chapter anchors resolve
PASS map-driven/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"map-driven","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"location-led","gridColumns":"none","catalogue":"eb-grid eb-grid--list","gallery":"paired","galleryColumns":"320px","chapters":0,"productStage":false}}
PASS map-driven/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS map-driven/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS map-driven/360px phone/no-JS: semantic chapter anchors resolve
PASS catalog/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"catalog","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--band eb-hero-treatment--standard eb-hero--has-media","heroHeight":333,"body":"stack","gridColumns":"none","catalogue":"eb-comparison","gallery":"grid","galleryColumns":"320px","chapters":0,"productStage":false}}
PASS catalog/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS catalog/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS catalog/360px phone/no-JS: semantic chapter anchors resolve
PASS portfolio/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"portfolio","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--split eb-hero-treatment--standard eb-hero--has-media","heroHeight":562,"body":"magazine","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--spotlight","gallery":"masonry","galleryColumns":"repeat(auto-fill, minmax(min(100%, 192px), 1fr))","chapters":0,"productStage":false}}
PASS portfolio/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS portfolio/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS portfolio/360px phone/no-JS: semantic chapter anchors resolve
PASS service-journey/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"service-journey","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--centered eb-hero-treatment--standard eb-hero--has-media","heroHeight":421,"body":"chapters","gridColumns":"none","catalogue":"eb-grid eb-grid--list","gallery":"paired","galleryColumns":"320px","chapters":5,"productStage":false}}
PASS service-journey/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS service-journey/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS service-journey/360px phone/no-JS: semantic chapter anchors resolve
PASS experimental/360px phone/no-JS: actual registered renderer and essential HTML — {"family":"experimental","heading":"Fresh coastal dishes","headingVisible":true,"priceVisible":true,"price":"KES 149","phone":true,"whatsapp":true,"shop":true,"readable":true,"overflow":0,"noCanvas":true,"imagesLoaded":true,"rootBackdrop":"none","anchorsValid":true,"geometry":{"hero":"eb-hero eb-hero--centered eb-hero-treatment--standard eb-hero--has-media","heroHeight":421,"body":"magazine","gridColumns":"none","catalogue":"eb-grid eb-grid--auto eb-catalog--carousel","gallery":"mosaic","galleryColumns":"320px","chapters":0,"productStage":false}}
PASS experimental/360px phone/no-JS: no horizontal page overflow or trapped fixed-container root — overflow=0
PASS experimental/360px phone/no-JS: local imagery, no GPU/mini/provider dependence — mini=0, external=0
PASS experimental/360px phone/no-JS: semantic chapter anchors resolve
PASS desktop geometry: all20 measured, substantially different structures — unique=20/20
PASS marketplace: touch cart visible with authoritative149-unit subtotal in Lite — {"top":238.40625,"bottom":740,"subtotal":"KES 149","mode":"lite"}
PASS marketplace: touch close and no uncaught errors
PASS interactive-showroom: touch cart visible with authoritative149-unit subtotal in Lite — {"top":238.40625,"bottom":740,"subtotal":"KES 149","mode":"lite"}
PASS interactive-showroom: touch close and no uncaught errors
PASS minimal: touch cart visible with authoritative149-unit subtotal in Lite — {"top":238.40625,"bottom":740,"subtotal":"KES 149","mode":"lite"}
PASS minimal: touch close and no uncaught errors
167 passed, 0 failed, 0 skipped. Original-media/provider acceptance BLOCKED by owner decision; not a physical device or 3D/provider proof.
```

### Local raster pixels (provider/persistence BLOCKED)

```
PASS bitmap decode EXIF1: exact rotation/mirroring, derivative dimensions, source unchanged {"width":80,"height":60,"colours":[[254,0,0,255],[0,255,1,255],[0,0,255,255],[255,255,0,255]],"alpha":255}
PASS bitmap decode EXIF2: exact rotation/mirroring, derivative dimensions, source unchanged {"width":80,"height":60,"colours":[[0,255,1,255],[254,0,0,255],[255,255,0,255],[0,0,255,255]],"alpha":255}
PASS bitmap decode EXIF3: exact rotation/mirroring, derivative dimensions, source unchanged {"width":80,"height":60,"colours":[[255,255,0,255],[0,0,255,255],[0,255,1,255],[254,0,0,255]],"alpha":255}
PASS bitmap decode EXIF4: exact rotation/mirroring, derivative dimensions, source unchanged {"width":80,"height":60,"colours":[[0,0,255,255],[255,255,0,255],[254,0,0,255],[0,255,1,255]],"alpha":255}
PASS bitmap decode EXIF5: exact rotation/mirroring, derivative dimensions, source unchanged {"width":60,"height":80,"colours":[[254,0,0,255],[0,0,255,255],[0,255,1,255],[255,255,0,255]],"alpha":255}
PASS bitmap decode EXIF6: exact rotation/mirroring, derivative dimensions, source unchanged {"width":60,"height":80,"colours":[[0,0,255,255],[254,0,0,255],[255,255,0,255],[0,255,1,255]],"alpha":255}
PASS bitmap decode EXIF7: exact rotation/mirroring, derivative dimensions, source unchanged {"width":60,"height":80,"colours":[[255,255,0,255],[0,255,1,255],[0,0,255,255],[254,0,0,255]],"alpha":255}
PASS bitmap decode EXIF8: exact rotation/mirroring, derivative dimensions, source unchanged {"width":60,"height":80,"colours":[[0,255,1,255],[255,255,0,255],[254,0,0,255],[0,0,255,255]],"alpha":255}
PASS bitmap image/png actual derivative "ok"
PASS bitmap image/webp actual derivative "ok"
PASS bitmap PNG alpha preserved
PASS bitmap source over5MB prepared, never returned as original
PASS bitmap truncated/MIME lie/cancel fail usefully
PASS bitmap monotonic local progress
PASS WebView image fallback EXIF1: exact rotation/mirroring, derivative dimensions, source unchanged {"width":80,"height":60,"colours":[[254,0,0,255],[0,255,1,255],[0,0,255,255],[255,255,0,255]],"alpha":255}
PASS WebView image fallback EXIF2: exact rotation/mirroring, derivative dimensions, source unchanged {"width":80,"height":60,"colours":[[0,255,1,255],[254,0,0,255],[255,255,0,255],[0,0,255,255]],"alpha":255}
PASS WebView image fallback EXIF3: exact rotation/mirroring, derivative dimensions, source unchanged {"width":80,"height":60,"colours":[[255,255,0,255],[0,0,255,255],[0,255,1,255],[254,0,0,255]],"alpha":255}
PASS WebView image fallback EXIF4: exact rotation/mirroring, derivative dimensions, source unchanged {"width":80,"height":60,"colours":[[0,0,255,255],[255,255,0,255],[254,0,0,255],[0,255,1,255]],"alpha":255}
PASS WebView image fallback EXIF5: exact rotation/mirroring, derivative dimensions, source unchanged {"width":60,"height":80,"colours":[[254,0,0,255],[0,0,255,255],[0,255,1,255],[255,255,0,255]],"alpha":255}
PASS WebView image fallback EXIF6: exact rotation/mirroring, derivative dimensions, source unchanged {"width":60,"height":80,"colours":[[0,0,255,255],[254,0,0,255],[255,255,0,255],[0,255,1,255]],"alpha":255}
PASS WebView image fallback EXIF7: exact rotation/mirroring, derivative dimensions, source unchanged {"width":60,"height":80,"colours":[[255,255,0,255],[0,255,1,255],[0,0,255,255],[254,0,0,255]],"alpha":255}
PASS WebView image fallback EXIF8: exact rotation/mirroring, derivative dimensions, source unchanged {"width":60,"height":80,"colours":[[0,255,1,255],[255,255,0,255],[254,0,0,255],[0,0,255,255]],"alpha":255}
PASS fallback image/png actual derivative "ok"
PASS fallback image/webp actual derivative "ok"
PASS fallback PNG alpha preserved
PASS fallback source over5MB prepared, never returned as original
PASS fallback truncated/MIME lie/cancel fail usefully
PASS fallback monotonic local progress
PASS no provider/upload/save/network mutation enabled blocked mutations=0
29 passed, 0 failed, 0 skipped. Local generated raster pixels only. Provider/persistent-original acceptance BLOCKED by owner; physical Android NOT RUN.
```

### Production gate / full dependency-audit status

```
PASS production dependency audit: 0 findings
FAIL full dependency audit: 8 findings (0 high, 8 moderate); exit=1
Open package paths: @typescript-eslint/eslint-plugin, @typescript-eslint/parser, @typescript-eslint/type-utils, @typescript-eslint/typescript-estree, @typescript-eslint/utils, eslint-config-next, minimatch, typescript-eslint
Full-security release acceptance stays OPEN while any finding remains; not provider/device/engine proof.

```

### Bundle evidence

```

> jata-aftercall@1.0.0 measure:studio-bundles
> node scripts/measure-website-studio-bundles.mjs

/b/[slug]/page: 215011 B gzip entry (+25720 B vs v2 baseline, 14 files)
/dashboard/businesses/[id]/design/page: 332411 B gzip entry (+20080 B vs v2 baseline, 27 files)
/page: 183400 B gzip entry (+4767 B vs v2 baseline, 9 files)
Lazy motion/mini: 3057 B gzip, 1 chunk(s), absent from initial business/design/home entries. Installed=14.1.0, lock=14.1.0.
Method v2 (Next 16): file sets differ from the archived v1 baseline by construction; only v2-to-v2 deltas are meaningful.
Not total runtime payload, Core Web Vitals or physical device measurements.

```

Native Prisma, lint/types, migrations, seed and production build passed. No skips permitted in the DB suites. Inherited expected failure is preserved, not fixed. Authenticated browser uses real Next HTTP/JWT cookies and disposable DB; paid entitlement is a synthetic fixture, not provider verification. Other browser catalogue/model data is synthetic/intercepted; mobile signals are simulated. Persistent-original storage/provider acceptance BLOCKED by owner deferral. No new real uploads/provider calls/spending enabled. Physical Android, live provider/payment operations and production Core Web Vitals NOT RUN. Full engine NOT COMPLETE, NOT MERGED, production NOT DEPLOYED.
