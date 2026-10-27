# Domain readiness checklist — `jataaftercall.co.ke`

**Status of this document:** planning/runbook only. Premium Transformation Phase 5. It changes
no DNS, registrar, Vercel, email-routing or TLS configuration, and it never guesses record
values: every value below is either copied from the provider's own dashboard at execution time
or marked as a decision the owner must make first. Connecting the purchased branded domain is a
separate, explicitly approved task.

## 1. Current state (evidence)

- Purchased, intended public domain: **`jataaftercall.co.ke`** (owner-supplied; registrar and
  nameserver details to be filled in at execution — do not assume them).
- Production today runs on the Vercel project `jata-aftercall` at its `*.vercel.app` URL;
  earlier metadata-only review showed **no custom domains configured**. Re-verify in the Vercel
  dashboard before starting because this document cannot see live project settings.
- Vercel deployment protection observed earlier: SSO protection `all_except_custom_domains`.
  **Consequence to plan for:** once a custom domain is attached it is reachable publicly even
  while the `*.vercel.app` deployment stays SSO-protected — confirm this is intended for
  go-live and that no half-finished route is exposed.
- No environment variables, secrets or DNS values are read or printed by this document.

## 2. Standing rules for the connection task

1. Owner-only changes in the registrar, KeNIC/registrant portal, Cloudflare (if used) and
   Vercel dashboards. No record is created from memory or from another project's configuration.
2. One environment first — production domain only after a preview/staging verification path has
   been agreed. Never reuse the demo/preview bucket or test credentials.
3. Keep the existing `*.vercel.app` deployment working until the branded domain is verified end
   to end; rollback must always be one DNS/TTL change away.
4. Email delivery (MX/SPF/DKIM/DMARC) is a separate workstream — connecting the website must
   not change mail records.
5. No TLS termination changes beyond what Vercel provisions automatically; do not upload
   private keys into the repo or chat.

## 3. Pre-flight decisions and information to collect

| # | Item | Owner decision / source |
 | --- | --- | --- |
| 3.1 | Registrar account for `jataaftercall.co.ke` is accessible and the registrant email is monitored | Registrar portal |
| 3.2 | Auto-renew is on and the renewal date is known (`.ke` domains are managed via KeNIC-accredited registrars; registry rules differ from generic TLDs) | Registrar portal |
| 3.3 | Current nameservers and any existing DNS records exported (zone file or screenshots) before edits | Registrar/DNS host |
| 3.4 | Canonical host choice: apex (`jataaftercall.co.ke`) primary with `www` redirecting, or the reverse — pick one | Owner |
| 3.5 | Whether DNS stays at the registrar or moves to a third-party DNS host (e.g. Cloudflare) — a migration of its own, do not bundle it casually | Owner |
| 3.6 | Maintenance window and rollback owner named | Owner |
| 3.7 | Confirm no subdomain of the name is already in use for mail or another service (e.g. `www`, `mail`, `api`) | Zone export |

## 4. Vercel-side configuration (perform first, so target values are known)

1. Vercel → project `jata-aftercall` → Settings → Domains → Add `jataaftercall.co.ke` and the
   chosen `www` host.
2. Record **exactly what Vercel displays** for each host:
   - apex: the A/AAAA record value(s) Vercel shows (Vercel's own any-IP instructions — do not
     type an IP from any other source, including older runbooks);
   - `www`: the CNAME target Vercel shows (historically `cname.vercel-dns.com`, but verify
     against the dashboard at execution time).
3. Choose the redirect direction in Vercel's domain settings to match decision 3.4 so only one
   host is canonical.
4. Leave HTTPS auto-provisioning on; Vercel issues and renews the certificate once DNS
   validates. No manual certificate is required.
5. Re-check Deployment Protection: confirm the custom-domain behaviour matches the launch
   intent (see §1).

## 5. DNS execution at the registrar/DNS host

Using only the values captured in §4:

1. Lower TTLs on the records that will change (e.g. 300 s) at least one old-TTL window before
   the cutover, so rollback is fast. Restore normal TTLs after stable go-live.
