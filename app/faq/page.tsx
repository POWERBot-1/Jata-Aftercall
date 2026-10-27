import type { Metadata } from "next";
import Link from "next/link";
import { LANDING_FAQ } from "@/lib/landing";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = { title: "Frequently asked questions — JATA AFTERCALL" };

const EXTRA_FAQ = [
  {
    question: "Can I install JATA AFTERCALL on my phone?",
    answer: "Yes. The web app has a valid manifest, icons and a privacy-safe service worker. Android Chrome offers an install prompt; on iPhone or iPad use Safari's Share → Add to Home Screen. See the installation guide for exact steps and what works offline.",
  },
  {
    question: "What works offline?",
    answer: "Only previously downloaded public static assets (icons and images) may be available. Sign-in, AI answers, payment verification, media uploads, publishing and POS synchronisation always require connectivity. The app never creates offline financial transactions.",
  },
  {
    question: "How do I change my business phone number?",
    answer: "Sign in, open your business in the dashboard and edit the nominated contact number. Kenyan numbers are validated on the server and normalised when the public page builds WhatsApp and Call links. Clearing the field removes the action rather than inventing a fallback number.",
  },
  {
    question: "Who can see my business data?",
    answer: "Your account and businesses are protected by server-side session checks and tenant isolation. Public pages show only the details you publish. Draft previews are restricted to the owner, members and platform administrators.",
  },
  {
    question: "How do I reset my password?",
    answer: "Use the Forgot password link on the sign-in page. A single-use recovery token is emailed when transactional email is configured; recovery also revokes sessions issued before the reset.",
  },
];

export default function FaqPage() {
  return (
    <MarketingLayout
      eyebrow="FAQ"
      title="Straight answers before you pay."
      intro="These answers describe behaviour in the current application. Where a capability depends on an external service, we say so instead of promising it."
    >
      <MarketingSection title="Questions owners ask" id="questions">
        <div className="lp-faq">
          {[...LANDING_FAQ, ...EXTRA_FAQ].map((item, index) => (
            <details key={item.question} className="lp-faq__item" open={index === 0}>
              <summary className="lp-faq__q"><span>{item.question}</span><span className="lp-faq__mark" aria-hidden="true" /></summary>
              <p className="lp-faq__a">{item.answer}</p>
            </details>
          ))}
        </div>
        <div className="mk-btn-row">
          <Link href="/contact" className="mk-btn">Contact &amp; support</Link>
          <Link href="/pricing" className="mk-btn mk-btn--ghost">Read the billing details</Link>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
