# Domain connection plan — HOSTAFRICA DNS → Vercel (`jata-aftercall`)

**Date:** 2026-10-27
**Task type:** read-only investigation + change plan, plus owner-approved **Phase A** (Vercel domain
attachment) executed on 2026-10-27.
**Status: NOT CONNECTED — DNS has not been changed.**

Evidence labels: **PASS** (verified with direct evidence), **FAIL** (verified as wrong),
**BLOCKED** (cannot proceed / no access), **NOT TESTED** (not attempted or not observable from this
environment), **DONE** (executed with approval).

### What changed in this session

| # | Action | Approval | Live effect |
| --- | --- | --- | --- |
| A1 | Added `jataaftercall.co.ke` to project `jata-aftercall` | Owner approved "Phase A only" | **None** — DNS still points at HOSTAFRICA (§4.3 evidence) |
| A2 | Added `www.jataaftercall.co.ke` to the same project | Owner approved | **None** |
| A3 | Captured Vercel's authoritative per-project records | Owner approved | n/a |

**No DNS record, nameserver, registrar setting, redirect, environment variable, deployment or
line of application code was changed.** Email is untouched.

---

## 0. Executive summary

| Question | Answer | Evidence |
| --- | --- | --- |
| Are the two domains attached to Vercel `jata-aftercall`? | **Yes — since 2026-10-27**, both `verified: true`. | **PASS** (project-domains API) |
| Are they attached to any other project? | **No.** One team, one project; both now belong to `jata-aftercall`. | **PASS** |
| Does Vercel consider them configured? | **No** — `misconfigured: true`, `configured_by: null`; DNS still `102.218.215.41`. | **PASS** |
| Vercel's authoritative required records | **Apex `A 216.198.79.1` + `A 64.29.17.1`; `www CNAME 2da49677b2414cfd.vercel-dns-017.com.`** | **PASS** (captured after attachment) |
| Are the pre-add generic values (`76.76.21.21`, `cname.vercel-dns.com`) correct? | **No — they are rank 2.** Using them would have been the wrong choice for this project. | **PASS** (ranked recommendation comparison) |
| What do the domains serve today? | HOSTAFRICA placeholder: *"webserver is functioning normally."* | **PASS** (live fetch) |
| Did Phase A change the live site or its generated URLs? | **No** — `robots.txt` still emits the `.vercel.app` sitemap origin. | **PASS** (empirical before/after) |
| Is the owner's DNS inventory complete? | **No — cannot be confirmed.** Matches public DNS for every record shown. | **BLOCKED** |
| Minimum website-only DNS change | **Two record sets**: apex A values replaced, `www` A → CNAME. | **PASS** |
| Does any mail record change? | **No.** MX, SPF, mail/smtp/pop/ftp, NS all untouched. | **PASS** |

**One genuine email-side side effect** (§5 R1): the SPF record's `+a` mechanism resolves the apex A
record, so after cutover Vercel's IPs become SPF-authorised. Delivery still works; the impersonation
surface widens slightly. Kept out of the change; listed as optional, separately-approved hardening.

---

## 1. Vercel state (measured)

Project: `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`), team `powerbot-1`
(`team_azd5tt6fZ2mt1v6Op6s5iJHv`), plan **Hobby**, Next.js, production branch `main`, production
deployment `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp` = **READY / PROMOTED** on `a04124d`.

### 1.1 Domains attached to the project — PASS

| Domain | Verified | Configured | Redirect |
| --- | --- | --- | --- |
| `jata-aftercall.vercel.app` | true | `null` | `null` |
| `jataaftercall.co.ke` | **true** | `null` | `null` (Phase C pending) |
| `www.jataaftercall.co.ke` | **true** | `null` | `null` (Phase C pending) |

### 1.2 Ownership verification — PASS, no TXT needed

