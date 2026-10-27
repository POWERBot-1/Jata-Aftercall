import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = { title: "Install JATA AFTERCALL — PWA guide" };

export default function InstallPage() {
  return (
    <MarketingLayout
      eyebrow="Installable web app"
      title="Add JATA AFTERCALL to your home screen."
      intro="The installable app is this same Next.js application — one backend, one database, one subscription system. Installation adds a full-screen shortcut and a small cache of public static assets; it does not create a second app to maintain."
    >
      <MarketingSection title="Android (Chrome, Edge, Samsung Internet)" id="android">
        <div className="mk-prose">
          <ol>
            <li>Open <Link href="/">https://jata-aftercall.vercel.app</Link> in Chrome over HTTPS.</li>
            <li>Tap the browser menu (three dots) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. On supported browsers an in-app <em>Install</em> prompt also appears; <em>Not now</em> dismisses it without blocking a feature.</li>
            <li>Open the new icon. The app launches in standalone display mode with the JATA AFTERCALL name, icons and espresso theme colour, starting at the homepage.</li>
            <li>When a new version is published, a non-intrusive <em>Refresh</em> toast appears. Tap it to activate the waiting service worker and reload.</li>
          </ol>
        </div>
      </MarketingSection>

      <MarketingSection title="iPhone and iPad (Safari)" id="ios" tone="cream">
        <div className="mk-prose">
          <ol>
            <li>Open the site in <strong>Safari</strong> (iOS only supports home-screen web apps through Safari).</li>
            <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
            <li>Launch from the home screen. The apple-touch-icon and standalone metadata are already configured.</li>
            <li>iOS does not fire Chrome&apos;s install prompt, so no install toast is shown. Safari fetches new assets on navigation; if the app shows an old version, close it from the app switcher and reopen.</li>
          </ol>
          <p><strong>Honest limitation:</strong> a PWA added to the home screen is not an App Store submission package. App Store distribution requires a separately built and signed iOS application; see the release report for its current status.</p>
        </div>
      </MarketingSection>

      <MarketingSection title="Connectivity and offline behaviour" id="offline" tone="paper">
        <div className="mk-prose">
          <p>The service worker caches only versioned public static assets (icons, images, JavaScript and CSS) and a short offline notice. It never caches HTML navigations, API responses, authenticated pages, draft previews, checkout pages, AI answers, payment responses or private business data.</p>
          <ul>
            <li>When you are offline, an indicator appears and a plain offline notice replaces an unreachable navigation.</li>
            <li>AI Front Desk answers, Website Studio generation, Paystack verification, media uploads, publishing and POS synchronisation require connectivity.</li>
            <li>Offline POS sales remain a separately scoped feature: the existing till queue records unconfirmed sales with idempotency keys and replays them only when the server accepts them. No offline payment is treated as money received.</li>
          </ul>
          <p>Update detection runs when the tab becomes visible. Old static caches are deleted on activation, so a refresh cannot leave two versions of the app competing.</p>
        </div>
        <div className="mk-btn-row">
          <Link href="/" className="mk-btn">Open JATA AFTERCALL</Link>
          <Link href="/help" className="mk-btn mk-btn--ghost">More help</Link>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
