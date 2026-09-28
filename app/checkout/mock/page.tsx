import Link from "next/link";

export default function MockCheckout({ searchParams }: { searchParams: { reference?: string } }) {
  const reference = searchParams.reference || "";
  return <main className="mx-auto max-w-md px-4 py-10 text-center">
    <h1 className="text-xl font-bold">Test checkout</h1>
    <p className="mt-2 text-sm text-zinc-600">Paystack is not configured in this non-production environment. No real payment will be made.</p>
    {reference ? <>
      <p className="mt-4 break-all font-mono text-xs">Reference: {reference}</p>
      <Link href={`/checkout/callback?reference=${encodeURIComponent(reference)}&mock=success`} className="mt-6 inline-flex rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white">Simulate test payment</Link>
    </> : <p className="mt-5 text-sm text-amber-800">Missing payment reference. Return to subscription and try again.</p>}
    <p className="mt-4 text-xs text-zinc-500">The test settlement endpoint requires your signed-in account and is disabled in production.</p>
  </main>;
}
