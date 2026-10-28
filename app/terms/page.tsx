import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = { title: "Terms of service — JATA AFTERCALL" };

export default function TermsPage() {
  return (
    <MarketingLayout
      eyebrow="Terms"
      title="Terms of service"
      intro="These terms describe the current JATA AFTERCALL service as built. Last updated 27 October 2026. They are a product description and require the owner's legal review before being relied on as a final contract."
    >
      <MarketingSection title="Using the service" id="use">
        <div className="mk-prose">
          <p>JATA AFTERCALL provides public business pages and optional paid products — AI Business Front Desk, Website Studio, Business POS and JATA Autopilot — to Kenyan micro and small businesses. You must provide accurate account and business information and keep your credentials confidential.</p>
          <p>You are responsible for the content, prices, offers and contact numbers you publish, and for having the right to use any image you upload. Do not use the service to publish unlawful, misleading, infringing or harmful content, or to attempt to access another tenant&apos;s data. We may suspend a page or account to protect other users or the platform, with the server-side audit trail recording administrative actions.</p>
        </div>
      </MarketingSection>

      <MarketingSection title="Plans, payment and activation" id="billing" tone="cream">
        <div className="mk-prose">
          <p>Prices, periods and plan scope are shown on the <Link href="/pricing">pricing page</Link> and come from the server plan catalogue. Payment is processed by Paystack using M-Pesa or a card. A plan becomes active only after the server verifies the transaction or its signed webhook; a browser redirect alone does not activate anything.</p>
          <p>Plans are prepaid for a fixed period (30 days, or 365 days for the annual page plan) and are sold per business. The current checkout makes a one-off payment and does not automatically debit a saved card. When a period ends, paid features and publication pause until you renew; your content is preserved.</p>
          <p>You can stop using a paid product at the end of a period by not renewing, and you can unpublish a page at any time. There is no self-service in-app refund button: duplicate or erroneous charges are reviewed against the verified payment record after you contact support with the payment reference. Refunds are not guaranteed by these terms. There is also no self-service full account-deletion screen yet; see the privacy policy for the current deletion-request process and its limitations.</p>
          <p>Publishing requires a confirmed entitlement. Verified JATA Team accounts receive eligible features without a payment transaction; no payment, invoice or receipt is fabricated for that entitlement.</p>
        </div>
      </MarketingSection>

      <MarketingSection title="Availability, changes and liability" id="legal" tone="paper">
        <div className="mk-prose">
          <p>Some capabilities depend on external services: Paystack for payments, an email provider for account recovery, and optional durable image storage. When a dependency is not configured, the application is designed to fail closed and say so rather than report a false success. AI-generated content is assistance, not professional advice; review it before publishing.</p>
          <p>The installable web app works offline only for previously downloaded public static assets. AI answers, payment verification, uploads, publishing and POS synchronisation require connectivity. No offline financial transaction is created.</p>
          <p>We may change features or prices with notice on the site; a change never silently alters the price of a payment already confirmed. The service is provided “as is” to the extent permitted by law, without an invented uptime guarantee or performance claim. Nothing in these terms removes rights you have under Kenyan consumer or data-protection law.</p>
          <p>Questions: <Link href="/contact">Contact &amp; support</Link> · <Link href="/privacy">Privacy policy</Link> · <Link href="/faq">FAQ</Link>.</p>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
