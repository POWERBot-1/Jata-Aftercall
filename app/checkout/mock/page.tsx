import Link from "next/link";

export default function MockCheckout({ searchParams }: { searchParams: { reference?: string; plan?: string } }) {
  const ref = searchParams.reference || "mock-ref";
  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <h1 className="text-xl font-bold">Mock Paystack Checkout (dev)</h1>
      <p className="mt-2 text-sm text-zinc-600">PAYSTACK_SECRET_KEY not set — this is a mock page for testing.</p>
      <p className="mt-4 font-mono text-xs">Reference: {ref}</p>
      <a href={`/api/paystack/verify?reference=${ref}&mock=success`} className="mt-6 inline-flex rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white">
        Simulate successful payment →
      </a>
      <p className="mt-4 text-xs text-zinc-500"><Link href="/dashboard" className="underline">Dashboard</Link> • <Link href="/" className="underline">Home</Link></p>
    </div>
  );
}
