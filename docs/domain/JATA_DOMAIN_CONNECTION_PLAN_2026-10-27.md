# Domain connection plan — HOSTAFRICA DNS → Vercel (`jata-aftercall`)

**Date:** 2026-10-27
**Task type:** read-only investigation + change plan. **Nothing has been changed.**
**Status: NOT CONNECTED.** Neither `jataaftercall.co.ke` nor `www.jataaftercall.co.ke` is attached
to the Vercel project, and no DNS record has been touched. This document is the approval artefact.

Evidence labels used below: **PASS** (verified with direct evidence), **FAIL** (verified as wrong),
**BLOCKED** (cannot proceed / no access), **NOT TESTED** (not attempted or not observable from
this environment). No claim in this document is inferred from a generic Vercel guide where a
project-specific value is required.

---

## 0. Executive summary

| Question | Answer | Evidence |
| --- | --- | --- |
| Are the two domains attached to the Vercel project `jata-aftercall`? | **No.** The project lists exactly one domain: `jata-aftercall.vercel.app`. | **PASS** (Vercel project-domains API) |
| Are they attached to *any other* project/team on this Vercel account? | **No.** The account has one team and one project; the team's domain list is empty. | **PASS** (team domain list + project list) |
| Does Vercel currently consider them configured? | **No** — both are `misconfigured: true`, `configured_by: null`, pointing at HOSTAFRICA `102.218.215.41`. | **PASS** (Vercel domain-config API) |
| What do the domains serve today over HTTPS? | HOSTAFRICA's placeholder page: *"webserver is functioning normally."* Not the JATA app. | **PASS** (live fetch) |
| Is the owner's DNS inventory complete? | **No — cannot be confirmed.** It matches public DNS for every record shown, but a full zone export was not obtainable. | **BLOCKED** |
| Minimum website-only DNS change | **Two records**: apex `A` value change, and `www` `A` → `CNAME`. Nothing else. | **PASS** (analysis) |
| Is any mail record part of the proposed change? | **No.** MX, SPF, mail/smtp/pop/ftp, NS all stay exactly as they are. | **PASS** (plan) |
| Can this session execute the change? | **No.** No HOSTAFRICA access exists here, and none will be requested. Owner executes DNS. | **BLOCKED** |

**One genuine email-side side effect exists** (§5, risk R1): the existing SPF record uses `+a`,
which resolves to the *apex A record*. After cutover that mechanism begins authorising Vercel's
IPs. It does not break delivery, but it must be an informed decision, not a surprise.

---

## 1. What Vercel actually says for this project

Project: `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`), team `powerbot-1`
(`team_azd5tt6fZ2mt1v6Op6s5iJHv`), plan **Hobby**, framework Next.js, production branch `main`,
current production deployment `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp` = **READY / PROMOTED** on
commit `a04124d`.

### 1.1 Domains attached to the project — PASS

| Domain | Verified | Configured | Redirect |
| --- | --- | --- | --- |
| `jata-aftercall.vercel.app` | true | `null` | `null` |

No custom domain is present. **This is the single most important finding: the task cannot be a
"re-verify DNS" job — the domains were never added.**

### 1.2 Account-level domain search — PASS

