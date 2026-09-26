import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/db";
import { BrandMark } from "@/components/ui/BrandMark";
import { dashboardRedirectTarget } from "@/lib/ownerFlow";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  let owned: number | null = null;
  try {
    owned = await prisma.business.count({ where: { ownerId: session.userId } });
  } catch {
    owned = null;
  }
  if (owned !== null) {
    const dest = dashboardRedirectTarget(owned);
    if (dest) redirect(dest);
  }

  return (
    <div className="jata-page min-h-screen">
      <nav className="jata-nav">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <BrandMark href="/dashboard" compact />
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-zinc-500 sm:inline">{session.email}</span>
            <Link href="/" className="jata-btn jata-btn-secondary">View site</Link>
            <form action="/api/auth/logout" method="post">
              <button className="jata-btn jata-btn-ghost">Logout</button>
            </form>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 py-2 text-sm">
          <Link href="/dashboard" className="font-semibold underline">Overview</Link>
          <Link href="/onboarding" className="text-zinc-600">New business</Link>
          <Link href="/dashboard/subscription" className="text-zinc-600">Subscription</Link>
          {session.role === "ADMIN" ? <Link href="/admin" className="font-semibold">Admin</Link> : null}
        </div>
      </nav>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
