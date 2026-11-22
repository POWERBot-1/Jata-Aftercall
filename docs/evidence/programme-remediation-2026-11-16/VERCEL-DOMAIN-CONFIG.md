# Read-only Vercel domain configuration inspection — 2026-11-16

**Project:** `jata-aftercall`
**Team:** `powerbot-1`
**Scope:** Read-only Vercel project/domain configuration. No DNS, project, deployment, environment, email or payment setting was changed.

## Project domain records

Vercel reports both official custom domains attached to the project and verified:

| Domain | Verified | Vercel redirect target |
|---|---:|---|
| `jataaftercall.co.ke` | Yes | None configured |
| `www.jataaftercall.co.ke` | Yes | None configured |

The project also lists the Vercel aliases `jata-aftercall.vercel.app`, `jata-aftercall-powerbot-1.vercel.app` and `jata-aftercall-git-main-powerbot-1.vercel.app`.

## Apex DNS configuration as seen by Vercel

- Configuration source: external DNS.
- Nameservers: `ns1.host-ww.net`, `ns2.host-ww.net`.
- Configured A values reported by Vercel: `64.29.17.1`, `216.198.79.1`.
- Vercel recommended IPv4 values include the same pair.
- Conflicts: none reported.
- `misconfigured: false`; `ipStatus: no-change`.
- Accepted domain validation challenge: `http-01`.

## www DNS configuration as seen by Vercel

- Configuration type: CNAME.
- CNAME reported: `2da49677b2414cfd.vercel-dns-017.com.`
- Conflicts: none reported.
- `misconfigured: false`; `ipStatus: no-change`.
- Accepted domain validation challenge: `http-01`.

## Project protection metadata

- Vercel SSO protection is enabled for deployment types `all_except_custom_domains`; custom domains are excluded from that deployment protection.
- Vercel password protection is disabled.
- Trusted-IP protection is disabled.

This is configuration metadata, not a recommendation to enable SSO or password protection on the public business site. The Control route must continue enforcing its own application authorization and MFA.

## Limitations — still not accepted as production verification

- The Vercel connector reports project configuration, not an authoritative live DNS query or a HostAfrica DNS/mail-zone export.
- Direct public-domain fetches through the available web inspection path were inaccessible; this run did not verify TLS certificate chain/ciphers, HSTS, cookie attributes, canonical redirects, or mail SPF/DKIM/DMARC records.
- Both apex and www have no Vercel redirect target configured. Application-level canonical links reported in earlier checks do not prove an HTTP redirect.
- No DNS changes, domain verification changes, redirects, Vercel environment edits, deployment promotion, mail changes or payment operations were performed.

**Disposition:** Vercel domain attachment and DNS configuration metadata are PASS (read-only configuration check). The full ADMIN-009 acceptance remains BLOCKED pending independent HTTPS/HSTS/cookie/redirect verification and authoritative DNS/mail evidence from the authorized domain operator.