2. Create the apex A/AAAA record(s) and the `www` CNAME exactly as Vercel instructs.
3. Do **not** create wildcard records, and do not change:
   - MX records (mail delivery),
   - existing TXT/SPF, DKIM selector (`*._domainkey`) or `_dmarc` records,
   - any records belonging to other services found in the §3.3 export.
4. If the DNS host is Cloudflare, start with proxy/DNS-only (grey cloud) for the new records
   until Vercel TLS validates; proxying too early can break the ACME challenge. Enable proxying
   later only as a reviewed decision.
5. Save a screenshot/export of the final zone alongside the pre-change export for the record.

## 6. Application configuration touchpoints (code/env review, no secrets here)

These are the places whose *configuration* must reference the branded origin at go-live. They
are listed so nothing is missed; values are set in Vercel environment variables, never in Git.

| Touchpoint | File / variable | Action at go-live |
 | --- | --- | --- |
| Public canonical origin for payment callbacks and password-reset links | `PUBLIC_BASE_URL` (see `lib/payments/config.ts`, `lib/password-reset-email.ts`); `NEXTAUTH_URL` fallback | Set to the canonical `https://jataaftercall.co.ke` in Production env, then redeploy |
| QR/share-link origin | `NEXT_PUBLIC_APP_URL`; hard-coded ultimate fallback `https://jata.co.ke` in `lib/qr.ts` | Set the env var; separately decide whether the `jata.co.ke` fallback should be updated in a code change |
| Paystack dashboard | Callback/webhook URLs in the Paystack settings (owner-controlled) | Add the new production origin; keep the old one working until cutover completes |
| R2 public media (when R2 is later activated) | `R2_PUBLIC_BASE_URL` in `R2_SETUP.md` | Unrelated to the apex domain unless a custom media domain is chosen later; do not conflate the two |
| Any allowlists/CORS/origin checks | Search the repo for `vercel.app` references before cutover | Update only entries that are production origin checks |

No code change is required for Vercel to serve the domain (Next.js hosts are header-driven),
but the env-based origin values above must move together or links in emails, Paystack
redirects and QR codes will point at mixed origins.

## 7. Verification (after DNS propagates)

1. `dig +short jataaftercall.co.ke A` and the AAAA/CNAME equivalents match the §4 values;
   `dig MX jataaftercall.co.ke` still returns the unchanged mail records.
2. `https://jataaftercall.co.ke/health` returns the healthy payload over HTTPS with a valid
   certificate; the non-canonical host 301/308-redirects to the canonical one.
3. Full smoke path on the branded domain: landing loads, login works, password-reset email
   links resolve to the branded origin, a demo `/b/<slug>` page renders, Paystack
   init/verify flow is exercised in test mode against the new callback, and QR/share URLs use
   the branded origin.
4. Security headers/HSTS are present (verify whatever the app already emits; do not introduce
   new headers during the same change without review).
5. Confirm Vercel TLS shows "valid" and auto-renewal is enabled; note the expiry date.
6. Re-run the smoke tests against the old `*.vercel.app` URL to confirm the rollback target is
   still healthy.

## 8. Rollback plan

1. Revert the apex/`www` records to the §3.3 export (fast because TTLs were lowered) or remove
   the custom domain from Vercel.
2. Keep `PUBLIC_BASE_URL`/`NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL` on the old origin until DNS is
   fully back, then redeploy if they were changed.
3. Leave mail records untouched throughout, so email never depends on the website cutover.
4. Record start/end times and the observed effect in the deployment log, including any partial
   propagation behaviour.

## 9. Status table (to be completed during the approved connection task)

| Check | Result | Evidence |
 | --- | --- | --- |
| Registrar/zone export captured | NOT STARTED | — |
| Vercel domain attached with dashboard-verified records | NOT STARTED | — |
| DNS validates and TLS issued | NOT STARTED | — |
| Canonical redirect behaves per decision 3.4 | NOT STARTED | — |
| Mail records unchanged | NOT STARTED | — |
| Env origins + Paystack + QR paths updated together | NOT STARTED | — |
| Smoke tests pass on branded domain | NOT STARTED | — |
| Rollback rehearsed or verified available | NOT STARTED | — |

Everything above is BLOCKED until the owner separately approves the domain-connection task;
this branch performs none of these actions.
