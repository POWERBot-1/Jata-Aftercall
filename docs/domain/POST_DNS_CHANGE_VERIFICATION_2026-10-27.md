# Post-DNS-change verification — read-only

**Date:** 2026-10-27
**Scope:** read-only verification of the HOSTAFRICA DNS change reported by the owner.
**Performed:** no DNS edit, no nameserver change, no Vercel setting change, no env var, no code change,
no deployment, no workflow run.

---

## 0. Verdict in one line

**The website is connected and working. The email DNS was destroyed, and the nameservers were
changed — contrary to HOSTAFRICA's report that "email records and nameservers were left unchanged".**

| Dimension | Result |
| --- | --- |
| `www.jataaftercall.co.ke` serves the JATA production app over HTTPS | **PASS** |
| Apex redirects to `www` | **PASS** (observed; status code NOT TESTED) |
| Vercel domain validation | **PASS** — both `misconfigured: false` |
| DNS values match Vercel's exact requested records | **PASS** |
| **MX record** | **FAIL — destroyed**. Now `0 jataaftercall.co.ke.` pointing at Vercel |
| **SPF record** | **FAIL — deleted**. No TXT records exist at the apex at all |
| **`mail` / `smtp` / `pop` hostnames** | **FAIL** — `mail` repointed to Vercel; `smtp`/`pop` deleted |
| **Nameservers** | **FAIL — changed** `dan1–dan4` → `ns1–ns4.host-ww.net` |
| **Zone identity** | **FAIL — replaced**, not edited (new SOA primary and admin contact) |
| Email delivery | **NOT TESTED** — and explicitly *not* inferred from DNS |

**Recommended immediate action: have HOSTAFRICA restore the MX, SPF, `mail`, `smtp` and `pop`
records.** Inbound mail to `@jataaftercall.co.ke` is currently pointed at Vercel, which does not
accept SMTP. No change was made here — this is a recommendation awaiting owner approval.

---

## 1. Vercel project and domain ownership — PASS

| Check | Observed | Result |
| --- | --- | --- |
| `jataaftercall.co.ke` attached to | `prj_mXn1031amrZQo4gyaVumKS4FltjW` = **`jata-aftercall`** (team `powerbot-1`) | **PASS** |
| `www.jataaftercall.co.ke` attached to | same project `prj_mXn1031amrZQo4gyaVumKS4FltjW` | **PASS** |
| Both `verified` | `true`, `true` | **PASS** |
| Attached to any other project | No — account has one project; apexName `jataaftercall.co.ke` | **PASS** |
| Serving the production deployment | production alias `jata-aftercall.vercel.app` → `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp` (READY/PROMOTED, `a04124d`) | **PASS** |
| Explicit redirect configured on either domain | `redirect: null`, `redirect_status_code: null` on both | **NOT CONFIGURED** (see §7) |

## 2. Vercel validation status — PASS

`GET /v5/domains/<domain>/config`, both hosts:

