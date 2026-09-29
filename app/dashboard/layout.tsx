import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/db";
import { BrandMark } from "@/components/ui/BrandMark";
import { dashboardRedirectTarget } from "@/lib/ownerFlow";
import { DashboardNav } from "@/components/DashboardNav";

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
      <a href="#main" className="jata-skip-link">Skip to content</a>
      <nav className="jata-nav" aria-label="Account">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2">
          <BrandMark href="/dashboard" compact />
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-zinc-600 sm:inline">{session.email}</span>
            <Link href="/" className="jata-btn jata-btn-secondary">Home</Link>
            <form action="/api/auth/logout" method="post">
              <button className="jata-btn jata-btn-ghost">Log out</button>
            </form>
          </div>
        </div>
        <DashboardNav isAdmin={session.role === "ADMIN"} />
      </nav>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
