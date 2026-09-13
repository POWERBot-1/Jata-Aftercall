import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="min-h-screen bg-zinc-50">
      <nav className="sticky top-0 z-20 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="rounded-lg bg-zinc-900 px-2.5 py-1 text-sm font-bold text-white">JATA</span>
            <span className="text-sm font-semibold">ADMIN</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-500">{session.email} (ADMIN)</span>
            <Link href="/dashboard" className="rounded-full border px-3 py-1">Dashboard</Link>
            <Link href="/" className="text-zinc-600">Site</Link>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 py-2 text-sm">
          <Link href="/admin" className="font-semibold underline">Overview</Link>
          <Link href="/admin/customers" className="text-zinc-600">Customers</Link>
          <Link href="/admin/businesses" className="text-zinc-600">Businesses</Link>
          <Link href="/admin/payments" className="text-zinc-600">Payments</Link>
          <Link href="/admin/subscriptions" className="text-zinc-600">Subscriptions</Link>
          <Link href="/admin/plans" className="text-zinc-600">Plans</Link>
        </div>
      </nav>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
