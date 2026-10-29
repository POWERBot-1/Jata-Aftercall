# Owner prerequisites for PR #76 acceptance

No secrets should be sent in chat, committed to Git, or included in test logs. These are
separate approvals; neither test configuration nor this checklist authorizes production changes.

## Durable photos — BLOCKED until isolated storage is approved and configured

1. Owner approves the potential R2 charges and a separate disposable preview bucket and
   bucket-scoped read/write token. R2 free allowance is not a spending cap. Follow
   [R2_SETUP.md](R2_SETUP.md); production storage and DNS are separate decisions.
2. In Vercel's **Preview** environment, securely set `JATA_STORAGE_PROVIDER=cloudflare-r2`,
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and
   `R2_PUBLIC_BASE_URL`. Never expose the values. `R2_ENDPOINT` is an optional S3 endpoint
   override; normally leave it unset for Cloudflare.
3. Owner explicitly approves a preview-build policy or provides a different isolated, authorized
   test environment. The documented Vercel ignored-build policy may otherwise skip previews.
4. On that environment, using authorized test accounts, test product and category upload,
   display, reload, fresh session, replacement/removal and cross-tenant application access;
   verify server-side type, size, object-key and failure handling. Public object URLs are
   intentionally public; business-scoped authorization protects application operations, not
   secrecy of a known public URL. Reference removal does not imply underlying object deletion.
5. Review evidence before a separate production activation decision. Mock providers and the
   unconfigured-storage 503 browser test do not prove real object durability.

## Password reset — BLOCKED until authorized SMTP and test mailbox are available

1. Owner securely configures server-side `PASSWORD_RESET_SMTP_URL` and `PASSWORD_RESET_FROM`
   in the appropriate environment. The URL must use `smtp:` or `smtps:` and a hostname;
   the relay must support required TLS with a trusted certificate. Set optional
   `PASSWORD_RESET_SMTP_CA` only when a private CA bundle is needed. Never disable certificate
   verification. The trusted canonical base resolves from `PUBLIC_BASE_URL`, `NEXTAUTH_URL`,
   then Vercel's production URL; production reset links require HTTPS.
2. Owner authorizes a test mailbox/account and any state-changing test. On an isolated deployment,
   send an actual email, securely receive and redeem its link, verify the new-password login and
   old-password/session behavior, expiry, single-use, rate limits and non-enumeration. The manual
   `.github/workflows/password-reset-e2e.yml` can change account state and is **not** a read-only
   production smoke; run it only with explicit authorization and securely configured workflow
   secrets, and remove the one-time token secret after use. No tokens or messages in logs/chat.
3. Deployment configuration and real delivery have not been verified merely by unit tests.

## Production

Production authenticated checks require an authorized production session and separate approval
for any mutation. Do not fabricate entitlements, change configuration, merge, or deploy while
required acceptance remains incomplete. Existing isolated synthetic-entitlement evidence is not
payment or production evidence.
