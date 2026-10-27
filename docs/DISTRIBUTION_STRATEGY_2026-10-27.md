# Android and iOS distribution strategy — decision before adding any framework (2026-10-27)

**Decision: PWA-first on the existing Next.js application. No new framework, no second backend and
no duplicate subscription logic was added.** This document records the strategy *before* any
native/cross-platform client is introduced, as required by the owner directive.

## 1. Why PWA-first is the least complex supported strategy

JATA AFTERCALL already has one Next.js frontend, one Vercel-hosted server runtime, one Neon
PostgreSQL database through Prisma, one Paystack payment flow and server-verified entitlements.
The customer-facing products (Business Page, AI Front Desk, Website Studio, POS, Autopilot) are
web surfaces that work in a mobile browser. A native wrapper would add a second release pipeline,
signing material, store review cycles and device-specific entitlement code without adding a
capability the current product requires.

The PWA already implemented in this branch provides:

- a valid `public/manifest.json` (name, short name, standalone display, start URL `/`, scope `/`,
  original espresso/cream/amber theme colours, 192/512 PNG icons including a maskable icon,
  shortcuts);
- real `public/icons/*` PNGs and `public/favicon.ico` generated deterministically by
  `scripts/generate-pwa-icons.mjs` (no external artwork dependency);
- Apple touch icon and `appleWebApp` metadata in `app/layout.tsx`;
- `public/sw.js` with selective caching of versioned public static assets only, network-first
  navigations, an honest offline notice, update detection and cache cleanup;
- `components/pwa/PwaInstaller.tsx` for registration, a friendly refresh toast, online/offline
  status and a non-intrusive install prompt;
- `/install` with Android Chrome and iPhone/iPad Safari instructions and explicit connectivity
  limits.

**Verified locally (PASS):** Chromium registered and activated the service worker, served the
production build's install page, cached only `/_next/static/`, `/icons/`, `/manifest.json` and
`/offline.html`, and served the offline notice after the local server was stopped. Evidence:
`docs/evidence/pwa-evidence.json` and `docs/evidence/README.md`.
**NOT TESTED:** installation on a physical Android or iOS device, launch-from-home-screen
behaviour on those devices, OS-level update flows and store installations.

## 2. Android — stages and current status

### Stage A (selected now): installable PWA

Chrome/Edge/Samsung Internet can install the HTTPS site from the browser menu or the in-app
prompt. No Play Store account, AAB, signing key or native project is needed. This stage is
**development complete and locally browser-verified**; production installation remains **NOT
VERIFIED** until an authorized deployment and device test.

### Stage B (only if a Play listing is a business requirement): Trusted Web Activity

A TWA wraps the same PWA in a thin Android shell. It is the least-cost Play Store option because
it still uses the existing web backend and does not duplicate subscription logic. It would require
all of the following, none of which exists in this repository or in the available integrations:

- a verified application id (proposal: `ke.co.jataaftercall.app` — **proposal only, NOT
  VERIFIED**), version code/name and a release signing key held outside Git;
- Android SDK / Gradle tooling and a signed Android App Bundle (`.aab`);
- HTTPS origin verification through `/.well-known/assetlinks.json` with the release signing
  certificate fingerprint, plus approved deep links;
- removal of development URLs, debug menus and test credentials from the release build;
- Play Console internal/closed testing before production, Data safety, content rating,
  target-audience, app-access, ads and payment disclosures;
- verification that website Paystack payments comply with Google Play's payments policy for the
  chosen distribution and that no in-app digital purchase is being misrepresented.

**BLOCKED.** The Google Play Console connector/account is not available among the authorized
integrations for this conversation (the connector lookup returned `unsupported`); no Play Console
permissions, target-API requirements, testing rules, release restrictions, signing key or Android
SDK artefact could be independently inspected. No AAB was generated, no store listing was
created, and no publication or upload was attempted.

### Stage C (not recommended now): native/cross-platform client

Justified only if a native-only capability (offline barcode scanning, background Bluetooth
peripherals, deep OS integrations) becomes a product requirement. It would need a separate
architecture decision, a shared API contract and a dedicated entitlement client — explicitly out
of scope here.

