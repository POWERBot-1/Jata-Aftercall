import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-zinc-50">
      <nav className="sticky top-0 z-20 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="rounded-lg bg-zinc-900 px-2.5 py-1 text-sm font-bold text-white">JATA</span>
            <span className="text-sm font-semibold">AFTERCALL</span>
            <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Dashboard</span>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-zinc-500 sm:inline">{session.email}</span>
            <Link href="/" className="rounded-full border px-3 py-1.5">View site</Link>
            <form action="/api/auth/logout" method="post">
              <button className="text-zinc-600 hover:text-zinc-900">Logout</button>
            </form>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 py-2 text-sm">
          <Link href="/dashboard" className="font-medium underline">Overview</Link>
          <Link href="/onboarding" className="text-zinc-600 hover:text-zinc-900">New business</Link>
          <Link href="/dashboard/subscription" className="text-zinc-600 hover:text-zinc-900">Subscription</Link>
          {session.role === "ADMIN" && <Link href="/admin" className="font-semibold text-zinc-900">Admin →</Link>}
        </div>
      </nav>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
