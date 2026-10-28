# URGENT — Email DNS recovery: `jataaftercall.co.ke`

**Date:** 2026-10-27
**HOSTAFRICA ticket:** **#9761478**
**Scope:** read-only investigation + prepared support request. **No DNS mutation, no nameserver change,
no Vercel env/code/deployment change was made in this task.**

---

## 0. Status summary

| Item | Result |
| --- | --- |
| Website DNS (3 Vercel records) | **PASS — intact and Vercel-validated** |
| Email DNS (MX / SPF / mail / smtp / pop) | **FAIL — still broken, no repair has occurred** |
| Evidence of repair since the last audit | **FAIL — none.** SOA serial is still `2026102714` |
| Authoritative nameservers | **PASS (identified)** — `ns1–ns4.host-ww.net`, answers served authoritatively from `ns1` (`169.239.180.4`) |
| Root cause identified | **PASS** — zone was re-provisioned from a **website-only template** (§2) |
| DKIM / DMARC to recover | **PASS (nothing to recover)** — neither existed before the change (§5) |
| Email sending / receiving | **NOT TESTED** — no authorized mail-flow test performed (§7) |
| Recovery executed | **BLOCKED** — requires HOSTAFRICA action on ticket #9761478 |
| New project / deploy created | **No — none** |

**Do not consider this recovered.** Recovery is complete only when §6 verification passes against
authoritative DNS *and* mail flow has been independently tested.

---

## 1. Findings re-verified this session — now **authoritative**, not just recursive

The previous audit could only reach a recursive resolver (`8.8.8.8`). This pass obtained answers
served **directly by the authoritative nameserver**: Google's public resolver returned
`"Comment": "Response from 169.239.180.4."` — which is **`ns1.host-ww.net`**, a delegated NS for the
zone. These are therefore authoritative zone contents, not cached hearsay.

| Name | Type | Authoritative value (via ns1) | Verdict |
| --- | --- | --- | --- |
| `jataaftercall.co.ke` | A | `216.198.79.1` (TTL 14400), `64.29.17.1` (TTL 14440) | **PASS — preserve** |
| `jataaftercall.co.ke` | AAAA | none | **PASS** |
| `www.jataaftercall.co.ke` | CNAME | `2da49677b2414cfd.vercel-dns-017.com.` (TTL 14400) | **PASS — preserve** |
| `jataaftercall.co.ke` | NS | `ns1`, `ns2`, `ns3`, `ns4`.host-ww.net. (TTL 21600) | **PASS (identified)** |
| `jataaftercall.co.ke` | SOA | `ns1.host-ww.net. server-admin.cloud2m.co.za. 2026102714 3600 1800 1209600 86400` | **FAIL — re-provisioned zone** |
| `jataaftercall.co.ke` | **MX** | **`0 jataaftercall.co.ke.`** | **FAIL — no mail service** |
| `jataaftercall.co.ke` | **TXT (SPF)** | **NODATA — no TXT records exist** (authoritative NOERROR with empty answer) | **FAIL — SPF deleted** |
| `mail.jataaftercall.co.ke` | **CNAME** | **`jataaftercall.co.ke.`** → resolves to Vercel IPs | **FAIL — aliased to website** |
| `ftp.jataaftercall.co.ke` | **CNAME** | **`jataaftercall.co.ke.`** → resolves to Vercel IPs | **FAIL — aliased to website** |
| `smtp.jataaftercall.co.ke` | A | **NXDOMAIN** | **FAIL — deleted** |
| `pop.jataaftercall.co.ke` | A | **NXDOMAIN** | **FAIL — deleted** |
| `pop3`, `imap`, `webmail`, `autodiscover`, `autoconfig` | A | NXDOMAIN | unchanged (none existed) |
| `_dmarc.jataaftercall.co.ke` | TXT | **NXDOMAIN** (authoritative) | unchanged (none existed before) |
| 13 DKIM selectors `._domainkey` | TXT | **NXDOMAIN** (all) | unchanged (none existed before) |
| `jataaftercall.co.ke` | CAA | none | **PASS** (none introduced) |