Both domains returned `verified: true` immediately on attachment. `accepted_challenges: []`,
`txt_verified_at: null`, `ns_verified_at: null`, `intendedNameservers: []`. A
`verificationRecord` token (`ep1i4N8MXb`) exists on the account object, but **no `_vercel` TXT
record is required** — it becomes relevant only if a domain is removed and re-added, or if another
account claimed it. Nothing to add at HOSTAFRICA for verification.

### 1.3 Vercel's authoritative required records — PASS (this is the value the change must use)

`GET /v5/domains/<domain>/config`, now that the domains belong to the project, returns for **both**
hosts:

| Field | Value |
| --- | --- |
| `serviceType` | `external` (DNS stays at HOSTAFRICA) |
| `misconfigured` | **true** (expected — DNS not yet changed) |
| `configured_by` | `null` |
| `nameservers` | dan1–dan4.host-ww.net |
| `aValues` (observed today) | `102.218.215.41` |
| `cnames` (observed today) | *(none)* |
| `conflicts` / `accepted_challenges` | *(none)* |
| **`recommendedIPv4` rank 1** | **`216.198.79.1` and `64.29.17.1`** (two A records) |
| `recommendedIPv4` rank 2 | `76.76.21.21` |
| **`recommendedCNAME` rank 1** | **`2da49677b2414cfd.vercel-dns-017.com.`** |
| `recommendedCNAME` rank 2 | `cname.vercel-dns.com.` |

### 1.4 Why the provisional values were wrong — PASS (verified)

Before attachment, the same endpoint returned only the generic pair (`76.76.21.21` /
`cname.vercel-dns.com.`). After attachment, Vercel ranks the **project-specific** pair first: two
apex anycast IPs and a **project-unique** CNAME hash. This is exactly the trap flagged in the
earlier draft of this document, and it is why the DNS values were not hard-coded from a guide.

Consistency check: the project's `*.vercel.app` hostname resolves to `216.198.79.195` /
`64.29.17.195`, the same anycast family as the rank-1 apex IPs — corroborating, but the API value
recorded above is the authority.

**Superseded figures:** any earlier note (including §7 item 6 of
`docs/MASTER_BUILD_OWNER_REPORT_2026-10-27.md` and the `76.76.21.21` mention in
`docs/domain/JATA_AFTERCALL_DOMAIN_CHECKLIST_2026-10-27.md`) that recommends `76.76.21.21` or the
generic `cname.vercel-dns.com` is now out of date for this project. Use §1.3.

---

## 2. Current public DNS — measured (unchanged after Phase A)

Resolver `8.8.8.8`. Re-measured **after** Phase A: identical to the pre-change measurement.

| Name | Type | Value observed | Matches owner's panel text? |
| --- | --- | --- | --- |
| `jataaftercall.co.ke` | A | `102.218.215.41` | yes |
| `jataaftercall.co.ke` | AAAA | **none (NODATA)** | not listed — confirmed absent |
| `jataaftercall.co.ke` | CNAME | none | — |
| `jataaftercall.co.ke` | MX | `10 mail.jataaftercall.co.ke.` | yes |
| `jataaftercall.co.ke` | NS | `dan1`–`dan4.host-ww.net.` | yes |
| `jataaftercall.co.ke` | TXT | `v=spf1 +a +mx +include:spf.host-ww.net +include:spf.antispamcloud.com ip4:169.255.59.142 ~all` | yes |
| `jataaftercall.co.ke` | CAA | **none** | confirmed absent |
| `jataaftercall.co.ke` | SOA | `dan1.host-ww.net. hostmaster.jataaftercall.co.ke. 2026100802 3600 3600 1209600 1800` | not listed — **new** |
| `www` | A | `102.218.215.41` (**still an A record, no CNAME**) | yes |
| `mail` / `smtp` / `pop` / `ftp` | A | `102.218.215.41` | yes |

SOA serial `2026100802`: the zone was last published 2026-10-08 and has not changed since.

