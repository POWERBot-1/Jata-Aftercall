"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, CreditCard, LayoutGrid, PlusCircle, ShieldCheck, Store, Wand2 } from "lucide-react";
import { cn } from "@/lib/ui";

/**
 * Dashboard section navigation.
 *
 * One row of sections (Overview, Subscription, AI Front Desk, Website Studio, Business POS) plus
 * "Add a business" and, for admins, Admin. It scrolls horizontally on a phone with a minimum
 * 44px touch target per link, marks the current section with `aria-current="page"` (and a
 * visible accent underline) so a customer always knows where they are, and never hides a
 * package behind a hover-only menu.
 */
const LINKS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/subscription", label: "Subscription", icon: CreditCard },
  { href: "/dashboard/ai", label: "AI Front Desk", icon: Bot },
  { href: "/dashboard/studio", label: "Website studio", icon: Wand2 },
  { href: "/dashboard/pos", label: "Business POS", icon: Store },
  { href: "/onboarding", label: "Add a business", icon: PlusCircle },
] as const;

const ADMIN_LINK = { href: "/admin", label: "Admin", icon: ShieldCheck } as const;

export function DashboardNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname() || "";
  const links = isAdmin ? [...LINKS, ADMIN_LINK] : LINKS;

  return (
    <div className="jata-nav__sections">
      <nav className="-mx-4 flex snap-x gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Dashboard sections">
        {links.map((link) => {
          const Icon = link.icon;
          const active =
            link.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn("jata-nav-link inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 px-3")}
              aria-current={active ? "page" : undefined}
              data-active={active ? "true" : undefined}
            >
              <Icon size={16} aria-hidden="true" strokeWidth={2.25} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
      <p className="hidden items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-wider text-[color:var(--jata-muted)] md:flex">
        <BarChart3 size={14} aria-hidden="true" />
        Your workspace
      </p>
    </div>
  );
}

export default DashboardNav;
