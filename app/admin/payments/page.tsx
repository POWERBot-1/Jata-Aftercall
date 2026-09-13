import prisma from "@/lib/db";
export const dynamic = "force-dynamic";

export default async function AdminPayments() {
  const payments = await prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { user: true, business: true } });
  return (
    <div>
      <h1 className="text-lg font-bold">Payments</h1>
      <p className="text-xs text-zinc-500">Never exposes Paystack secret. Shows reference, amount, status, date, customer/business.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th className="px-3 py-2 text-left">Reference</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Business</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Date</th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{p.reference}</td>
                <td className="px-3 py-2 text-xs">{p.user.email}</td>
                <td className="px-3 py-2 text-xs">{p.business?.name || p.businessId || "—"}</td>
                <td className="px-3 py-2 text-center">KES {(p.amount / 100).toLocaleString()}</td>
                <td className="px-3 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.status === "PAID" ? "bg-emerald-50 text-emerald-700" : p.status === "PENDING" ? "bg-amber-50 text-amber-700" : "bg-zinc-100"}`}>{p.status}</span></td>
                <td className="px-3 py-2 text-xs text-zinc-500">{new Date(p.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