### 1.1 Root cause — the zone was rebuilt from a website-only template

The record shape is unmistakable:

```
@    A      216.198.79.1, 64.29.17.1         <- requested Vercel values (correct)
www  CNAME  2da49677b2414cfd.vercel-dns-017.com.   <- requested Vercel value (correct)
mail CNAME  jataaftercall.co.ke.             <- templated alias to the web root
ftp  CNAME  jataaftercall.co.ke.             <- templated alias to the web root
@    MX     0 jataaftercall.co.ke.           <- templated, points mail at the web root
```

Nothing here was "edited" — `mail` and `ftp` were **destroyed as independent host records** and
replaced by aliases to the apex, and the apex now points at Vercel. The MX target inherits Vercel's
edge IPs, which do not accept SMTP. The SPF TXT was dropped entirely.

Supporting evidence that this is a **different zone**, not the old one edited:
`SOA` admin changed from `hostmaster.jataaftercall.co.ke` to **`server-admin.cloud2m.co.za`**, NS set
changed `dan1–dan4` → `ns1–ns4`, default TTLs changed 3600 → 14400/21600.

**The old zone should still exist on `dan1–dan4.host-ww.net`** (`dan1` = `102.218.215.41`, the old
mail/web server). It is the correct source of truth for the pre-change records.

### 1.2 Why the nameservers must NOT simply be switched back

`dan1–dan4` almost certainly still holds the **old** zone — which has the correct mail records but
the **old apex A record** `102.218.215.41`. Reverting the delegation would very likely restore email
**and simultaneously break the website**, undoing the completed Vercel connection.

**Correct approach: restore the mail records *inside the current `ns1–ns4` zone*** (§3). The website
records already in that zone are correct and must be left untouched.

### 1.3 Current nameserver addresses (informational)

| NS | Address |
| --- | --- |
| `ns1.host-ww.net` (authoritative responder) | `169.239.180.4` |
| `ns2.host-ww.net` | `195.110.43.170` |
| `ns3.host-ww.net` | `139.84.227.160` |
| `ns4.host-ww.net` | `138.68.165.236` |
| *(old)* `dan1.host-ww.net` | `102.218.215.41` |
| *(old)* `dan2.host-ww.net` | `134.209.28.57` |

Direct UDP queries to `102.218.215.41:53` from this environment time out (**BLOCKED** by egress
policy), so the old zone could not be read directly — only the authoritative current zone via DoH.

---

## 2. Website coexists correctly — PASS

| Check | Result |
| --- | --- |
| `https://www.jataaftercall.co.ke/` serves the JATA production app | **PASS** |
| `https://jataaftercall.co.ke/` lands on `www` | **PASS** (status code NOT TESTED) |
| Vercel `misconfigured` | **PASS** — `false` for both domains (from the prior audit; unchanged) |
| Records to preserve | apex A ×2, `www` CNAME — **all intact, do not modify** |

---

## 3. Required final DNS state (target for HOSTAFRICA)

Website records **unchanged**; email records **restored** to the pre-change values.

