import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/db";
import { BrandMark } from "@/components/ui/BrandMark";
import { dashboardRedirectTarget } from "@/lib/ownerFlow";
import { DashboardNav } from "@/components/DashboardNav";
import { Toaster } from "@/components/ui/Toaster";
import { getTeamAccessStatus } from "@/lib/team-access";

export const dynamic = "force-dynamic";

/**
 * The workspace shell.
 *
 * Owns the platform's account chrome so it is identical on every owner screen: the graphite
 * header (brand, workspace label, signed-in account, Home, Log out), the single section rail
 * and the one notification surface (toasts).
 *
 * Layout rules enforced here:
 *   • It is the only place the owner chrome is rendered, so no screen can drift from it.
 *   • The `<main id="main">` landmark lives here, matching the skip link, so keyboard users
 *     can jump past the navigation on every page.
 *   • The shell is scoped to `.ws-shell`, which carries the workspace design tokens. Generated
 *     customer websites and public pages never inherit them.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // A brand-new account is sent to onboarding. A *member* of someone else's business (staff, or
  // an invited collaborator) is not: they already have a workspace to open, and sending them to
  // "create a business" would invite a duplicate. `businessMember` is the same membership the
  // business routes authorise against, so this is consistent with them.
  let owned: number | null = null;
  let member = false;
  try {
    owned = await prisma.business.count({ where: { ownerId: session.userId } });
    if (owned === 0) {
      member = Boolean(await prisma.businessMember.findFirst({ where: { userId: session.userId }, select: { id: true } }));
    }
  } catch {
    owned = null;
  }
  if (owned !== null && !member) {
    const dest = dashboardRedirectTarget(owned);
    if (dest) redirect(dest);
  }

  const accountName = session.email || "Account";
  // The label is derived exclusively from the server-side verified entitlement. A client flag,
  // URL parameter or profile edit cannot produce it.
  const teamAccess = await getTeamAccessStatus(session.userId);

  return (
    <div className="ws-shell min-h-screen">
      <a href="#main" className="jata-skip-link">
        Skip to content
      </a>
      <header className="ws-chrome">
        <div className="ws-chrome__row">
          <BrandMark href="/dashboard" compact />
          <span className="ws-chrome__tag">Workspace</span>
          <div className="ws-chrome__actions">
            {teamAccess.entitled ? (
              <span className="ws-pill ws-pill--team" data-team-access="active" title="Verified team entitlement — no subscription or payment required">
                {teamAccess.label}
              </span>
            ) : null}
            <span className="ws-chrome__account" title={accountName}>
              <span aria-hidden="true">●</span>
              {accountName}
            </span>
            <Link href="/" className="jata-btn jata-btn-secondary">
              Home
            </Link>
            <form action="/api/auth/logout" method="post">
              <button className="jata-btn jata-btn-ghost">Log out</button>
            </form>
          </div>
        </div>
        <DashboardNav isAdmin={session.role === "ADMIN"} />
      </header>
      <main id="main" className="ws-main">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