### 2.1 Records probed and confirmed absent — PASS

`webmail`, `cpanel`, `cpcalendars`, `cpcontacts`, `autodiscover`, `autoconfig`, `imap`, `pop3`,
`ns1`, `ns2`, `whm`, `remote`, `webdisk`, `portal`, `vpn`, `localhost`, `api`, `app`, `admin`,
`dev`, `staging`, `test`, `_dmarc`, `_domainkey`, `_acme-challenge`, `_acme-challenge.www`,
`_vercel`, `_atproto`, `_sip._tcp`, `_imaps._tcp`, `_submission._tcp` — no records of any type.

DKIM selectors probed, none found: `default`, `mail`, `dkim`, `k1`, `k2`, `hostingermail-a/b/c`,
`selector1`, `selector2`, `google`, `s1`, `s2`. No DMARC record exists.

### 2.2 HTTPS behaviour — PASS (content), NOT TESTED (certificate detail)

| URL | Observed |
| --- | --- |
| `https://jataaftercall.co.ke/` | TLS fetch succeeded → **"webserver is functioning normally"** (HOSTAFRICA) |
| `https://www.jataaftercall.co.ke/` | Same body; **no www→apex redirect is in force** |
| `https://jata-aftercall.vercel.app/` | TLS fetch succeeded → **the real JATA AFTERCALL landing page** |

Not observable here (**NOT TESTED**): certificate issuer, SAN, expiry, TLS versions, HSTS and
HTTP→HTTPS redirect codes. Local `curl`/`openssl` egress is blocked in this sandbox (even Vercel's
URL fails), so these must be measured by the owner from a normal network.

### 2.3 Why a full zone export was not obtained — BLOCKED

- No HOSTAFRICA connector, credential, API or panel session exists here, and none was requested.
  **No HOSTAFRICA access was used.**
- Direct queries to `dan1`–`dan4.host-ww.net` (UDP/53 to arbitrary IPs) time out; `AXFR` is
  therefore impossible from here. No DNSSEC (`DS`/`DNSKEY` NODATA), no wildcard.

**Inventory completeness: UNVERIFIED (BLOCKED).** Every record in the supplied panel text is
confirmed present and correctly valued — so the inventory is *consistent and not contradicted* —
but completeness cannot be proven without a zone export. The record types most likely to be missing
from a panel screenshot (AAAA, CAA, DMARC, DKIM, verification TXT) were all probed and none exist:
strong evidence, not proof.

---

## 3. Where the change lands

| Component | Today | After Phase B |
| --- | --- | --- |
| `https://jataaftercall.co.ke` | HOSTAFRICA placeholder | JATA app on Vercel (canonical) |
| `https://www.jataaftercall.co.ke` | HOSTAFRICA placeholder | JATA app → 308 redirect to apex (after Phase C) |
| `https://jata-aftercall.vercel.app` | JATA app | unchanged — rollback target |
| Inbound mail (`MX 10 mail.…`) | HOSTAFRICA | **unchanged** |
| `mail` / `smtp` / `pop` / `ftp` | HOSTAFRICA `102.218.215.41` | **unchanged** |
| DNS hosting / nameservers | HOSTAFRICA | **unchanged** (no NS move) |
| Registrar (KeNIC) | HOSTAFRICA | **unchanged** |

Deployment protection: `ssoProtection.deploymentType = "all_except_custom_domains"`, and the
production site is already publicly reachable at `jata-aftercall.vercel.app`. Attaching custom
domains does not widen exposure beyond what is already public — but once DNS moves, any unfinished
route becomes public **under the brand**, so confirm launch intent before Phase B.

---

## 4. Change plan

### 4.1 Phase A — Vercel attachment — **DONE (approved)**

| # | Action | Result |
| --- | --- | --- |
| A1 | Add `jataaftercall.co.ke` to project `jata-aftercall` | **DONE** — verified true, redirect null |
| A2 | Add `www.jataaftercall.co.ke` to project `jata-aftercall` | **DONE** — verified true, redirect null |
| A3 | Capture the exact per-project records | **DONE** — §1.3 |

