# Phase B execution report — custom domain connection

**Date:** 2026-10-27
**Task:** Execute Phase B (HOSTAFRICA DNS cutover) for `jataaftercall.co.ke` → Vercel project `jata-aftercall`.
**Canonical host:** `www.jataaftercall.co.ke` (owner decision, this turn). Apex `jataaftercall.co.ke` → 308 → `www`.
**Outcome: BLOCKED.** No authorized DNS-editing route exists in this environment. **Zero DNS records were changed. The domain is NOT connected.** Nothing in this session could have edited HOSTAFRICA DNS, and no access-control boundary was probed or bypassed.

Evidence labels: **PASS** / **FAIL** / **BLOCKED** / **NOT TESTED** / **DONE**.

---

## 1. Headline

| Question | Answer | Evidence |
| --- | --- | --- |
| Both domains still attached to `jata-aftercall`? | **Yes**, both `verified: true` | **PASS** (project-domains API) |
| Approved DNS values still current? | **Yes** — rank-1 values unchanged since Phase A | **PASS** |
| Any discrepancy vs the approved change set? | **None** | **PASS** |
| Public DNS still at HOSTAFRICA? | **Yes** — apex + `www` = `102.218.215.41`; zone serial still `2026100802` | **PASS** |
| **Was any DNS record edited?** | **No** | **BLOCKED** — no route |
| Is a DNS-management integration available? | **No.** `hostafrica` connector = `unsupported`; no other DNS provider connected; no DNS credentials in repo or Vercel env; Vercel cannot write to external DNS | **BLOCKED** |

**The blocker is a missing integration, not a missing plan.** The exact values are confirmed and ready; the only thing absent is an authorized channel to write them.

---

## 2. Pre-execution verification (all re-run this turn)

### 2.1 Vercel project state — PASS

| Domain | Verified | `configured` | `redirect` | `redirect_status_code` |
| --- | --- | --- | --- | --- |
| `www.jataaftercall.co.ke` | **true** | `null` | `null` | `null` |
| `jataaftercall.co.ke` | **true** | `null` | `null` | `null` |
| `jata-aftercall.vercel.app` | true | `null` | `null` | `null` |

Project `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`), team `powerbot-1`. Both custom
domains remain attached; **no re-verification or ownership challenge is outstanding**
(`accepted_challenges: []`, no `_vercel` TXT required).

### 2.2 Exact DNS targets, re-read live from Vercel — PASS, unchanged

`GET /v5/domains/<domain>/config`, this turn, both hosts:

| Field | Value |
| --- | --- |
| `serviceType` | `external` |
| `zone` (domain object) | **`false`** — this is **not** a Vercel-managed DNS zone |
| `nameservers` | `dan1`–`dan4.host-ww.net` |
| `misconfigured` | **true** (expected — DNS not yet moved) |
| `configured_by` | `null` |
| `aValues` (live, observed) | `102.218.215.41` |
| `cnames` (live, observed) | *(none)* |
| `conflicts` / `accepted_challenges` | *(none)* |
| **`recommendedIPv4` rank 1** | **`216.198.79.1`, `64.29.17.1`** |
| `recommendedIPv4` rank 2 | `76.76.21.21` |
| **`recommendedCNAME` rank 1** | **`2da49677b2414cfd.vercel-dns-017.com.`** |
| `recommendedCNAME` rank 2 | `cname.vercel-dns.com.` |

**Match against the approved change set: PASS.** The rank-1 values are byte-identical to what was
captured in Phase A and to the values in the authorization. No substitution of generic Vercel values
was made or needed.

### 2.3 Immediate pre-change public DNS snapshot — PASS

Resolver `8.8.8.8`, captured immediately before the attempted change:

