import React from "react";
import type { Metadata } from "next";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import AIConfigForm from "@/components/AIConfigForm";

export const metadata: Metadata = {
  title: "AI Business Front Desk Onboarding — JATA Aftercall",
  description: "Configure your AI Business Front Desk, Business Brain, delivery rules, payment instructions, and readiness gate.",
};

const ONBOARDING_STEPS = [
  "1. Business Profile",
  "2. Products & Services",
  "3. Pricing & Stock",
  "4. Delivery Zones & Fees",
  "5. Payment Instructions",
  "6. Policies & FAQs",
  "7. Notification Number",
  "8. Preview & Ask My Bot",
  "9. Readiness Verification",
  "10. Subscribe & Publish Live",
];

export default async function AIOnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ businessId?: string }>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const user = await getCurrentUser().catch(() => null);
  let businessId = sp?.businessId || "";
  let businessSlug = "";

  if (user) {
    const biz = await prisma.business
      .findFirst({
        where: businessId ? { id: businessId, ownerId: user.id } : { ownerId: user.id },
        select: { id: true, slug: true },
      })
      .catch(() => null);
    if (biz) {
      businessId = biz.id;
      businessSlug = biz.slug;
    }
  }

  return (
    <main id="main" className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold">AI Business Front Desk — Self-Service Setup</h1>
          <p className="mt-1 text-sm text-slate-300">
            Tell JATA how your business works. The answers become this business&apos;s digital front desk.
          </p>
        </header>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Onboarding steps">
          {ONBOARDING_STEPS.map((step) => (
            <div
              key={step}
              className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-200"
            >
              {step}
            </div>
          ))}
        </section>

        <AIConfigForm businessId={businessId || "demo-business-id"} businessSlug={businessSlug || undefined} />
      </div>
    </main>
  );
}