Rollback for Phase A (if ever needed): remove the two domains from project settings. No DNS change,
no deployment change, `*.vercel.app` unaffected.

### 4.2 Phase A side-effect check — PASS

Adding a custom domain can change `VERCEL_PROJECT_PRODUCTION_URL`, which `lib/url.ts → getBaseUrl()`
feeds into `metadataBase` (`app/layout.tsx`), `app/robots.ts`, share/QR URLs, payment callbacks and
password-reset links. If that had flipped to the branded origin **before** DNS moved, every generated
link would have pointed at HOSTAFRICA's placeholder.

Empirical check after attachment: `https://jata-aftercall.vercel.app/robots.txt` still returns
`sitemap: https://jata-aftercall.vercel.app/sitemap.xml`. **No generated URL changed.** (Phase D is
still needed at cutover so links intentionally move to the branded origin.)

### 4.3 Phase B — HOSTAFRICA DNS (owner executes; website-only) — **PENDING APPROVAL**

Values below are the authoritative rank-1 values from §1.3. Re-read them from the domain card at
execution time and re-run `get_domain_config` immediately before editing; if the card differs from
this table, **the card wins** and this document must be corrected first.

| Host/name | Type | Existing record | Proposed record | Purpose | Email or hosting impact | Rollback action |
| --- | --- | --- | --- | --- | --- | --- |
| `@` (apex) | A | `102.218.215.41`, TTL 3600 | **`216.198.79.1`** TTL 300 | Serve the apex from Vercel (rank-1 anycast) | HOSTAFRICA website at the bare apex stops answering. **Inbound mail unaffected.** SPF `+a` shifts — see R1 | Restore `A @ 102.218.215.41` |
| `@` (apex) | A | *(none — second record)* | **`64.29.17.1`** TTL 300 | Second rank-1 anycast address, as Vercel specifies | as above | Delete the added record |
| `www` | A | `102.218.215.41`, TTL 3600 | **DELETE** (a CNAME cannot coexist with an A record) | Clear the conflicting record | None to email; `www` stops reaching HOSTAFRICA | Re-add `A www 102.218.215.41` |
| `www` | CNAME | *(none)* | **`2da49677b2414cfd.vercel-dns-017.com.`** TTL 300 | Project-unique Vercel target for the subdomain | None | Delete the CNAME |
| `@` | MX | `10 mail.jataaftercall.co.ke.` | **UNCHANGED** | Inbound mail | — | n/a — never modified |
| `mail` | A | `102.218.215.41` | **UNCHANGED** | MX target; IMAP/SMTP clients | — | n/a |
| `smtp` / `pop` / `ftp` | A | `102.218.215.41` | **UNCHANGED** | Mail/FTP client hostnames | — | n/a |
| `@` | TXT | existing SPF string | **UNCHANGED here** (hardening deferred — R1) | Sender authorisation | Untouched in this change | n/a |
| `@` | NS | `dan1`–`dan4.host-ww.net.` | **UNCHANGED** | DNS stays at HOSTAFRICA | — | n/a — **do not** move to Vercel |
| `@` | AAAA | *none* | **do not add** | — | Vercel does not support AAAA on externally-hosted custom domains; it splits traffic and can stall TLS | n/a |
| `@` | CAA | *none* | **do not add** | — | Absence is what allows automatic certificate issuance | n/a |
| `@` | TXT `_vercel` | *none* | **not needed** (§1.2) | — | Domain already verified | n/a |

**Minimum website-only change = three DNS edits:** add rank-1 apex A pair, remove the old apex A,
and replace `www` A with `www` CNAME. No mail record is touched.