| Name | Type | TTL | Value |
| --- | --- | --- | --- |
| `jataaftercall.co.ke` | A | 3600 | `102.218.215.41` |
| `jataaftercall.co.ke` | AAAA | — | **none (NoAnswer)** |
| `jataaftercall.co.ke` | MX | 2183* | `10 mail.jataaftercall.co.ke.` |
| `jataaftercall.co.ke` | TXT | 3600 | `v=spf1 +a +mx +include:spf.host-ww.net +include:spf.antispamcloud.com ip4:169.255.59.142 ~all` |
| `jataaftercall.co.ke` | NS | 3600 | `dan1`, `dan2`, `dan3`, `dan4`.host-ww.net. |
| `jataaftercall.co.ke` | CAA | — | **none (NoAnswer)** |
| `jataaftercall.co.ke` | SOA | 3600 | `dan1.host-ww.net. hostmaster.jataaftercall.co.ke. 2026100802 3600 3600 1209600 1800` |
| `www.jataaftercall.co.ke` | A | 2185* | `102.218.215.41` |
| `www.jataaftercall.co.ke` | AAAA | — | none |
| `www.jataaftercall.co.ke` | CNAME | — | **none (NoAnswer)** |
| `mail.jataaftercall.co.ke` | A | 3600 | `102.218.215.41` |
| `smtp.jataaftercall.co.ke` | A | 3600 | `102.218.215.41` |
| `pop.jataaftercall.co.ke` | A | 2188* | `102.218.215.41` |
| `ftp.jataaftercall.co.ke` | A | 3600 | `102.218.215.41` |

\* Decremented values are recursive-cache residue of a 3600 s record; the zone default is 3600.
SOA serial `2026100802` is **unchanged since 2026-10-08** — independent proof that the zone has not
been edited in this session.

### 2.4 Pre-change HTTPS behaviour — PASS

| URL | Observed |
| --- | --- |
| `https://jataaftercall.co.ke/` | **"webserver is functioning normally"** (HOSTAFRICA placeholder) |
| `https://www.jataaftercall.co.ke/` | **"webserver is functioning normally"** (HOSTAFRICA placeholder) |
| `https://jata-aftercall.vercel.app/` | the real JATA AFTERCALL production landing page |

The JATA application is reachable **only** at its `*.vercel.app` URL today.

---

## 3. Why Phase B is BLOCKED — authorized execution route audit

The task requires applying edits "through an authorized DNS-management integration". Each candidate
route was checked and is genuinely unavailable:

| Candidate route | Result | Evidence |
| --- | --- | --- |
| HOSTAFRICA connector | **Unsupported** | `list_connector_tools("hostafrica")` → status `unsupported`. No such connector exists on this platform. |
| Any other DNS-provider connector | **None connected** | Session connectors are gmail, google_docs, google_drive, google_sheets, google_slides, vercel. No DNS provider among them. |
| DNS API credentials in the repo or env | **None exist** | `.env.example` contains no DNS/hostafrica/registrar credentials; the only "Cloudflare" references are for **R2 object storage**, not DNS. No DNS token is present in the Vercel project env either. |
| Vercel DNS records API | **Structurally impossible** | The domain object reports `zone: false`, `serviceType: external`, nameservers `dan*.host-ww.net`. Vercel's DNS editor/API only works when the domain uses **Vercel nameservers**. Moving nameservers to Vercel is **explicitly forbidden** by the task, so this route is closed by design. |
| Direct authoritative DNS / `AXFR` from this sandbox | **Blocked by egress** | Queries to `dan1`–`dan4.host-ww.net` (UDP/53 to arbitrary IPs) time out; only the local recursive resolver (`8.8.8.8`) is reachable. `AXFR` therefore unavailable, and it is read-only anyway. |
| Registrar / KeNIC panel | **No access, not requested** | No credential exists here, and none will be requested, stored or transmitted. |

**Conclusion:** no authorized DNS-editing route exists. Editing DNS would require either credentials
or a connector that this environment does not have. No attempt was made to bypass any access control.

**Phase B status: BLOCKED — missing integration: an authorized HOSTAFRICA DNS-management connection
(panel session or API credential) presented to this environment.**

---

## 4. The change set, ready to apply (unchanged, revalidated)

Only these three website edits, and nothing else. Values are the live rank-1 values from §2.2.

| # | Host | Type | Before | **After** | TTL | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `@` | A | `102.218.215.41` | **`216.198.79.1`** | 300 | Vercel anycast (apex, rank 1) |
| 2 | `@` | A | *(none)* | **`64.29.17.1`** | 300 | Vercel anycast (apex, rank 1) |
| 3 | `www` | A → CNAME | `A 102.218.215.41` | **delete the A**, add `CNAME → 2da49677b2414cfd.vercel-dns-017.com.` | 300 | Project-unique Vercel target |
| 0 | `@` and `www` | A | TTL 3600 | **TTL 300 first**, restore 3600 after stability | 300 | Keep rollback to ~5 min if supported |

