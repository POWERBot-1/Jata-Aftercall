import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import PaymentCallbackFixtureClient from "@/components/checkout/fixture/PaymentCallbackFixtureClient";
import { FIXTURE_CALLBACK_REFERENCE, isPaymentCallbackOutcome } from "@/lib/checkout/fixtures/paymentCallbackFixture";

/**
 * Checkout callback FIXTURE: DEVELOPMENT ONLY. `notFound()` in production. Renders the real callback UI with
 * simulated verification responses. No payment, subscription or database change is made.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment callback fixture (development only)", robots: { index: false, follow: false } };

export default async function PaymentCallbackFixturePage({ searchParams }: { searchParams: Promise<{ outcome?: string; reference?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  if (!params.reference) redirect(`/dev/payment-callback-fixture?reference=${FIXTURE_CALLBACK_REFERENCE}&outcome=${isPaymentCallbackOutcome(params.outcome) ? params.outcome : "paid"}`);
  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <PaymentCallbackFixtureClient />
    </div>
  );
}