Order: **lower TTLs → re-confirm card values → apex A → `www` A→CNAME → verify → restore TTL.**
Do the apex and `www` in the same maintenance window; do not leave `www` on HOSTAFRICA after the
apex moves, or the two hosts will serve different sites.

### 4.4 Phase C — canonical redirect (owner decided: **apex canonical**) — PENDING

The `www` domain is currently attached with `redirect: null`. Setting `www` → apex **308** in Vercel
is what completes D1. Not yet applied; it is a Vercel-only change with no DNS or email effect, and
applying it *before* DNS moves would have no effect on live traffic.

### 4.5 Phase D — origin/env alignment (separate approval; **not** part of "connect the domain")

Serving the domain needs no code change. These production values still reference the old origin and
will produce mixed-brand links if left alone at cutover:

| Touchpoint | Present state | Needed at go-live |
| --- | --- | --- |
| `lib/url.ts → getBaseUrl()` | `PUBLIC_BASE_URL` → `NEXTAUTH_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` | canonical origin must be explicit, not inherited |
| `PUBLIC_BASE_URL` | exists in Production/Preview, masked (`sensitive`) — **not read, not changed** | `https://jataaftercall.co.ke` |
| `NEXTAUTH_URL` | exists, masked — not changed | same canonical origin |
| `NEXT_PUBLIC_APP_URL` (`lib/qr.ts`, fallback `https://jata.co.ke`) | not confirmed set | set it; note the unrelated `jata.co.ke` fallback |
| `lib/payments/config.ts`, `lib/password-reset-email.ts` | derive from `PUBLIC_BASE_URL`/`NEXTAUTH_URL` | follow the canonical origin |
| Paystack dashboard callback/webhook URLs | owner-controlled | add the new origin; keep the old working |
| `scripts/ci/smoke-production.mjs` | `DEFAULT_PRODUCTION_ORIGIN = https://jata-aftercall.vercel.app` | point at the branded origin |
| `app/install/page.tsx` | hard-codes the `.vercel.app` host in copy | cosmetic follow-up |

`PUBLIC_BASE_URL`/`NEXTAUTH_URL` are `sensitive`: their values were **not** decrypted or changed.

---

## 5. Email preservation risks

| ID | Risk | Severity | Assessment |
| --- | --- | --- | --- |
| **R1** | **SPF `+a` changes meaning.** `+a` evaluates the apex A record, which becomes Vercel's IPs. | **Low–Medium** | **No delivery break.** HOSTAFRICA outbound stays authorised by `+mx` (MX → `mail.` → `102.218.215.41`), `include:spf.host-ww.net`, `include:spf.antispamcloud.com` and `ip4:169.255.59.142` — all untouched. Side effect: Vercel's shared IP range becomes SPF-authorised for the domain. Optional later hardening: drop `+a`, since `+mx` still covers `102.218.215.41`. Do not bundle with the cutover. |
| **R2** | **Panel / webmail reachability via the bare apex.** Owner answered **"not sure"** how HOSTAFRICA is reached. If it is a panel/webmail link built on `jataaftercall.co.ke`, that path stops pointing at HOSTAFRICA after cutover. | **Medium — pre-cutover step added** | Email flow is unaffected: IMAP/SMTP configured to `mail.jataaftercall.co.ke` keeps working because that record is unchanged. No `webmail.`/`cpanel.` records exist. **Action: before Phase B, record how the panel is reached and confirm it still works using a HOSTAFRICA hostname or `102.218.215.41`.** |
| **R3** | Inbound mail loss | **None** | MX, `mail` A and all mail client hostnames unchanged. |
| **R4** | DKIM/DMARC breakage | **None observed** | No `_dmarc` TXT and no DKIM record at 13 probed selectors. Any DKIM that *did* exist would live on `*._domainkey`, never on the apex `A`/`www` this plan edits. |
| **R5** | CAA blocking issuance | **None** | No CAA exists; none is added. |
| **R6** | Deliverability overall | **Unchanged** | No SPF/mail record is edited in Phase B. |
| **R7** | PTR/rDNS | **None** | No PTR needed or proposed. The panel showing no rDNS is correctly *not* a reason to create one for website hosting. |
| **R8** | Loss of webmail sending | **Low** | Sending is unaffected; only *panel access by apex hostname* is at risk (R2). |