The team domain list returns an empty array, and both `GET /v5/domains/<name>` calls return
`404 Domain name not found`. Therefore neither domain is claimed by any project on this account,
and the "in use by another Vercel account" verification (`_vercel` TXT) path is **not** expected
to trigger. (Scope caveat: this proves the answer for *this* Vercel account only; a different
person's Vercel account cannot be inspected, and no such claim was found.)

### 1.3 Vercel's own record recommendation for both hosts — PASS (pre-add values)

`GET /v5/domains/<domain>/config` for both hosts returns:

| Field | `jataaftercall.co.ke` | `www.jataaftercall.co.ke` |
| --- | --- | --- |
| `serviceType` | `external` (DNS stays at HOSTAFRICA) | `external` |
| `misconfigured` | **true** | **true** |
| `nameservers` | dan1–dan4.host-ww.net | dan1–dan4.host-ww.net |
| `aValues` (current, observed) | `102.218.215.41` | `102.218.215.41` |
| `cnames` | *(none)* | *(none)* |
| `conflicts` | *(none)* | *(none)* |
| `accepted_challenges` | *(none)* | *(none)* |
| `recommendedIPv4` rank 1 | **`76.76.21.21`** | `76.76.21.21` |
| `recommendedCNAME` rank 1 | `cname.vercel-dns.com.` | **`cname.vercel-dns.com.`** |

### 1.4 Important accuracy caveat on those values — BLOCKED (per-project confirmation)

`76.76.21.21` / `cname.vercel-dns.com.` is what Vercel's API recommends **before** the domain is
added to a project. Vercel's own current guidance states the project's **domain card is the
source of truth**, that newer projects are assigned an address from an anycast pool (for example
`216.198.79.1`), that some projects are given **two** apex A records, and that subdomains may get
a **project-unique** CNAME of the form `<hash>.vercel-dns-017.com` rather than the generic
`cname.vercel-dns.com`. Vercel also warns that a record which does not match the card leaves the
domain in an invalid state.

Observed but **not** relied upon: the project's `*.vercel.app` hostname resolves to
`216.198.79.195` and `64.29.17.195`, which belongs to the newer anycast pool rather than the
`76.76.21.21` generation. This is a hint only — it is not a substitute for the card, and the plan
below deliberately does **not** hard-code an IP.

**Consequence:** the exact apex A value and exact `www` CNAME target for this project become
readable only *after* the domains are added in Vercel (§4 Phase A). Phase A is therefore a
prerequisite, not an optional nicety. Phase A changes no DNS and no live traffic.

---

## 2. Current public DNS — measured today

Resolver: `8.8.8.8` (the only resolver reachable from this environment).

| Name | Type | Value observed | Matches owner's panel text? |
| --- | --- | --- | --- |
| `jataaftercall.co.ke` | A | `102.218.215.41` | yes |
| `jataaftercall.co.ke` | AAAA | **none (NODATA)** | not listed — confirmed absent |
| `jataaftercall.co.ke` | CNAME | none | — |
| `jataaftercall.co.ke` | MX | `10 mail.jataaftercall.co.ke.` | yes |
| `jataaftercall.co.ke` | NS | `dan1`–`dan4.host-ww.net.` | yes |
| `jataaftercall.co.ke` | TXT | `v=spf1 +a +mx +include:spf.host-ww.net +include:spf.antispamcloud.com ip4:169.255.59.142 ~all` | yes (single string) |
| `jataaftercall.co.ke` | CAA | **none (NODATA)** | not listed — confirmed absent |
| `jataaftercall.co.ke` | SOA | `dan1.host-ww.net. hostmaster.jataaftercall.co.ke. 2026100802 3600 3600 1209600 1800` | not listed — **new** |
| `www` | A | `102.218.215.41` | yes |
| `mail` | A | `102.218.215.41` | yes |
| `smtp` | A | `102.218.215.41` | yes |
| `pop` | A | `102.218.215.41` | yes |
| `ftp` | A | `102.218.215.41` | yes |

SOA serial `2026100802` indicates the zone was last published on 2026-10-08; nothing in the zone
has changed since.

### 2.1 Records explicitly probed and confirmed absent — PASS

`webmail`, `cpanel`, `cpcalendars`, `cpcontacts`, `autodiscover`, `autoconfig`, `imap`, `pop3`,
`ns1`, `ns2`, `whm`, `remote`, `webdisk`, `portal`, `vpn`, `localhost`, `api`, `app`, `admin`,
`dev`, `staging`, `test`, `_dmarc`, `_domainkey`, `_acme-challenge`, `_acme-challenge.www`,
`_vercel`, `_atproto`, `_sip._tcp`, `_imaps._tcp`, `_submission._tcp` — no records of any type.

DKIM selectors probed and **not found**: `default`, `mail`, `dkim`, `k1`, `k2`,
`hostingermail-a`, `hostingermail-b`, `hostingermail-c`, `selector1`, `selector2`, `google`,
`s1`, `s2` (`._domainkey`). No DMARC record exists.

### 2.2 HTTPS behaviour — PASS (content), NOT TESTED (certificate detail)

| URL | Observed |
| --- | --- |
| `https://jataaftercall.co.ke/` | HTTP fetch over TLS succeeded → body: **"webserver is functioning normally"** (HOSTAFRICA placeholder) |
| `https://www.jataaftercall.co.ke/` | Same body; the fetch resolved to the apex document — **no www→apex redirect is in force** |
| `https://jata-aftercall.vercel.app/` | HTTP fetch over TLS succeeded → **the real JATA AFTERCALL landing page** |

Not observable here (**NOT TESTED**): certificate issuer, SAN coverage, expiry, TLS version
negotiation, HSTS, and HTTP→HTTPS redirect status codes. Direct socket/`curl` egress is blocked in
this environment (even Vercel's own URL fails a local `curl`), so these must be measured by the
owner from a normal network or after the change.

### 2.3 Why a full zone export was not obtained — BLOCKED

- No HOSTAFRICA connector, credential, API or panel session exists in this session, and none will
  be requested. **No HOSTAFRICA access was used.**
- Direct queries to `dan1`–`dan4.host-ww.net` (UDP/53 to arbitrary IPs) **time out** — this
  sandbox only reaches its configured recursive resolver. `AXFR` is therefore impossible here too.
- The recursive resolver presents no DNSSEC (`DS`/`DNSKEY` NODATA) and no wildcard.

**Verdict on inventory completeness: UNVERIFIED (BLOCKED).** Every record in the supplied panel
text is confirmed present and correctly valued in public DNS — so the inventory is *consistent and
not contradicted* — but "complete" cannot be proven without a zone export. Records that would most
plausibly be missing from a panel screenshot (AAAA, CAA, DMARC, DKIM, verification TXT) were all
probed: none exist. That is strong evidence, not proof.

---

## 3. Where the website change lands

| Component | Today | After the planned change |
| --- | --- | --- |
| `https://jataaftercall.co.ke` | HOSTAFRICA placeholder | JATA app on Vercel |
| `https://www.jataaftercall.co.ke` | HOSTAFRICA placeholder (apex doc) | JATA app, then canonical redirect |
| `https://jata-aftercall.vercel.app` | JATA app | unchanged — remains rollback target |
| Inbound mail (`MX 10 mail.…`) | HOSTAFRICA | **unchanged** |
| Mail client hostnames `mail`/`smtp`/`pop` | HOSTAFRICA `102.218.215.41` | **unchanged** |
| `ftp.jataaftercall.co.ke` | HOSTAFRICA | **unchanged** |
| DNS hosting / nameservers | HOSTAFRICA | **unchanged** (no NS move) |
| Registrar (KeNIC) settings | HOSTAFRICA | **unchanged** |

Deployment protection note: the project has `ssoProtection.deploymentType =
"all_except_custom_domains"`, and the production site is already publicly reachable at
`jata-aftercall.vercel.app`. Attaching a custom domain does not widen exposure beyond what is
already public today — but it does make the branded host the public face, so any half-finished
route becomes public *under the brand*. Confirm launch intent before Phase C.

---

## 4. Change plan (all steps require explicit owner approval)

### Phase A — Vercel only, no DNS, no traffic change, fully reversible

| # | Action | Effect on live site | Effect on email | Reversible? |
| --- | --- | --- | --- | --- |
| A1 | Add `jataaftercall.co.ke` to project `jata-aftercall` (Settings → Domains) | none — DNS still points at HOSTAFRICA | **none** | yes (remove domain) |
| A2 | Add `www.jataaftercall.co.ke` to the same project | none | **none** | yes |
| A3 | **Read and record the exact records shown on the domain card** (apex A value(s), `www` CNAME target, any verification TXT) | none | none | n/a |
| A4 | Insert those exact values into §4 Phase B, replacing the provisional values | none | none | n/a |

Vercel may attempt TLS issuance before DNS matches; that attempt simply fails and is retried after
Phase B. It is harmless and changes no live behaviour.

### Phase B — HOSTAFRICA DNS (owner executes; website-only)

Values marked `<card>` must be copied from A3 — **never** from this document, another project, or a
forum post. Provisional pre-add values are shown only so the owner can sanity-check the card.

| Host/name | Type | Existing record | Proposed record | Purpose | Email or hosting impact | Rollback action |
| --- | --- | --- | --- | --- | --- | --- |
| `@` (apex) | A | `102.218.215.41`, TTL 3600 | **`<card A value>`** — provisionally `76.76.21.21` (card may show a newer pool IP, or two A records), TTL 300 during cutover | Serves the apex from Vercel | The HOSTAFRICA website (and anything it serves at the bare apex) stops answering there. **Inbound mail unaffected** (MX targets `mail.`, a separate record). SPF `+a` now resolves to Vercel IPs — see R1 | Restore `A @ 102.218.215.41` (TTL 300 → ~5 min) |
| `www` | A | `102.218.215.41`, TTL 3600 | **Delete the A record**, then add **CNAME `www` → `<card CNAME>`** — provisionally `cname.vercel-dns.com` (may be a project-unique `<hash>.vercel-dns-017.com`), TTL 300 | Vercel requires a CNAME for a subdomain; an A record at `www` will keep the domain invalid | None to email. `www` stops reaching HOSTAFRICA | Delete CNAME; re-add `A www 102.218.215.41` |
| `@` | MX | `10 mail.jataaftercall.co.ke.` | **UNCHANGED** | Inbound mail | — | n/a — never modified |
| `mail` | A | `102.218.215.41` | **UNCHANGED** | Mail server hostname that MX points to; IMAP/SMTP clients | — | n/a |
| `smtp` / `pop` / `ftp` | A | `102.218.215.41` | **UNCHANGED** | Mail/FTP client hostnames | — | n/a |
| `@` | TXT | existing SPF string | **UNCHANGED in this change** (flagged for a separate, separately-approved hardening — R1) | Sender authorisation | Untouched here | n/a |
| `@` | NS | `dan1`–`dan4.host-ww.net.` | **UNCHANGED** | DNS stays at HOSTAFRICA | — | n/a — **do not** move to Vercel |
| `@` | AAAA | *none* | **do not add** | — | Vercel does not support AAAA on externally-hosted custom domains; an AAAA would split traffic and can stall TLS | n/a |
| `@` | CAA | *none* | **do not add** | — | Absence is what allows Vercel's automatic certificate issuance | n/a |

**Minimum website-only change = exactly two records** (apex `A` value replacement; `www` `A`
replaced by `CNAME`). Optional cosmetic step: lower those two TTLs to 300 at least one hour (one
old-TTL window) before the cutover so rollback is fast, then restore 3600 after stability.

Order: **lower TTL → A3 values confirmed → apex A → www A→CNAME → verify → restore TTL.**
Change apex and `www` within the same maintenance window; do not leave `www` on HOSTAFRICA for
long after the apex moves, or the two hosts will serve different sites.

### Phase C — Vercel canonical redirect (after DNS verifies)

| # | Action | Why |
| --- | --- | --- |
| C1 | Set the canonical direction: apex primary with `www` → apex **308**, *or* `www` primary with apex → `www` 308 | Two hosts live with no redirect = duplicate branded origins. Owner decision D1. |
| C2 | Leave Vercel's automatic certificate issuance/renewal on | No manual certificate is ever uploaded |

### Phase D — origin/env alignment (separate approval; **not** part of "connect the domain")

Serving the domain needs no code change. But these production values still point at the old
origin and will produce mixed-brand links if left alone:

| Touchpoint | Present state | Needed at go-live |
| --- | --- | --- |
| `lib/url.ts` → `getBaseUrl()` | order: `PUBLIC_BASE_URL` → `NEXTAUTH_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` | Canonical origin must be explicit, not inherited |
| `PUBLIC_BASE_URL` | exists in Production/Preview, value masked (`sensitive`) — **not read, not changed** | `https://jataaftercall.co.ke` |
| `NEXTAUTH_URL` | exists, masked — not changed | same canonical origin |
| `NEXT_PUBLIC_APP_URL` (`lib/qr.ts`, fallback `https://jata.co.ke`) | not confirmed set | set it; note the unrelated hard-coded `jata.co.ke` fallback |
| `lib/payments/config.ts` | falls back to `PUBLIC_BASE_URL`/`NEXTAUTH_URL` | payment callback/return origin |
| `lib/password-reset-email.ts` | uses `PUBLIC_BASE_URL` | reset links in email |
| `scripts/ci/smoke-production.mjs` | `DEFAULT_PRODUCTION_ORIGIN = https://jata-aftercall.vercel.app` | point smoke at the branded origin |
| Paystack dashboard | callback/webhook URLs (owner-controlled) | add the new origin, keep the old working |
| `app/install/page.tsx` | hard-codes `https://jata-aftercall.vercel.app` in copy | cosmetic follow-up |

`NEXTAUTH_URL`/`PUBLIC_BASE_URL` are `sensitive` env vars. Their values were **not** decrypted and
**not** changed in this session — changing them is a production settings change and is out of
scope here.

---

## 5. Email preservation risks

| ID | Risk | Severity | Assessment |
| --- | --- | --- | --- |
| **R1** | **SPF `+a` mechanism changes meaning.** The SPF TXT uses `+a`, which evaluates the domain's *apex A record*. After cutover that becomes Vercel's IPs. | **Low–Medium** | **No delivery break.** Outbound mail from HOSTAFRICA remains authorised by `+mx` (MX → `mail.jataaftercall.co.ke` → `102.218.215.41`), by `include:spf.host-ww.net`, by `include:spf.antispamcloud.com`, and by `ip4:169.255.59.142` — all untouched. The side effect is that Vercel's shared IP range becomes SPF-authorised to send as `@jataaftercall.co.ke`, a small impersonation surface. **Hardening option (separate approval, separate change):** drop `+a` from the SPF string, since `+mx` still covers `102.218.215.41`. Do not bundle it with the cutover. |
| **R2** | **HOSTAFRICA control-panel / webmail reachability.** If the owner reaches cPanel or webmail *via the bare apex* (e.g. `https://jataaftercall.co.ke/webmail`, `:2083`, or a panel shortcut built on the domain), that path stops pointing at HOSTAFRICA. | **Medium — needs owner answer (D2)** | Email itself is untouched: IMAP/SMTP configured to `mail.jataaftercall.co.ke` keeps working, because that A record is unchanged. No `webmail.`/`cpanel.` records exist. Mitigation: use the HOSTAFRICA server hostname or `102.218.215.41` directly for panel access after cutover. |
| **R3** | Inbound mail loss | **None** | MX, `mail` A, and all three mail client hostnames are unchanged. Nothing in the plan touches them. |
| **R4** | DKIM/DMARC breakage | **None observed** | No `_dmarc` TXT and no DKIM record at any of 13 probed selectors → nothing to break. Caveat: absence here is *pre-existing* and completeness is unverified (§2.3), so if the owner's panel shows a DKIM TXT that my probes missed, it is still untouched by this plan (DKIM lives on `*._domainkey`, never on apex `A`/`www`). |
| **R5** | Certificate issuance blocked by CAA | **None** | No CAA record exists, so no CA is restricted. Plan adds none. |
| **R6** | Email deliverability as a whole | **Unchanged** | No SPF/mail record is edited in Phase B. The only SPF interaction is the semantic `+a` shift in R1. |
| **R7** | PTR/rDNS | **None** | No PTR is needed or proposed. Correctly, the owner's "no rDNS shown" is *not* a reason to create one for website hosting. |
| **R8** | Losing the ability to send from webmail | **Low** | Sending is unaffected; only *panel access by bare apex hostname* is at risk (R2), not mail flow. |

**Bottom line:** this is a **website-only** change. Mail delivery survives it because every mail
record is a separate name that the plan never edits. The two things that genuinely change are
(a) where the apex *website* answers, and (b) `+a` in SPF starting to include Vercel.

---

## 6. Verification plan (to run only after an approved change)

| # | Check | Tool | Expected |
| --- | --- | --- | --- |
| V1 | `@` A resolves to the card value(s) | `dig +short jataaftercall.co.ke A` | matches A3 exactly; no leftover `102.218.215.41` |
| V2 | `www` is a CNAME to the card target | `dig +short www.jataaftercall.co.ke CNAME` | matches A3 exactly; **no A record remains at `www`** |
| V3 | No AAAA was introduced | `dig +short jataaftercall.co.ke AAAA` | empty |
| V4 | Mail records byte-identical to §2 | `dig MX`, `dig TXT` before/after diff | **zero diff** |
| V5 | Vercel dashboard shows both domains "Valid Configuration", cert valid | Vercel Settings → Domains | valid, auto-renew on |
| V6 | Certificate issuer/SAN/expiry; HTTP→HTTPS redirect | `openssl s_client`, `curl -I` from a normal network | valid cert covering apex + www; 301/308 to HTTPS |
| V7 | Canonical redirect per D1 | `curl -I` on the non-canonical host | one 308 hop, no loop |
| V8 | App healthy on the branded origin | `https://jataaftercall.co.ke/health`, landing page | healthy payload, landing renders |
| V9 | Auth + links use the branded origin | login, password-reset link, QR/share URL | branded origin (requires Phase D) |
| V10 | Rollback target still healthy | `https://jata-aftercall.vercel.app/` | unchanged |

Until V1–V5 and V8 pass in the live environment, the correct status remains **NOT CONNECTED**.

---

## 7. Rollback plan

1. **Fast path (TTL 300, ~5 min):** HOSTAFRICA → restore `A @ 102.218.215.41`; delete the `www`
   CNAME; re-add `A www 102.218.215.41` (the exact pre-change state, per §2).
2. **Slow path (TTL left at 3600):** same edits, up to ~1 h of stale resolvers.
3. **Vercel side:** removing the two domains from the project is optional and independent — the
   `*.vercel.app` production URL never changes, so the site stays reachable throughout.
4. **Mail:** nothing to roll back, because nothing in the mail zone was ever changed. This is the
   core safety property of the plan.
5. **Env vars:** if Phase D was applied, revert `PUBLIC_BASE_URL`/`NEXTAUTH_URL` and redeploy.
6. Record start/end times, before/after `dig` output, and each resolver's observed behaviour.

---

## 8. Blockers and missing information

| # | Item | Status |
| --- | --- | --- |
| B1 | **No HOSTAFRICA access in this session** — no connector, panel session, API, or credential. DNS cannot be edited here, and the full zone cannot be exported. | **BLOCKED** — owner executes Phase B, or supplies a panel zone export |
| B2 | **Exact per-project A/CNAME values are unreadable before the domain is added.** Vercel states the card is the source of truth and may differ from `76.76.21.21` / `cname.vercel-dns.com`. | **BLOCKED** pending Phase A approval |
| B3 | **Canonical host decision (D1):** apex primary vs `www` primary. Drives Phase C only. | **PENDING owner** |
| B4 | **HOSTAFRICA panel/webmail access method (D2)** — needed to size R2. | **PENDING owner** |
| B5 | Direct authoritative DNS queries, `AXFR`, and local TLS/cert inspection are blocked by this sandbox's egress policy. | **BLOCKED** — measure from a normal network |
| B6 | Whether a DKIM/DMARC policy exists outside the probed selectors (would still be untouched). | **NOT TESTED** |
| B7 | Phase D values (`PUBLIC_BASE_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, Paystack URLs) are masked/owner-side. | **PENDING** — deliberately not read or changed |

---

## 9. Explicit approval request

Approving this means approving **only** the following, and nothing else:

- [ ] **A1** Add `jataaftercall.co.ke` to Vercel project `jata-aftercall`.
- [ ] **A2** Add `www.jataaftercall.co.ke` to the same project.
- [ ] **A3** Report back the exact apex A value(s) and `www` CNAME target Vercel displays.
- [ ] **B1** (owner, HOSTAFRICA) Lower TTL on `@ A` and `www A` to 300.
- [ ] **B2** (owner, HOSTAFRICA) Replace apex `A` `102.218.215.41` with the card value.
- [ ] **B3** (owner, HOSTAFRICA) Delete `www A` `102.218.215.41`; add `www CNAME` → card value.
- [ ] **B4** (owner, HOSTAFRICA) Restore TTL to 3600 once stable.
- [ ] **C1** Set the canonical redirect direction in Vercel (D1).
- [ ] **D1** *(separately approved, later)* Align `PUBLIC_BASE_URL`, `NEXTAUTH_URL`,
      `NEXT_PUBLIC_APP_URL` and Paystack URLs to the branded origin.
- [ ] **H1** *(optional, separately approved)* Remove `+a` from the SPF record (R1).

**Explicitly excluded and will not be done:** no nameserver change, no registrar/KeNIC change, no
domain redirects at the registrar, no MX/SPF/DKIM/DMARC/mail/SMTP/POP/FTP modification, no
AAAA/CAA creation, no HOSTAFRICA hosting or email cancellation, no code, deployment, database or
billing change, no access to JATA Qi or TANYA-AI, and no request for passwords, OTPs, tokens,
cookies or recovery codes.

---

## 10. Status table (evidence labels as of 2026-10-27)

| Check | Result | Evidence |
| --- | --- | --- |
| Vercel project identified | **PASS** | `prj_mXn1031amrZQo4gyaVumKS4FltjW`, team `powerbot-1`, Hobby |
| Custom domains attached to project | **FAIL** (not attached) | project domains API: only `jata-aftercall.vercel.app` |
| Domains in Vercel account / another project | **PASS** (absent everywhere on this account) | team domain list empty; both `get_domain` → 404 |
| Vercel required records (per-project, authoritative) | **BLOCKED** | only pre-add recommendation available: `76.76.21.21` / `cname.vercel-dns.com.` |
| Vercel domain validation errors | **PASS** (evidence captured: `misconfigured: true`, no conflicts, no challenges) | domain-config API for both hosts |
| Public DNS matches supplied inventory | **PASS** | A/MX/NS/TXT/A records match; SOA captured |
| Supplied inventory proven complete | **BLOCKED** | no zone export; no HOSTAFRICA access; `AXFR`/authoritative queries blocked |
| AAAA / CAA / DMARC / DKIM / verification TXT present | **PASS** (none found; consistent with panel) | 13 DKIM selectors + ~30 names probed |
| Current HTTPS content at apex/www | **PASS** (HOSTAFRICA placeholder) | live fetch: "webserver is functioning normally" |
| Current certificate/TLS detail, redirect codes | **NOT TESTED** | sandbox egress blocks local `curl`/openssl |
| Vercel app reachable at `*.vercel.app` | **PASS** | live fetch returns the JATA landing page |
| Production rollback target healthy | **PASS** | `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp` READY/PROMOTED |
| DNS change executed | **NOT DONE — BLOCKED on approval** | this task is read-only by instruction |
| Vercel settings changed | **NOT DONE — BLOCKED on approval** | — |
| Email records changed | **NOT DONE** (none proposed) | — |
| Domain connected | **NO — do not claim connected** | neither domain is attached or resolving to Vercel |