**Preserved without modification (verified present in §2.3):** MX `10 mail.jataaftercall.co.ke.`,
SPF TXT, nameservers `dan1`–`dan4.host-ww.net`, `mail`/`smtp`/`pop`/`ftp` A records. There is **no**
DKIM or DMARC record to preserve (none exist — 13 selectors and `_dmarc` probed, all NoAnswer).

**Do not add:** AAAA (unsupported on externally-hosted Vercel custom domains; would split traffic and
can stall TLS), CAA (absence is what permits automatic certificate issuance), any `_vercel` TXT
(already verified).

> **Note on canonical direction:** choosing `www` as canonical does **not** change the records above.
> The apex still needs both Vercel A records so it can answer and issue the 308 to `www`. The
> direction is a Vercel-side setting (§6).

---

## 5. Post-execution verification — all NOT TESTED

Nothing was executed, so every live check is **NOT TESTED**. These are the exact checks to run after
the owner applies §4; each is written to be copy-pasteable.

| # | Check | Command / method | Expected | Status |
| --- | --- | --- | --- | --- |
| V1 | Apex A = both rank-1 IPs, old IP gone | `dig +short jataaftercall.co.ke A` | `216.198.79.1`, `64.29.17.1`; no `102.218.215.41` | **NOT TESTED** |
| V2 | `www` is a CNAME, no A remains | `dig +short www.jataaftercall.co.ke CNAME` / `dig +short www.jataaftercall.co.ke A` | `2da49677b2414cfd.vercel-dns-017.com.` / empty | **NOT TESTED** |
| V3 | No AAAA | `dig +short jataaftercall.co.ke AAAA` | empty | **NOT TESTED** |
| V4 | Zone actually changed (not cache) | `dig +short jataaftercall.co.ke SOA` | serial **newer than `2026100802`** | **NOT TESTED** |
| V5 | Vercel config valid | Vercel → Settings → Domains, and `get_domain_config` | `misconfigured: false` for both | **NOT TESTED** |
| V6 | `https://www.jataaftercall.co.ke` serves the app | load page | JATA AFTERCALL landing page, not the HOSTAFRICA placeholder | **NOT TESTED** |
| V7 | Apex 308 → `www` | `curl -sI https://jataaftercall.co.ke/` | `308` with `location: https://www.jataaftercall.co.ke/` | **NOT TESTED** |
| V8 | Certificate issuer / SAN / expiry | `openssl s_client -connect www.jataaftercall.co.ke:443 -servername www.jataaftercall.co.ke </dev/null \| openssl x509 -noout -issuer -dates -ext subjectAltName` | valid CA-issued cert covering the hostname, auto-renew on, ≥ 60 days left | **NOT TESTED** |
| V9 | HTTPS on apex too | `openssl s_client -connect jataaftercall.co.ke:443` | valid cert (Vercel issues for both) | **NOT TESTED** |
| V10 | Email records unchanged | `dig MX` + `dig TXT` + `dig NS`, diffed against §2.3 | **zero diff** | **NOT TESTED** (current values still = §2.3, i.e. intact) |
| V11 | Production app health | `https://www.jataaftercall.co.ke/health` | healthy payload | **NOT TESTED** |
| V12 | Canonical URL used by app surface | homepage, `/login`, pricing, `/b/<demo>`, `sitemap.xml`, `robots.txt` | branded origin (requires Phase D env change) | **NOT TESTED** — see §6 |
| V13 | Rollback target healthy | `https://jata-aftercall.vercel.app/` | unchanged landing page | **PASS (unchanged)** |


### Distinguishing propagation delay from configuration failure

When the owner applies §4, do not judge success from a browser alone:

| Signal | Propagation delay (keep waiting) | Genuine failure (fix the record) |
| --- | --- | --- |
| SOA serial | **has increased** past `2026100802` | still `2026100802` → your edit did not save |
| Answering nameserver | some of dan1–dan4 already return the new value | **all four** still return `102.218.215.41` after one TTL |
| Elapsed time | < 1× old TTL (≤ 60 min at 3600) | > 2× the new TTL (≥ 10 min at 300) with no change anywhere |
| Vercel `misconfigured` | flips to `false` within minutes of DNS matching | stays `true` while DNS already matches → wrong target value (usually a stale `www` A record surviving beside the CNAME, or the rank-2 generic values used) |
| Certificate | "pending" then issues automatically | stuck after DNS is correct → check that no AAAA or CAA was introduced |

