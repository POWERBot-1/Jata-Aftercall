import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";

/**
 * The admin console.
 *
 * It sits inside the same chrome as the owner workspace — one product, one header, one palette —
 * with an explicit "Platform admin" marker so it can never be mistaken for an owner account. The
 * console is restricted server-side (session role), and the header degrades to two rows on a
 * phone instead of pushing the account address and the site link off the screen.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="ws-shell">
      <a href="#main" className="jata-skip">Skip to content</a>
      <header className="ws-chrome">
        <div className="ws-chrome__row">
          <Link href="/admin" className="flex items-center gap-2" aria-label="JATA admin overview">
            <span className="jata-brand-mark">JATA</span>
            <span className="jata-brand-name">AFTERCALL</span>
          </Link>
          <span className="ws-pill ws-pill--admin">Platform admin</span>
          <div className="ws-chrome__spacer" />
          <span className="ws-chrome__account" title={session.email || ""}>{session.email}</span>
          <Link href="/dashboard" className="jata-btn jata-btn-secondary jata-btn-sm">Workspace</Link>
          <Link href="/" className="jata-btn jata-btn-ghost jata-btn-sm">Site</Link>
        </div>
        <AdminNav />
      </header>
      <main id="main" className="ws-main">
        {children}
      </main>
    </div>
  );
}
