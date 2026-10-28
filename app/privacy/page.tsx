import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = { title: "Privacy policy — JATA AFTERCALL" };

export default function PrivacyPage() {
  return (
    <MarketingLayout
      eyebrow="Privacy"
      title="What JATA AFTERCALL stores, and why."
      intro="Plain-language description of the data the current application processes. Last updated 27 October 2026. This is a product disclosure, not a legal opinion; the owner should obtain a Kenyan-law review before treating it as a final statutory notice."
    >
      <MarketingSection title="Information we process" id="data">
        <div className="mk-prose">
          <h3>Account data</h3>
          <p>Email address, optional name and phone number, a bcrypt password hash, role, session version and password-recovery metadata. Recovery tokens are stored only as SHA-256 digests and expire.</p>
          <h3>Business data</h3>
          <p>Business name, category, description, nominated phone and WhatsApp numbers, location or coordinates, opening hours, services, prices, offers, themes, media references and website content. You choose what is published on the public /b/&lt;slug&gt; page.</p>
          <h3>Payment data</h3>
          <p>Plan selection, amount in KES, Paystack reference, verification status and payment history are stored in our database. Paystack processes M-Pesa and card details; JATA AFTERCALL does not store card numbers, CVVs or M-Pesa PINs. Webhook signatures and transaction references are verified server-side.</p>
          <h3>Usage and analytics</h3>
          <p>Public page views and selected action clicks (WhatsApp, Call, Directions, Share, service clicks) are recorded against the business. Server logs and rate-limit counters may contain hashed network identifiers for abuse prevention.</p>
          <h3>AI conversations</h3>
          <p>Where AI Business Front Desk is enabled, customer questions and grounding data are processed to produce answers. An owner can request deletion of a customer&apos;s conversation history for their business through the authenticated privacy endpoint.</p>
        </div>
      </MarketingSection>

      <MarketingSection title="How data is used and shared" id="use" tone="cream">
        <div className="mk-prose">
          <p>Data is used to create and publish your business page, operate paid features, verify payments, prevent abuse, provide support and meet record-keeping obligations. Payments go to Paystack; hosting is on Vercel; the PostgreSQL database is Neon. Media may be stored through a configured durable object-storage adapter — durable production storage is not active until the owner provisions it, and uploads fail closed rather than reporting false success.</p>
          <p>We do not sell customer contact lists. Business-owner contact details are visible only on pages the owner publishes. Tenant isolation is enforced on the server for every business-owned resource.</p>
        </div>
      </MarketingSection>

      <MarketingSection title="Retention, security and your choices" id="rights" tone="paper">
        <div className="mk-prose">
          <ul>
            <li>You can edit or clear business contact details, unpublish a page and update services and offers in the dashboard.</li>
            <li>Published content remains until you change or unpublish it. Payment and audit records are retained as financial and security evidence.</li>
            <li>Passwords are hashed, sessions are signed and revocable, sensitive endpoints are rate-limited, and audit metadata is redacted before storage.</li>
            <li>There is currently <strong>no self-service full account-deletion screen</strong>. A deletion request must be handled through the support channel once the owner configures one; do not assume an account has been erased because a page was unpublished.</li>
            <li>The installable app caches only public static assets. It does not copy your account, business, payment or AI data to the device cache.</li>
          </ul>
          <p>For a data-access, correction or deletion request, use <Link href="/contact">Contact &amp; support</Link>. Kenyan data-protection obligations (including lawful basis, data-subject requests, cross-border transfer terms and breach notification) require a specialist review commissioned by the owner; passing a technical checklist does not establish legal compliance.</p>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