| Name | Type | Current (broken) | **Required** | Action |
| --- | --- | --- | --- | --- |
| `@` | A | `216.198.79.1`, `64.29.17.1` | `216.198.79.1`, `64.29.17.1` | **KEEP — do not modify** |
| `www` | CNAME | `2da49677b2414cfd.vercel-dns-017.com.` | same | **KEEP — do not modify** |
| `@` | MX | `0 jataaftercall.co.ke.` | **`10 mail.jataaftercall.co.ke.`** | **REPLACE** |
| `@` | TXT | *(none)* | **`v=spf1 +a +mx +include:spf.host-ww.net +include:spf.antispamcloud.com ip4:169.255.59.142 ~all`** | **RESTORE** |
| `mail` | **CNAME → @** | `jataaftercall.co.ke.` | **`A 102.218.215.41`** | **DELETE CNAME, ADD A** |
| `smtp` | *(missing)* | NXDOMAIN | **`A 102.218.215.41`** | **ADD** |
| `pop` | *(missing)* | NXDOMAIN | **`A 102.218.215.41`** | **ADD** |
| `ftp` | **CNAME → @** | `jataaftercall.co.ke.` | **`A 102.218.215.41`** *if FTP is still used* — owner to confirm | **CONFIRM, then DELETE CNAME / ADD A** |
| NS | NS | `ns1–ns4` | **leave as HOSTAFRICA confirms** | **CONFIRM ONLY — no blind change** |

Two ordering constraints to state to HOSTAFRICA:

1. `mail` and `ftp` are currently **CNAMEs**. A CNAME cannot coexist with an A record at the same
   name, so the CNAME must be **deleted first**, then the A record added.
2. The MX and SPF must be restored **in the current `ns1–ns4` zone**, not by changing nameservers.

> **`ftp` decision needed from you:** is FTP still used for anything? If not, it can be left as-is
> (or removed) rather than restored — say which before I finalise the ticket wording.

---

## 4. Before / after recovery table

| Record | Before HOSTAFRICA change | Now (verified authoritative) | After repair (target) |
| --- | --- | --- | --- |
| `@` A | `102.218.215.41` | `216.198.79.1`, `64.29.17.1` | **`216.198.79.1`, `64.29.17.1`** (keep) |
| `www` A→CNAME | `A 102.218.215.41` | `CNAME 2da49677b2414cfd.vercel-dns-017.com.` | **keep CNAME** |
| `@` MX | `10 mail.jataaftercall.co.ke.` | `0 jataaftercall.co.ke.` | **`10 mail.jataaftercall.co.ke.`** |
| `@` TXT SPF | full SPF string | *absent* | **full SPF string restored verbatim** |
| `mail` A | `102.218.215.41` | `CNAME jataaftercall.co.ke.` | **`A 102.218.215.41`** |
| `smtp` A | `102.218.215.41` | NXDOMAIN | **`A 102.218.215.41`** |
| `pop` A | `102.218.215.41` | NXDOMAIN | **`A 102.218.215.41`** |
| `ftp` A | `102.218.215.41` | `CNAME jataaftercall.co.ke.` | **owner decision** |
| NS | `dan1–dan4` | `ns1–ns4` | **HOSTAFRICA to confirm intent** |
| SOA | `dan1… hostmaster.jataaftercall…` serial `2026100802` | `ns1… server-admin.cloud2m.co.za…` serial `2026102714` | serial advances on repair |
| `_dmarc` | none | none (NXDOMAIN) | **none — nothing to restore** |
| DKIM | none | none (NXDOMAIN) | **none — nothing to restore** |
| CAA | none | none | **none — leave absent** (Vercel TLS) |

---

## 5. DKIM / DMARC — nothing to recover (evidence-based)

| Record | Before the change | Now | Conclusion |
| --- | --- | --- | --- |
| `_dmarc` TXT | **NXDOMAIN** (probed in the pre-change baseline) | NXDOMAIN (authoritative) | **No DMARC existed → nothing lost, nothing to restore.** Recommend adding one *later*, as a separate hardening change, after mail flows again. |
| DKIM `._domainkey` | **NXDOMAIN** at 13 selectors (`default`, `mail`, `dkim`, `k1`, `k2`, `hostingermail-a/b/c`, `selector1`, `selector2`, `google`, `s1`, `s2`) | NXDOMAIN (all) | **No DKIM TXT was published at this domain → nothing lost.** Note: the SPF references `include:spf.antispamcloud.com`, so outbound may be DKIM-signed by the **relay's** domain rather than yours — ask HOSTAFRICA to confirm whether they ever issued a customer DKIM key. |
| CAA | none | none | Leave absent — it is what lets Vercel auto-issue certificates. |

