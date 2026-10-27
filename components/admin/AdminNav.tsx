"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeCheck, Building2, CreditCard, LayoutGrid, ListChecks, ShieldCheck, Users, Wallet } from "lucide-react";

/**
 * The admin section rail.
 *
 * Same pattern as the owner workspace rail (`components/DashboardNav.tsx`): one row that scrolls
 * horizontally on a phone, 44 px targets, and `aria-current="page"` on the section you are in.
 * The labels are the platform's own words — the admin console is not a second product with its
 * own vocabulary.
 */
const LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutGrid },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/businesses", label: "Businesses", icon: Building2 },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/payments/wallet", label: "Wallet", icon: Wallet },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: BadgeCheck },
  { href: "/admin/plans", label: "Plans", icon: ListChecks },
  { href: "/admin/team-access", label: "Team access", icon: ShieldCheck },
] as const;

export function AdminNav() {
  const pathname = usePathname() || "";

  return (
    <div className="ws-rail-wrap">
      <nav className="ws-rail" aria-label="Admin sections">
        {LINKS.map((link) => {
          const Icon = link.icon;
          // `/admin` must not claim the active pill on every child route.
          const active = link.href === "/admin" ? pathname === "/admin" : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
              <Icon size={16} aria-hidden="true" strokeWidth={2.2} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default AdminNav;