| Field | `jataaftercall.co.ke` | `www.jataaftercall.co.ke` |
| --- | --- | --- |
| **`misconfigured`** | **`false`** ✅ | **`false`** ✅ |
| `configured_by` | **`A`** | **`CNAME`** |
| `aValues` (live) | `64.29.17.1`, `216.198.79.1` | `216.198.79.65`, `64.29.17.65` (CNAME target resolution) |
| `cnames` (live) | — | `2da49677b2414cfd.vercel-dns-017.com.` |
| `accepted_challenges` | `http-01` | `http-01` |
| `conflicts` | none | none |
| `ipStatus` | `no-change` | `no-change` |
| `nameservers` (Vercel's view) | **`ns1.host-ww.net`, `ns2.host-ww.net`** | `ns1`, `ns2` |

Both domains moved from `misconfigured: true` to **`false`**. Vercel has independently confirmed the
records are correct. `accepted_challenges: ["http-01"]` shows certificate validation completed.

## 3. Vercel's requested records vs HOSTAFRICA's reported records — PASS

| Record | Vercel rank-1 requirement | HOSTAFRICA reported | Observed live | Match |
| --- | --- | --- | --- | --- |
| Apex `@` `A` | `216.198.79.1` | `216.198.79.1` | `216.198.79.1` | **PASS** |
| Apex `@` `A` | `64.29.17.1` | `64.29.17.1` | `64.29.17.1` | **PASS** |
| `www` `CNAME` | `2da49677b2414cfd.vercel-dns-017.com.` | same | same | **PASS** |

The three website records are **exactly** the project-specific values, not the generic
`76.76.21.21` / `cname.vercel-dns.com` pair. **The website half of the task is correct.**

## 4. Live DNS — before vs after

Resolver: `8.8.8.8`. **Only resolver reachable from this sandbox** — `1.1.1.1` and `9.9.9.9` both
timed out (egress policy), so cross-resolver confirmation is **BLOCKED**.

| Name | Type | **Before (baseline)** | **After (now)** | Verdict |
| --- | --- | --- | --- | --- |
| `@` | A | `102.218.215.41` (TTL 3600) | **`216.198.79.1`, `64.29.17.1`** (TTL 14440) | **PASS** |
| `@` | AAAA | none | none | **PASS** (none introduced) |
| `@` | **MX** | **`10 mail.jataaftercall.co.ke.`** | **`0 jataaftercall.co.ke.`** | **FAIL — DESTROYED** |
| `@` | **TXT (SPF)** | `v=spf1 +a +mx +include:spf.host-ww.net +include:spf.antispamcloud.com ip4:169.255.59.142 ~all` | **NoAnswer — no TXT records at all** | **FAIL — DELETED** |
| `@` | NS | `dan1`, `dan2`, `dan3`, `dan4`.host-ww.net. | **`ns1`, `ns2`, `ns3`, `ns4`.host-ww.net.** | **FAIL — CHANGED** |
| `@` | SOA | `dan1.host-ww.net. hostmaster.jataaftercall.co.ke. 2026100802 3600 3600 1209600 1800` | **`ns1.host-ww.net. server-admin.cloud2m.co.za. 2026102714 3600 1800 1209600 86400`** | **FAIL — new zone** |
| `@` | CAA | none | none | **PASS** (none introduced) |
| `www` | A | `102.218.215.41` | resolves via CNAME to Vercel | **PASS** |
| `www` | CNAME | none | **`2da49677b2414cfd.vercel-dns-017.com.`** (TTL 14400) | **PASS** |
| `mail` | A | **`102.218.215.41`** | **`216.198.79.1`, `64.29.17.1`** | **FAIL — REPOINTED** |
| `smtp` | A | `102.218.215.41` | **NXDOMAIN** | **FAIL — DELETED** |
| `pop` | A | `102.218.215.41` | **NXDOMAIN** | **FAIL — DELETED** |
| `ftp` | A | `102.218.215.41` | **`64.29.17.1`, `216.198.79.1`** | **FAIL — REPOINTED** |
| `imap` / `webmail` | A | none | NXDOMAIN | unchanged |
| `_dmarc` | TXT | none | NXDOMAIN | unchanged (still none) |
| `default` / `mail` / `google` `._domainkey` | TXT | none | NXDOMAIN | unchanged (still none) |

### 4.1 What the MX record now means — FAIL, urgent

```
jataaftercall.co.ke.  MX  0 jataaftercall.co.ke.
jataaftercall.co.ke.  A   216.198.79.1 | 64.29.17.1
```

The MX target is now the **domain itself**, which resolves to **Vercel edge IPs**. Vercel does not
accept inbound SMTP. This is *not* a valid null-MX (RFC 7505 null MX is `MX 0 .` — a single dot); it
is a real host target that cannot receive mail.

**Expected effect:** mail sent to any `@jataaftercall.co.ke` address will fail at delivery —
connection refused/timeout at the Vercel edge, then queue-and-bounce. *(Delivery itself is
**NOT TESTED**: I did not send mail, and I do not infer delivery behaviour from DNS alone. The DNS
configuration is objectively wrong for inbound mail regardless.)*

### 4.2 Why this is a zone replacement, not an edit — FAIL

| Signal | Evidence |
| --- | --- |
| SOA primary NS | `dan1.host-ww.net` → **`ns1.host-ww.net`** |
| SOA admin contact | `hostmaster.jataaftercall.co.ke` → **`server-admin.cloud2m.co.za`** |
| SOA serial | `2026100802` → **`2026102714`** (today) |
| NS set | `dan1–dan4` → **`ns1–ns4`** |
| Default TTLs | 3600 → **14400 / 21600** |
| Mail/host records | individual A records → **repurposed as website A records** |

The `cloud2m.co.za` SOA admin and the `ns1-4` hostnames place this zone on a **different HOSTAFRICA
provisioning platform**. The likely mechanism: the domain's DNS was re-provisioned as a
website-only zone (possibly by a "connect website / Vercel" wizard), which rebuilt the zone from a
template rather than editing the existing one. That template did not carry the mail records across.

**HOSTAFRICA's statement that "email records and nameservers were left unchanged" is factually
incorrect.** Both changed, and both are verifiable in public DNS.

## 5. HTTPS — PARTIAL

| Check | Observed | Result |
| --- | --- | --- |
| `https://www.jataaftercall.co.ke/` | HTTP **200**, TLS handshake succeeded, serves the **real JATA AFTERCALL production landing page** (title: *"JATA AFTERCALL — Business details and contact options in one page"*) | **PASS** |
| `https://jataaftercall.co.ke/` | request lands on **`https://www.jataaftercall.co.ke/`** and serves the production app | **PASS** |
| App internal links on the branded host | all absolute links resolve to `https://www.jataaftercall.co.ke/...` | **PASS** |
| Certificate issuer / SAN coverage / expiry | not observable — sandbox egress blocks `openssl s_client` and `curl` to public hosts | **NOT TESTED** |
| TLS version/ciphers, HSTS | same limitation | **NOT TESTED** |
| Redirect **status code** (308 vs 301) | fetch followed the redirect; final URL captured, code not visible | **NOT TESTED** |

Vercel reports `accepted_challenges: ["http-01"]`, which corroborates that a certificate was issued
— but that is Vercel's metadata, **not** independent certificate verification.

## 6. Redirect behaviour — PASS (direction), determinism pending

- Fetching the **apex** returns the document at **`https://www.jataaftercall.co.ke/`**. So
  **apex → `www`** is in force. Canonical = **`www`**, matching the owner's stated intent.
- However, **neither domain has an explicit redirect setting** (`redirect: null`,
  `redirect_status_code: null`). The redirect is Vercel's implicit default, not configured intent.

## 7. Recommended configuration (requires explicit approval — NOT applied)

**Preferred canonical: `www.jataaftercall.co.ke`** — matches the owner's decision, and `www` rides a
CNAME (resilient to Vercel IP changes) rather than the fixed apex anycast IPs.

To make the redirect explicit and deterministic:

| Setting | Location | Value |
| --- | --- | --- |
| Redirect | Vercel → `jata-aftercall` → Settings → Domains → `jataaftercall.co.ke` → **Redirect to** | `www.jataaftercall.co.ke` |
| Status code | same dialog | **`308`** (permanent, method-preserving) |

Effect: `https://jataaftercall.co.ke/*` → `https://www.jataaftercall.co.ke/*` with a single 308,
instead of relying on Vercel's implicit behaviour. No DNS change, no email impact, reversible.

### 7.1 Still outstanding for full go-live (separate approval)

`https://www.jataaftercall.co.ke/robots.txt` still returns:

```
Sitemap: https://jata-aftercall.vercel.app/sitemap.xml
```

So `getBaseUrl()` still resolves to the `.vercel.app` origin (via `PUBLIC_BASE_URL`). Consequences
until Phase D is applied:

- `sitemap.xml` advertises the `.vercel.app` host
- **password-reset links, payment callbacks and QR/share URLs** will be minted on the `.vercel.app`
  origin, not the branded one
- **Paystack** callback/webhook URLs must be added for the branded origin

Required (needs separate authorization — **not changed**): set `PUBLIC_BASE_URL`,
`NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` to `https://www.jataaftercall.co.ke` in Production, then
redeploy. No env var was read, decrypted or modified in this session.

## 8. Evidence limitations

| Limitation | Impact | Status |
| --- | --- | --- |
| Only `8.8.8.8` reachable (`1.1.1.1`, `9.9.9.9` time out) | no cross-resolver propagation comparison | **BLOCKED** |
| No authoritative query to `ns1–ns4.host-ww.net` (UDP/53 egress blocked) | cannot confirm all four NS agree, or read the raw zone | **BLOCKED** |
| No `openssl`/`curl` to public hosts | certificate and status codes unverified | **BLOCKED** |
| No mail send/receive test | delivery not proven either way | **NOT TESTED** |
| No HOSTAFRICA panel access | cannot read the authoritative zone or its history | **BLOCKED** |

The DNS findings above are from live recursive resolution, are internally consistent across three
independent query rounds in this session, and are corroborated by Vercel's own view of the
nameservers (`ns1`/`ns2`).

## 9. Recommended actions, in priority order

1. **URGENT — restore email DNS (owner, via HOSTAFRICA).** Ask HOSTAFRICA to restore, from the
   pre-change baseline:
   - `MX @ 10 mail.jataaftercall.co.ke.`
   - `TXT @ "v=spf1 +a +mx +include:spf.host-ww.net +include:spf.antispamcloud.com ip4:169.255.59.142 ~all"`
   - `A mail 102.218.215.41`, `A smtp 102.218.215.41`, `A pop 102.218.215.41`
   - `A ftp 102.218.215.41` (if FTP is still used)
   - and confirm whether the `dan1–dan4` → `ns1–ns4` change was intentional.
   Quote §4's before/after table to them — their "unchanged" claim is disproven by public DNS.
2. **Confirm no mail was silently lost** between the change and the fix; check HOSTAFRICA's mail
   queue/logs for bounces of `@jataaftercall.co.ke` mail.
3. **Approve or reject §7** (explicit apex→`www` 308) — one dashboard click, no DNS impact.
4. **Approve Phase D separately** (env origins) so links, callbacks, QR codes and the sitemap use
   the branded host.
5. **Do not** touch the three website records — they are correct and Vercel-validated.

## 10. Final check table

| # | Check | Result | Observed |
| --- | --- | --- | --- |
| 1 | Vercel Settings → Domains inspected | **PASS** | 3 domains on `jata-aftercall` |
| 2 | Both domains on the correct project | **PASS** | `prj_mXn1031amrZQo4gyaVumKS4FltjW` |
| 2b | Serving the production deployment | **PASS** | `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp`, `a04124d` |
| 3 | Vercel records vs HOSTAFRICA records | **PASS** | all three exact |
| 4 | Apex live A records | **PASS** | `216.198.79.1`, `64.29.17.1` |
| 4b | `www` live CNAME | **PASS** | `2da49677b2414cfd.vercel-dns-017.com.` |
| 4c | Authoritative nameservers | **FAIL** | `ns1–ns4` — changed from `dan1–dan4` |
| 4d | **MX records** | **FAIL** | `0 jataaftercall.co.ke.` — was `10 mail.jataaftercall.co.ke.` |
| 4e | **TXT/SPF records** | **FAIL** | none exist at apex — SPF deleted |
| 5 | Vercel domain verification | **PASS** | `misconfigured: false` both |
| 5b | HTTPS certificate status | **NOT TESTED** | egress-blocked; `http-01` challenge accepted per Vercel |
| 5c | Redirect configuration | **NOT CONFIGURED** | `redirect: null` on both |
| 6 | Both HTTPS URLs serve production app | **PASS** | JATA landing page on `www`; apex lands on `www` |
| 7 | Redirect direction | **PASS** | apex → `www` (status code NOT TESTED) |
| 8 | Email-related DNS intact | **FAIL** | MX, SPF, `mail`, `smtp`, `pop` all altered or deleted |
| 9 | Email delivery | **NOT TESTED** | not inferred from DNS |
| 10 | Changes made by this session | **NONE** | read-only |