**Caveat, stated honestly:** my pre-change baseline probed 13 common selectors and `_dmarc`. If
HOSTAFRICA's panel shows a DKIM record under an unusual selector, my probes could have missed it. The
ticket therefore asks them to confirm from their own zone data rather than assuming none existed.

---

## 6. Verification to run after HOSTAFRICA confirms the repair — **BLOCKED until then**

| # | Check | Method | Expected |
| --- | --- | --- | --- |
| V1 | MX restored | authoritative MX | `10 mail.jataaftercall.co.ke.` |
| V2 | SPF restored verbatim | authoritative TXT | exact string, unchanged |
| V3 | `mail` is an A record, not CNAME | authoritative `A` + `CNAME` | `A 102.218.215.41`; no CNAME |
| V4 | `smtp`, `pop` exist | authoritative `A` | `102.218.215.41` |
| V5 | Website records untouched | authoritative `A`/`CNAME` | `216.198.79.1`, `64.29.17.1`, `www` CNAME unchanged |
| V6 | SOA serial advanced | authoritative SOA | `> 2026102714` |
| V7 | Vercel still valid | `get_domain_config` | `misconfigured: false` both |
| V8 | Website still serves app | load `https://www.jataaftercall.co.ke/` | JATA landing page |
| V9 | Apex still → `www` | load apex | lands on `www` |
| V10 | Certificate still valid | owner-side `openssl`/browser | valid, covering both hosts |
| V11 | **Mail flow** | authorized send/receive test | **NOT TESTED** until performed |

---

## 7. Explicitly NOT TESTED

| Item | Status | Why |
| --- | --- | --- |
| **Email receiving** | **NOT TESTED** | No authorized send test. The DNS is objectively wrong for inbound mail, but delivery failure is inferred from configuration, not observed. |
| **Email sending** | **NOT TESTED** | No outbound test; SPF is absent so deliverability is degraded, but no message was sent. |
| Certificate issuer / SAN / expiry | **NOT TESTED** | Sandbox egress blocks `openssl`/`curl` to public hosts. |
| Redirect status code (308) | **NOT TESTED** | Follows redirect; code not observable. |
| Old `dan1–dan4` zone contents | **BLOCKED** | Direct UDP/53 egress blocked. |
| Whether mail was lost during the outage | **BLOCKED** | Requires HOSTAFRICA server logs (ticket question 4). |

**I will not state that email is working, recovered, or delivered until both DNS verification and a
real mail-flow test pass.**

---

## 8. PASTE-READY SUPPORT REQUEST