## 3. iOS — stages and current status

### Stage A (selected now): Safari Add to Home Screen

A PWA is **not** an App Store submission package. iOS users can add the HTTPS site to the home
screen from Safari; the apple-touch-icon, standalone metadata and offline notice are already
configured. This stage is **development complete and locally verified in Chromium only**;
**NOT TESTED** on a real iPhone or iPad.

### Stage B (only if an App Store listing is required): native or Capacitor-style wrapper

An App Store application would need, at minimum:

- bundle id, app name, version/build number, icons, launch screens and device screenshots;
- secure session handling, universal links, account recovery, logout and entitlement handling;
- an **account-deletion** path (currently there is no self-service full account deletion screen —
  see the privacy policy and the owner report);
- Apple Developer and App Store Connect access, authorized signing/provisioning, macOS/Xcode,
  TestFlight, export-compliance and review notes, reviewer access, age rating and subscription
  configuration where applicable;
- a fresh review of Apple's current rules for digital subscriptions. **Do not assume** the
  website's Paystack flow can be copied unchanged into an iOS app; this must be checked against
  current App Review Guidelines and any applicable external-purchase entitlements before
  implementation. That policy review was **NOT PERFORMED** here.

**BLOCKED.** The Apple Developer connector/account is not available among the authorized
integrations for this conversation (connector lookup returned `unsupported`); there is no Mac or
Xcode in this environment, and no signing identity, provisioning profile, `.ipa` or TestFlight
build exists. No build, upload, review submission or publication was attempted.

## 4. Release governance and non-negotiables

- **No merge and no deployment** of this branch without fresh explicit owner authorization.
- **No production data, DNS, environment, storage or billing change** was made in this work.
- **Internal/closed testing first** for any future Android or iOS package, before any production
  submission.
- Never commit signing keys, keystore passwords, provisioning profiles, API tokens or recovery
  codes. `.gitignore` already excludes `*.pem` and `*.key`; release secrets must be supplied
  through the platform's authorized secret configuration interface, not Git.
- No fake store listing, screenshot, installation, review approval or public URL will be reported.
  A release is “published” only after the actual public listing and a real installation are
  verified.

## 5. Store-readiness checklist (all NOT STARTED / BLOCKED)

| Item | Status |
| --- | --- |
| Play Console / App Store Connect access and permissions | **BLOCKED** — connectors unsupported |
| Application/bundle id, version, build number | **NOT STARTED** (proposal only above) |
| Signed AAB / IPA, signing identity, artifact integrity | **NOT STARTED** — no keys or toolchain |
| Launcher/App icons and store artwork | **PWA icons PASS locally**; store-sized artwork **NOT STARTED** |
| Screenshots on real devices | **NOT TESTED** — only local Chromium viewport captures exist |
| Privacy policy / terms / support URL | **PASS** — `/privacy`, `/terms`, `/help`, `/contact` added; production URLs **NOT VERIFIED** until deployment |
| Data safety, content rating, target audience, app access, ads, payment disclosures | **BLOCKED** — requires store account |
| Account-deletion information | **NOT COMPLETE** — no self-service account deletion; documented honestly |
| Install, launch, auth, navigation, entitlements, recovery, logout on devices | **NOT TESTED** |
| Internal/closed testing then production submission | **NOT STARTED** — requires explicit approval |

## 6. Owner actions for distribution

1. Decide whether a Play/App Store presence is actually required, or whether the PWA install path
   is sufficient for launch.
2. If required, connect/authorize Google Play Console and Apple Developer access and confirm
   account roles, target API levels, testing rules and payment-policy requirements.
3. Provide or approve the application identifiers and release signing material through the
   platform's secret/configuration interface; never paste keys into chat or Git.
4. Provide real device testers and approve an internal/closed test cycle.
5. Commission the Apple digital-subscription policy review before implementing any in-app
   purchase flow.
6. Only after those steps, and separate explicit merge/deploy approval, consider a store
   submission. Nothing in this branch is submitted to any store.