Cache-busting for your own checks: `dig @8.8.8.8`, `dig @1.1.1.1`, then `dig @dan1.host-ww.net`.

---

## 6. Remaining Vercel-side step (deliberately not applied)

Canonical = `www` requires the apex to redirect to it. Both domains are currently attached with
`redirect: null`, so **the apex would serve the app directly rather than 308 to `www`** once DNS
moves.

**This was not applied, and the omission is deliberate:**

- The available tooling has **no update-redirect operation** — only add/remove a project domain.
  Setting the redirect through the API would mean **removing and re-adding the apex domain**.
- Vercel states that removing and re-adding a domain can trigger a **fresh ownership challenge**
  (a new `_vercel` TXT value), which would require extra HOSTAFRICA edits at the worst moment.
- The setting has **zero observable effect while DNS still points at HOSTAFRICA**, so changing it now
  buys nothing and risks a currently-clean, verified state.

**Shortest path:** after DNS validates, set it in the dashboard — Vercel → `jata-aftercall` →
Settings → Domains → `jataaftercall.co.ke` → **Redirect to `www.jataaftercall.co.ke`**, status **308**.
One click, no ownership challenge.

### Phase D reminder (env origin) — separate approval

Because canonical is now **`www`**, the go-live env values must be:

- `PUBLIC_BASE_URL` = `https://www.jataaftercall.co.ke`
- `NEXTAUTH_URL` = `https://www.jataaftercall.co.ke`
- `NEXT_PUBLIC_APP_URL` = `https://www.jataaftercall.co.ke`
- Paystack callback/webhook URLs → `www` origin (keep the old origin working until cutover completes)

Otherwise `lib/url.ts → getBaseUrl()` will mint links on the wrong host — including password-reset
links, payment callbacks, QR codes and `sitemap.xml`. **No env var was read, decrypted or changed**
in this session.

---

## 7. Email-record comparison — PASS (intact, because nothing changed)

| Record | Pre-change (this session) | Post-change | Delta |
| --- | --- | --- | --- |
| MX | `10 mail.jataaftercall.co.ke.` | same | **none** |
| SPF TXT | `v=spf1 +a +mx +include:spf.host-ww.net +include:spf.antispamcloud.com ip4:169.255.59.142 ~all` | same | **none** |
| NS | `dan1`–`dan4.host-ww.net` | same | **none** |
| `mail` A | `102.218.215.41` | same | **none** |
| `smtp` A | `102.218.215.41` | same | **none** |
| `pop` A | `102.218.215.41` | same | **none** |
| `ftp` A | `102.218.215.41` | same | **none** |
| DKIM | none exists | none | **none** |
| DMARC | none exists | none | **none** |
| CAA | none exists | none | **none** |

Email is untouched **by construction** — the cutover was not performed, and even when it is, it edits
only apex `A` and `www`.

### Email risk carried forward to the actual cutover

| ID | Risk | Severity | Note |
| --- | --- | --- | --- |
| R1 | SPF `+a` resolves the **apex A record**, so after cutover Vercel's IPs become SPF-authorised for the domain | Low–Medium | **No delivery break**: `+mx` (→ `mail.` → `102.218.215.41`), `include:spf.host-ww.net`, `include:spf.antispamcloud.com` and `ip4:169.255.59.142` all still authorise HOSTAFRICA. Optional later hardening: drop `+a`. Not bundled with the cutover. |
| R2 | HOSTAFRICA panel / webmail reached via the bare apex stops working after cutover | Medium | Owner answered "not sure" how the panel is reached. **Do this first:** open the panel, note the URL, and confirm access via the HOSTAFRICA hostname or `102.218.215.41` before editing DNS. Mail clients using `mail.jataaftercall.co.ke` are unaffected. |

---

## 8. Rollback plan (exact prior state)

Because nothing changed, **rollback is currently a no-op — the system is already in the "before"
state.** If §4 is applied and must be reverted, restore exactly:

| Host | Record to restore | Value | TTL |
| --- | --- | --- | --- |
| `@` | A | `102.218.215.41` | 3600 (or 300, then 3600) |
| `@` | A (`216.198.79.1`) | **delete** | — |
| `@` | A (`64.29.17.1`) | **delete** | — |
| `www` | CNAME | **delete** | — |
| `www` | A | `102.218.215.41` | 3600 |

Do **not** roll back, touch or re-create MX/SPF/NS/`mail`/`smtp`/`pop`/`ftp` — they were never
altered, so "restoring" them would itself be the risk. Vercel-side rollback (remove the two domains)
is independent and unnecessary: `https://jata-aftercall.vercel.app` keeps serving production
throughout.

---

## 9. Shortest actionable next step

**Option A (fastest, no integration needed) — owner applies 3 edits in HOSTAFRICA:**

1. Log in to the HOSTAFRICA client area → the domain `jataaftercall.co.ke` → **DNS / Zone Editor**
   (cPanel "Zone Editor" or "Advanced DNS").
2. Optional first: set TTL **300** on the apex `A` and the `www` `A` records.
3. Edit apex `A` `102.218.215.41` → **`216.198.79.1`**; **add** a second apex `A` → **`64.29.17.1`**.
4. **Delete** the `www` `A` record `102.218.215.41`. **Add** `www` **CNAME** →
   **`2da49677b2414cfd.vercel-dns-017.com.`** (note the trailing dot is optional in most UIs; do not
   prefix `https://`).
5. Touch nothing else. Then tell me, and I will run V1–V13 and compare email records against §2.3.

**Option B — grant an authorized DNS route:** connect a DNS-management integration for HOSTAFRICA
to this environment, or provide a scoped DNS API token through an approved secret interface (never
in chat). With that in place, I can execute §4 and verify end-to-end without further input.

**Option C — supply a zone export:** if you can export the HOSTAFRICA zone file, I can close the one
remaining evidence gap (proof that the supplied inventory is complete) before you edit.

Do **not** start with Vercel's nameservers; that is out of scope and would put email at risk.

---

## 10. Final status table

| Item | Result | Evidence |
| --- | --- | --- |
| Domains attached to `jata-aftercall` | **PASS** | both `verified: true`, `redirect: null` |
| Approved DNS values still authoritative | **PASS** | `216.198.79.1`, `64.29.17.1`, `2da49677b2414cfd.vercel-dns-017.com.` |
| Discrepancy vs approved change set | **PASS (none)** | §2.2 vs §4 |
| Pre-change DNS snapshot captured | **PASS** | §2.3, SOA serial `2026100802` |
| Pre-change HTTPS behaviour captured | **PASS** | HOSTAFRICA placeholder on both hosts |
| **DNS provider / authorized route used** | **BLOCKED — none exists** | `hostafrica` connector `unsupported`; no DNS provider connected; no DNS credentials; Vercel zone `false`; sandbox egress blocks direct DNS |
| **Records changed** | **NONE — NOT DONE** | zone serial unchanged |
| Records preserved (MX/SPF/NS/mail/smtp/pop/ftp) | **PASS** (unmodified, verified present) | §2.3, §7 |
| Vercel domain status | **PASS (as evidence)** — still `misconfigured: true`, correctly awaiting DNS | config API |
| Apex `A` → both Vercel IPs | **NOT TESTED** | not applied |
| `www` CNAME, A removed | **NOT TESTED** | not applied |
| `www` serves JATA app over valid HTTPS | **NOT TESTED** | still HOSTAFRICA placeholder |
| Apex 308 → `www` | **NOT TESTED** | not applied; also needs Vercel redirect setting (§6) |
| Certificate validity/coverage/expiry | **NOT TESTED** | sandbox blocks `openssl` to public hosts |
| MX/SPF/NS unchanged | **PASS** (identical to pre-session baseline) | §2.3 vs §7 |
| Production `*.vercel.app` still healthy | **PASS** | landing page loads |
| Code / env / DB / payments / billing / deployments changed | **NONE** | no such call made |
| **Domain connected** | **NO — do not claim connected** | apex + `www` still `102.218.215.41`; both hosts serve the HOSTAFRICA placeholder |

**Success criterion is not met and is not claimed.** The phrase "webserver is functioning normally"
at both `https://jataaftercall.co.ke` and `https://www.jataaftercall.co.ke` is the definitive
disproof of connection. Completion requires the three edits in §9 followed by V1–V13 passing live.
