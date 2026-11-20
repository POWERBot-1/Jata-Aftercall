# Vercel domain inspection — 2026-11-20

Scope: read-only inspection of the JATA AFTERCALL Vercel project. No DNS, registrar, certificate, redirect, or production configuration was changed.

## Project attachment

Vercel reports both `jataaftercall.co.ke` and `www.jataaftercall.co.ke` attached to project `prj_mXn1031amrZQo4gyaVumKS4FltjW` and `verified=true`. Both entries have `redirect=null` and `redirectStatusCode=null`; neither host has a canonical redirect configured in Vercel project-domain metadata.

## External DNS configuration reported by Vercel

- `configuredBy=http`
- `serviceType=external`
- Nameservers: `ns1.host-ww.net`, `ns2.host-ww.net`
- A values reported: `64.29.17.1`, `216.198.79.1`
- Recommended Vercel IPv4 target: `76.76.21.21`
- Recommended CNAME target: `cname.vercel-dns.com.`
- `ipStatus=required-change`
- `misconfigured=false`

The metadata is internally mixed: Vercel says the domain is not misconfigured while also reporting an IP change is required. Treat this as a DNS alignment warning, not proof of a broken or correctly routed public endpoint. Nameservers indicate an external HostAfrica-managed DNS zone.

## Access and verification limits

The Vercel DNS-record listing endpoint returned HTTP 403 `forbidden` for this connected identity. No CLI fallback was available in this session. Direct public HTTP/TLS inspection through the web retrieval service was inaccessible. Therefore no claim is made about authoritative live DNS answers, certificate chain/expiry, HSTS, HTTP-to-HTTPS behavior, canonical redirect, cookie attributes, SPF, DKIM, or DMARC.

## Disposition

- Vercel attachment and verification metadata: observed.
- Canonical apex/www redirect: absent in Vercel metadata.
- DNS target alignment: requires review; Vercel reports `ipStatus=required-change`.
- Public TLS/HTTP and mail-authentication acceptance: NOT TESTED.
- DNS, registrar, redirect, certificate and mail changes: NOT PERFORMED; owner authorization is required.
