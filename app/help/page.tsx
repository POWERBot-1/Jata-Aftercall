import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = { title: "Help and support — JATA AFTERCALL" };

const TOPICS = [
  { title: "Getting started", body: "Create an account, add your business in onboarding, choose a plan, then publish once payment is confirmed.", href: "/register" },
  { title: "Plans, payment and receipts", body: "Compare prices, understand renewal and see your payment history in the dashboard.", href: "/pricing" },
  { title: "Account recovery", body: "Reset a forgotten password from the sign-in page. Recovery revokes older sessions.", href: "/forgot-password" },
  { title: "Install on a phone", body: "Android and iOS installation steps, offline limits and how updates are delivered.", href: "/install" },
  { title: "Frequently asked questions", body: "Answers about publishing, payments, contact numbers, privacy and offline behaviour.", href: "/faq" },
  { title: "Contact support", body: "The verified support channels currently available and what still needs owner configuration.", href: "/contact" },
];

export default function HelpPage() {
  return (
    <MarketingLayout eyebrow="Help" title="Find the next step." intro="JATA AFTERCALL is one application: the same account opens your public page, dashboard, billing and product workspaces.">
      <MarketingSection title="Help topics" id="topics">
        <div className="mk-grid">
          {TOPICS.map((topic) => (
            <article className="mk-card" key={topic.title}>
              <h3>{topic.title}</h3>
              <p>{topic.body}</p>
              <Link href={topic.href}>Open →</Link>
            </article>
          ))}
        </div>
      </MarketingSection>
      <MarketingSection title="Inside the dashboard" tone="cream" id="dashboard">
        <div className="mk-prose">
          <p>The signed-in workspace contains your account overview, business profile and settings, Business Page management, AI Front Desk, Website Studio, Business POS, JATA Autopilot, subscription and billing, payment history, and install guidance. Every sensitive action is checked on the server against your session and business membership.</p>
          <p>If a session expires you are returned to sign-in. If a payment is pending or failed, the entitlement stays off until the server verifies success — retrying a payment does not create duplicate access.</p>
        </div>
        <div className="mk-btn-row"><Link href="/dashboard" className="mk-btn">Open my dashboard</Link></div>
      </MarketingSection>
    </MarketingLayout>
  );
}
