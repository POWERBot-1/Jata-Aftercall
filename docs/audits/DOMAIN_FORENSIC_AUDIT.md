# Domain forensic audit

**Assessment date:** 2026-10-31 UTC
**Code baseline:** `044ca8a948cdc058a2b992a4e9a7d405d3b2c3c3` (PR #76 merge; current checkout before this audit's changes)
**Official intended public domain:** `https://jataaftercall.co.ke`
**Existing production reference:** `https://jata-aftercall.vercel.app`
**Change boundary:** read-only Gmail/Vercel checks; no DNS, environment, registrar, email or production settings changed.

## Executive result

**FAIL / BLOCKED for domain acceptance.** HOSTAFRICA registration correspondence establishes a one-year registration and the registrar; Vercel project metadata lists and marks apex/www as verified and assigned. However, the records in HOSTAFRICA correspondence and the current Vercel config responses conflict (apex name servers/IPs differ; the response simultaneously says `misconfigured=false` and `ipStatus=required-change`). Current authoritative DNS and live HTTP/TLS behavior were not independently checked. Do not declare the official domain live, mail-safe, or canonical end-to-end from these records alone.

## Gmail correspondence (read-only)

| Date | Sender / subject | What it establishes | Outstanding action / reference |
|---|---|---|---|
| 2026-10-08 | HOSTAFRICA, “Your Domain jataaftercall.co.ke Has Been Successfully Registered with HOSTAFRICA” | Domain registered for one year; registration 2026-10-08, next due 2027-10-08; HOSTAFRICA client area is management entry point. This is registration evidence, not a current registry lookup or proof of DNS/email operation. | Owner should confirm renewal controls in registrar account. [Gmail message](https://mail.google.com/mail/u/0/#all/1a11bb1ef14f5c86) |
| 2026-10-27 | HOSTAFRICA, ticket #9761478 | Support says website records were changed to apex A `216.198.79.1`, `64.29.17.1` and `www` CNAME `2da49677b2414cfd.vercel-dns-017.com`, while existing mail records and name servers were left unchanged; asks owner to test propagation. | The message does not prove current DNS or SSL. [Gmail message](https://mail.google.com/mail/u/0/#all/1a17efca0130b25c) |
| 2026-10-29 02:39 EAT | Owner reply to ticket #9761478 | Owner asked for record-level email DNS recovery while preserving Vercel website records, requested final authoritative values, asked why name servers changed, requested checks for mail failures, and specifically said not to change FTP without confirmation. Earlier mail records were supplied by owner as expected values, not independently validated here. | Owner/support follow-up required. [Gmail message](https://mail.google.com/mail/u/0/#all/1a184e24a073511a) |
| 2026-10-29 09:49 EAT | HOSTAFRICA support, ticket #9761478 | Later that morning, support confirms DNS “updated successfully”; says domain active, registration/expires 2026-10-08 / 2027-10-08, registrar HOSTAFRICA EAC, nameservers `ns1.host-ww.net` and `ns2.host-ww.net`; also says no FTP record and no active web-hosting package. The email does not enumerate restored MX/SPF/DKIM/DMARC values or explicitly confirm mail delivery. | Follow up for final zone export, mail-delivery check and explanation of name-server change. [Gmail message](https://mail.google.com/mail/u/0/#all/1a1866c18db355b7) |

The Gmail search for the exact domain returned these registration and ticket messages; no credentials were copied into this report. An older message refers to name servers changing from `dan1`–`dan4.host-ww.net` to `ns1`–`ns4.host-ww.net`; the later support response names only `ns1` and `ns2`. That discrepancy is unresolved. The post-request support reply says records were updated, but it does not confirm final MX/SPF/DKIM/DMARC values or mail delivery; that is the outstanding verification, not a claim that the support response predates the owner request.

## Read-only Vercel evidence

- Project `jata-aftercall` is linked to this repository. Project-level domain listing reports `jataaftercall.co.ke`, `www.jataaftercall.co.ke`, and `jata-aftercall.vercel.app` as `verified: true`; apex and www have no redirect configured in the returned rows. Account-wide `list_domains` returned an empty list, so the project-level listing is the relevant positive evidence.
- Project production deployment listing returned a `READY`/`PROMOTED` production deployment for source commit `044ca8a948cdc058a2b992a4e9a7d405d3b2c3c3`, with the three aliases assigned. This verifies Vercel metadata, not an unauthenticated browser journey or successful certificate presentation.
- `get_domain_config(jataaftercall.co.ke)` returned nameservers `ns1`–`ns4.vercel-dns-3.com`, A values `64.29.17.3` and `216.198.79.3`, `misconfigured:false`, but also `ipStatus:required-change`.
- `get_domain_config(www.jataaftercall.co.ke)` returned HOSTAFRICA nameservers `ns1.host-ww.net`, `ns2.host-ww.net`, CNAME `2da49677b2414cfd.vercel-dns-017.com`, A values `216.198.79.65` and `64.29.17.65`, and `ipStatus:required-change`.
- `get_domain_config(jata-aftercall.vercel.app)` returned A values `216.198.79.1` and `64.29.17.1` and `ipStatus:required-change`.

These Vercel endpoint reports are internally inconsistent with one another and with the HOSTAFRICA message. A project “verified” flag is not proof of authoritative DNS, HTTPS, or mail continuity. No domain mutation, DNS change, environment variable inspection/decryption, or production deployment was performed.

## Code URL inventory and remediation

| Location | Use | Disposition |
|---|---|---|
| `lib/url.ts` | Generates business URLs; explicit `PUBLIC_BASE_URL`, then `NEXTAUTH_URL`; on Vercel falls back to `VERCEL_PROJECT_PRODUCTION_URL` and then `VERCEL_URL`; local fallback is localhost. | No production variable values were inspected. Runtime canonical origin therefore still depends on deployment configuration; validate the effective value without exposing secrets. |
| `app/layout.tsx`, `app/sitemap.ts`, `app/robots.ts` | Metadata base, sitemap and sitemap reference use `getBaseUrl()`. | Code path is centralized; live canonical output not tested. |
| Auth / checkout / Paystack | URL configuration is environment-driven in `lib/url.ts` and `lib/payments/config.ts`; webhook documentation uses `PUBLIC_BASE_URL`. | Callback, reset-email and webhook round trip were not performed. Confirm provider dashboard callback/webhook URLs through the owner-approved provider process. |
| `app/install/page.tsx` | Customer-facing install instructions previously printed the Vercel reference. | **Fixed in this branch:** instructions now link to the official domain, leaving Vercel as an operational reference. |
| `lib/qr.ts` | AI business QR URL fallback previously used unrelated `jata.co.ke`. | **Fixed in this branch:** fallback now uses `https://jataaftercall.co.ke`; explicit and configured origins still win. Added unit test. |
| `.env.example` | Public URL comment previously called `jata.link` a future domain. | **Fixed in this branch:** comment identifies the official intended domain and preserves Vercel as reference. |
| `app/dev/workspace-preview/page.tsx`, `scripts/ci/smoke-production.mjs`, historical docs/tests | Example fixtures or operational checks use `jata-aftercall.vercel.app`. | Intentional/reference use; not changed. Search also finds sample `@jata.link` identities, which are fixture/email addresses rather than public app URLs. |

## Domain acceptance matrix

| Requirement | Verdict | Evidence / limitation |
|---|---|---|
| Registration/ownership evidence | PASS (document evidence only) | HOSTAFRICA registration confirmation to owner, 2026-10-08. Not a live registry/registrant identity check. |
| Registrar and management | PASS (correspondence) | HOSTAFRICA EAC; support directs management to HOSTAFRICA client area. |
| Current authoritative DNS | FAIL / BLOCKED | HOSTAFRICA vs Vercel apex nameserver/IP output conflict; no independent DNS resolution. |
| Email routing and MX | BLOCKED | Owner supplied expected MX/A values; support says DNS updated but did not confirm resulting mail records or delivery. |
| SPF / DKIM / DMARC | BLOCKED | Prior SPF baseline referenced; no authoritative record values or domain authentication test after updates. Preserve existing mail records; owner obtains final zone export. |
| Vercel connection/verification | PASS (control-plane listing only) | Apex/www assigned and marked verified by Vercel project metadata. |
| DNS propagation | NOT TESTED | No independent authoritative/recursive DNS check. |
| SSL certificate / HTTPS | NOT TESTED | Vercel challenge metadata only; no live TLS/HTTP request evidence. |
| Canonical URL consistency | FAIL (source defect fixed; deployed value unverified) | Wrong AI QR fallback and install copy fixed; dynamic origin still depends on `PUBLIC_BASE_URL` / deployment settings. |
| Auth/reset callback | NOT TESTED | No customer test, email send or live callback. |
| Paystack callback/webhook | NOT TESTED | No provider configuration change or test payment. |
| Public business page + Studio publishing | NOT TESTED | No live official-domain browser test. |

## Safe owner follow-up

Ask HOSTAFRICA (ticket #9761478) for the current authoritative zone export, exact MX/SPF/DKIM/DMARC values, the reason for nameserver changes, and a mail-delivery/queued-bounce check after the requested repair. Compare the export with Vercel project domain configuration without changing nameservers or mail records. Then test apex/www HTTPS, redirects, certificate, callback and published business URLs from a normal external network. Do not remove or recreate records based on this report.