**Bottom line:** website-only. Mail survives because every mail record is a separate name the plan
never edits. The only two things that genuinely change: where the apex *website* answers, and the
widened `+a` semantics in SPF.

---

## 6. Verification plan (after an approved Phase B)

| # | Check | Tool | Expected |
| --- | --- | --- | --- |
| V1 | `@` A resolves to both rank-1 IPs | `dig +short jataaftercall.co.ke A` | `216.198.79.1`, `64.29.17.1`; **no** `102.218.215.41` |
| V2 | `www` is a CNAME to the project target | `dig +short www.jataaftercall.co.ke CNAME` | `2da49677b2414cfd.vercel-dns-017.com.`; **no A remains at `www`** |
| V3 | No AAAA introduced | `dig +short jataaftercall.co.ke AAAA` | empty |
| V4 | Mail records byte-identical to §2 | `dig MX` / `dig TXT` before-after diff | **zero diff** |
| V5 | Vercel shows both domains "Valid Configuration", cert valid | Vercel Settings → Domains; `get_domain_config` | `misconfigured: false`, cert valid, auto-renew on |
| V6 | Cert issuer/SAN/expiry, HTTP→HTTPS redirect | `openssl s_client`, `curl -I` from a normal network | valid cert covering apex + www |
| V7 | `www` → apex 308, no loop | `curl -I https://www.jataaftercall.co.ke` | single 308 to the apex |
| V8 | App healthy on the branded origin | `https://jataaftercall.co.ke/health`, landing page | healthy payload; landing renders |
| V9 | Auth + links use the branded origin | login, password-reset link, QR/share URL | branded origin (requires Phase D) |
| V10 | Rollback target healthy | `https://jata-aftercall.vercel.app/` | unchanged |
| V11 | HOSTAFRICA panel still reachable | owner | reachable via hostname/IP |

Until V1–V5, V8 and V11 pass live, the correct status remains **NOT CONNECTED**.

---

## 7. Rollback plan

1. **Fast path (TTL 300, ~5 min):** HOSTAFRICA → restore `A @ 102.218.215.41`; delete both rank-1
   apex A records; delete the `www` CNAME; re-add `A www 102.218.215.41`.
2. **Slow path (TTL left at 3600):** same edits, up to ~1 h of stale resolvers.
3. **Vercel:** removing the domains is optional and independent — `*.vercel.app` never changes, so
   the site stays reachable throughout. Phase C redirect can simply be cleared.
4. **Mail:** nothing to roll back; no mail record was ever changed.
5. **Env vars (Phase D):** revert `PUBLIC_BASE_URL`/`NEXTAUTH_URL` and redeploy.
6. Record start/end times, before/after `dig` output, and per-resolver behaviour.

---

## 8. Blockers and open items

