# ADMIN-009 canonical-domain code remediation — 2026-11-22

## Read-only Vercel findings

Project `jata-aftercall` is linked to `POWERBot-1/Jata-Aftercall`.

- Vercel project metadata lists `jataaftercall.co.ke` and `www.jataaftercall.co.ke` as attached and `verified: true`.
- Both project-domain records have `redirect: null` and no redirect status code.
- The project metadata reports `live: false`; latest deployment `dpl_5uyi1mavQCNDKd4bGMnGoC8k4556` is `ERROR`, with no production target.
- `get_domain_config` reports external HostAfrica nameservers `ns1.host-ww.net`, `ns2.host-ww.net` for both names. Apex and www return current A values `64.29.17.1` and `216.198.79.1`; www also reports CNAME `2da49677b2414cfd.vercel-dns-017.com.`. Vercel recommends IPv4 `76.76.21.21` and CNAME `cname.vercel-dns.com.`, with `ipStatus=required-change` and `misconfigured=false`.
- The Vercel account-level domain record endpoint returned HTTP 403 (no access). Direct public retrieval of apex and www HTTPS URLs was also inaccessible through the available browser retrieval path. Neither result proves that the website is down or that TLS is invalid; independent external DNS/HTTP/TLS checks remain NOT TESTED.
- No environment variable values or secrets were inspected.

## Code remediation in this candidate

- `lib/url.ts` continues to honour explicit non-localhost `PUBLIC_BASE_URL` and `NEXTAUTH_URL` first.
- If running in Vercel production with no explicit origin (or only localhost placeholders), canonical URL generation now falls back to `https://jataaftercall.co.ke`, never a Vercel deployment alias.
- Preview environments continue to use the stable `VERCEL_PROJECT_PRODUCTION_URL` before any ephemeral deployment host.
- `next.config.js` permanently redirects only `www.jataaftercall.co.ke` to `https://jataaftercall.co.ke`, preserving the path. The Vercel operational aliases are not redirected.
- Added tests for production fallback, explicit overrides, preview origin, local fallback and the www-only redirect.

## Still BLOCKED

1. DNS is externally managed by HostAfrica. No DNS, nameserver, A, CNAME, MX, TXT, SPF, DKIM or DMARC changes were made.
2. Vercel reports `ipStatus=required-change`; compare the current HostAfrica zone export with Vercel's current recommended records before any separately approved DNS action.
3. Verify externally: apex and www HTTP→HTTPS behavior, certificate chain/hostname, HSTS, final redirect, canonical tags, cookie domain/Secure/SameSite behavior, sitemap/robots origins and business-page URLs.
4. Obtain the authoritative zone export and verify mail routing/authentication; preserve existing MX/SPF/DKIM/DMARC records.
5. Confirm the effective production `PUBLIC_BASE_URL` / `NEXTAUTH_URL` values through an owner-approved, secret-safe metadata check. This candidate did not read environment values.

## Release boundary

Exact-head CI and independent browser acceptance are pending. The code changes are not deployed. No registrar/DNS/environment/provider/payment/production database/merge/deployment mutation occurred.
