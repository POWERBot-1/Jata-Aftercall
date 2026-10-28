import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = { title: "Contact and support — JATA AFTERCALL" };

export default function ContactPage() {
  return (
    <MarketingLayout
      eyebrow="Support"
      title="Contact and support"
      intro="We only publish support routes that actually work. No invented email address, phone number or live-chat widget is shown here."
    >
      <MarketingSection title="Available now" id="available">
        <div className="mk-grid">
          <article className="mk-card">
            <h3>Account help</h3>
            <p>Sign in to open your dashboard, business settings and payment history. Most changes are made there, not by email.</p>
            <Link href="/login">Sign in →</Link>
          </article>
          <article className="mk-card">
            <h3>Password recovery</h3>
            <p>Use the self-service recovery flow. It requires the transactional email service to be configured in production; if it is not, delivery will fail and the screen says so.</p>
            <Link href="/forgot-password">Reset my password →</Link>
          </article>
          <article className="mk-card">
            <h3>Answers and guides</h3>
            <p>FAQ, billing details, product pages and phone installation instructions are available without signing in.</p>
            <Link href="/help">Open help →</Link>
          </article>
          <article className="mk-card">
            <h3>Create an account</h3>
            <p>Register, add your business, choose a plan and pay through the existing Paystack checkout.</p>
            <Link href="/register">Get started →</Link>
          </article>
        </div>
      </MarketingSection>

      <MarketingSection title="What still needs owner configuration" tone="cream" id="pending">
        <div className="mk-prose">
          <p>A verified public support email address, phone number and ticketing mailbox have not been configured in the repository or the Vercel project inspected for this release. Transactional email also depends on <code>PASSWORD_RESET_SMTP_URL</code> and <code>PASSWORD_RESET_FROM</code>, which were not present in the production environment list. Until the owner supplies and verifies a support channel, this page deliberately does not offer a contact form that would silently discard a message.</p>
          <p>For billing disputes, include the Paystack payment reference shown in your dashboard payment history. Support can then match it to the server-verified transaction record.</p>
        </div>
        <div className="mk-btn-row">
          <Link href="/dashboard/subscription" className="mk-btn">Payment history</Link>
          <Link href="/faq" className="mk-btn mk-btn--ghost">Read the FAQ</Link>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
