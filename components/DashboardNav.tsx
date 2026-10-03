"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/subscription", label: "Subscription" },
  { href: "/dashboard/ai", label: "AI Front Desk" },
  { href: "/dashboard/studio", label: "Website studio" },
  { href: "/dashboard/pos", label: "Business POS" },
  { href: "/onboarding", label: "Add a business" },
] as const;

export function DashboardNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname() || "";
  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  return (
    <div className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 text-sm" aria-label="Dashboard sections">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="jata-nav-link" aria-current={pathname === link.href ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}

export default DashboardNav;
