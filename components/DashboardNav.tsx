"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, CreditCard, LayoutGrid, Network, PlusCircle, ShieldCheck, Sparkles, Store, Wand2 } from "lucide-react";

/**
 * The workspace section rail.
 *
 * All workspace sections share this rail. Links wrap on narrow screens and keep a 44px
 * touch target; the active section is identified visually and with aria-current.
 */
const LINKS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/subscription", label: "Subscription", icon: CreditCard },
  { href: "/dashboard/ai", label: "AI Front Desk", icon: Bot },
  { href: "/dashboard/studio", label: "Website Studio", icon: Wand2 },
  { href: "/dashboard/pos", label: "Business POS", icon: Store },
  { href: "/dashboard/erp", label: "BOS", icon: Network },
  { href: "/dashboard/autopilot", label: "Autopilot", icon: Sparkles },
  { href: "/onboarding", label: "Add a business", icon: PlusCircle },
] as const;

const ADMIN_LINK = { href: "/admin", label: "Admin", icon: ShieldCheck } as const;

export function DashboardNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname() || "";
  const links = isAdmin ? [...LINKS, ADMIN_LINK] : LINKS;

  return (
    <div className="ws-rail-wrap">
      <nav className="ws-rail ws-rail--workspace" aria-label="Workspace sections">
        <span className="sr-only">
          <BarChart3 size={14} aria-hidden="true" /> Your workspace
        </span>
        {links.map((link) => {
          const Icon = link.icon;
          const active =
            link.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
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

export default DashboardNav;