| # | Item | Status |
| --- | --- | --- |
| B1 | **No HOSTAFRICA access in this session** — no connector, credential or API. DNS cannot be edited here and the zone cannot be exported. | **BLOCKED** — owner executes Phase B, or supplies a zone export |
| B2 | Exact per-project A/CNAME values | **RESOLVED** — §1.3 |
| B3 | Canonical host | **RESOLVED** — apex canonical; `www` → apex 308 (Phase C) |
| B4 | How HOSTAFRICA panel/webmail is reached (R2) | **PENDING** — owner answered "not sure"; capture before Phase B |
| B5 | Direct authoritative DNS, `AXFR`, local TLS/cert inspection blocked by sandbox egress | **BLOCKED** — measure from a normal network |
| B6 | DKIM/DMARC outside the probed selectors | **NOT TESTED** (would still be untouched) |
| B7 | Phase D values (`PUBLIC_BASE_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, Paystack) masked/owner-side | **PENDING** — deliberately not read |
| B8 | TTL edit capability at HOSTAFRICA | **NOT TESTED** — if TTL is fixed at 3600, accept a slower rollback window |

---

## 9. Approval status

| Item | Status |
| --- | --- |
| A1 add `jataaftercall.co.ke` | **DONE (approved)** |
| A2 add `www.jataaftercall.co.ke` | **DONE (approved)** |
| A3 capture exact records | **DONE (approved)** — §1.3 |
| B1 lower TTL on `@ A` and `www A` to 300 | **AWAITING APPROVAL** |
| B2 replace apex `A 102.218.215.41` with `216.198.79.1` + `64.29.17.1` | **AWAITING APPROVAL** |
| B3 delete `www A`, add `www CNAME 2da49677b2414cfd.vercel-dns-017.com.` | **AWAITING APPROVAL** |
| B4 restore TTL to 3600 once stable | **AWAITING APPROVAL** |
| C1 set `www` → apex 308 in Vercel | **AWAITING APPROVAL** (owner chose apex canonical) |
| D1 align `PUBLIC_BASE_URL` / `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` / Paystack | **SEPARATE APPROVAL, LATER** |
| H1 remove `+a` from SPF (R1 hardening) | **SEPARATE APPROVAL, OPTIONAL** |
| Pre-cutover: confirm HOSTAFRICA panel access (R2/B4) | **OWNER ACTION BEFORE B1** |

**Explicitly excluded and not done:** no nameserver change, no registrar/KeNIC change, no registrar
redirects, no MX/SPF/DKIM/DMARC/mail/SMTP/POP/FTP modification, no AAAA/CAA creation, no hosting or
email cancellation, no code/deployment/database/billing change, no access to JATA Qi or TANYA-AI, and
no request for passwords, OTPs, tokens, cookies or recovery codes.

---

## 10. Status table (evidence labels, 2026-10-27)

| Check | Result | Evidence |
| --- | --- | --- |
| Vercel project identified | **PASS** | `prj_mXn1031amrZQo4gyaVumKS4FltjW`, team `powerbot-1`, Hobby |
| Custom domains attached | **PASS** | both attached, `verified: true` |
| Domains claimed by another project/account | **PASS** (none) | single team/project; attachment succeeded without challenge |
| Vercel required records (authoritative) | **PASS** | `216.198.79.1`, `64.29.17.1`, `2da49677b2414cfd.vercel-dns-017.com.` |
| Vercel domain validation | **PASS (evidence)** — still `misconfigured: true` pending DNS | config API, no conflicts/challenges |
| Public DNS matches supplied inventory | **PASS** | A/MX/NS/TXT/A match; SOA captured |
| Supplied inventory proven complete | **BLOCKED** | no zone export; authoritative queries/AXFR blocked |
| AAAA / CAA / DMARC / DKIM / verification TXT | **PASS** (none found) | ~30 names + 13 DKIM selectors probed |
| Phase A live-impact check | **PASS** (no change to site, DNS or generated URLs) | DNS re-measured; `robots.txt` origin unchanged |
| Current HTTPS content at apex/www | **PASS** (HOSTAFRICA placeholder) | live fetch |
| Certificate/TLS detail, redirect codes | **NOT TESTED** | sandbox egress blocks `curl`/openssl |
| Vercel app reachable at `*.vercel.app` | **PASS** | live fetch returns the JATA landing page |
| Production rollback target healthy | **PASS** | `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp` READY/PROMOTED |
| DNS change executed | **NOT DONE — BLOCKED on approval** | — |
| Email records changed | **NOT DONE** (none proposed) | — |
| Domain connected | **NO — do not claim connected** | apex/www still `102.218.215.41`; Vercel `misconfigured: true` |