> **Subject: URGENT — Email records missing after DNS change on jataaftercall.co.ke (ticket #9761478)**
>
> Hello HOSTAFRICA Support,
>
> **Reference: ticket #9761478.** Domain: **`jataaftercall.co.ke`**.
>
> Following the recent DNS change on this domain, our website records were updated correctly, but
> the domain's **email records have been lost**. Your team advised that email records and
> nameservers were left unchanged — however this is not what public authoritative DNS now shows. We
> would be grateful if you could investigate urgently, as inbound email to this domain is currently
> undeliverable.
>
> **1. Current authoritative state (verified today from `ns1.host-ww.net`, 169.239.180.4):**
>
> | Name | Type | Current value |
> |---|---|---|
> | `@` | A | `216.198.79.1`, `64.29.17.1` *(correct — please keep)* |
> | `www` | CNAME | `2da49677b2414cfd.vercel-dns-017.com.` *(correct — please keep)* |
> | `@` | MX | `0 jataaftercall.co.ke.` ← **wrong, points mail at our website** |
> | `@` | TXT | **none** ← **SPF record has been deleted** |
> | `mail` | CNAME | `jataaftercall.co.ke.` ← **was an A record** |
> | `smtp` | — | **NXDOMAIN** ← **record deleted** |
> | `pop` | — | **NXDOMAIN** ← **record deleted** |
> | `ftp` | CNAME | `jataaftercall.co.ke.` ← **was an A record** |
> | NS | NS | `ns1`–`ns4.host-ww.net` ← was `dan1`–`dan4.host-ww.net` |
> | SOA | SOA | `ns1.host-ww.net. server-admin.cloud2m.co.za. 2026102714` |
>
> It appears the zone was re-provisioned as a **website-only zone**. The SOA admin changed from
> `hostmaster.jataaftercall.co.ke` to `server-admin.cloud2m.co.za`, the nameservers changed from
> `dan1–dan4` to `ns1–ns4`, and `mail`/`ftp` became aliases to the apex.
>
> **2. What we need restored (in the CURRENT `ns1–ns4` zone — please do NOT change nameservers):**
>
> Please restore these values **exactly**, as they were before the change:
>
> - `MX @` priority **10** → `mail.jataaftercall.co.ke.` *(replacing `0 jataaftercall.co.ke.`)*
> - `TXT @` → `v=spf1 +a +mx +include:spf.host-ww.net +include:spf.antispamcloud.com ip4:169.255.59.142 ~all`
> - `A mail` → `102.218.215.41` *(delete the existing CNAME to `jataaftercall.co.ke.` first — a CNAME cannot coexist with an A record)*
> - `A smtp` → `102.218.215.41`
> - `A pop` → `102.218.215.41`
> - `A ftp` → `102.218.215.41` *(please confirm whether this is still required for our hosting package)*
>
> **Please do NOT modify these three website records** — they are live and validated by our host:
> `A @ 216.198.79.1`, `A @ 64.29.17.1`, `CNAME www 2da49677b2414cfd.vercel-dns-017.com.`
>
> **3. Nameserver question.** Please confirm: (a) which nameservers are intended and authoritative
> for this domain — `ns1–ns4.host-ww.net` or `dan1–dan4.host-ww.net`; (b) whether the move to
> `ns1–ns4` was intentional; and (c) confirm the authoritative zone can hold **both** the three
> Vercel website records above **and** the restored email records simultaneously. We do not want to
> change nameservers if doing so would revert the website records to the old server.
>
> **4. Mail continuity.** Please check and report: any delivery failures, queued/deferred messages,
> or bounces for `@jataaftercall.co.ke` since the DNS change; whether the mailbox data on the mail
> server is intact; and whether outbound mail from our mailboxes is being rejected or flagged for
> missing SPF during this period.
>
> **5. DKIM/DMARC.** Please confirm whether any DKIM key (`*._domainkey`) or `_dmarc` TXT record was
> ever published for this domain in your previous zone. Our checks show none existed before the
> change and none exist now — we need to know if anything was lost that we are not seeing.
>
> **6. Restore source.** The previous zone should still exist on `dan1–dan4.host-ww.net` (our old
> mail/web server, `102.218.215.41`). Please use it as the source of truth for the records in
> item 2.
>
> Please confirm in writing when the records are restored, and confirm you have not modified the
> three website records. Thank you — this is affecting live inbound email.
>
> Kind regards,
> JATA AFTERCALL

---

## 9. What we do next

1. **You:** confirm the `ftp` decision (§3) and send the ticket text in §8.
2. **HOSTAFRICA:** restores records in the current zone and answers questions 3–6.
3. **Me, on their confirmation:** run V1–V11 (§6) against authoritative DNS, re-check Vercel
   validation and website/HTTPS, and report each record as PASS/FAIL.
4. **Then, separately:** authorized mail-flow test (send + receive) to clear the **NOT TESTED**
   status on email. Only after that may email be described as working.
5. **Separately, on approval:** explicit apex→`www` 308; Phase D env origins; optional DMARC/SPF
   hardening.

**Recovery is not claimed. Current DNS is objectively wrong for inbound mail, and nothing has been
repaired yet.**
