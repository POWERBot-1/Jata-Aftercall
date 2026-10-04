"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Studio navigation (§4, §13)
 *
 * The owner's map of their website, named in their language: Home, Website, Products & services,
 * Photos, Design, Brand, Orders & bookings, Analytics, Preview — plus the publish panel back on
 * Home. Horizontal scroll keeps every destination reachable on a phone without tiny tap targets.
 */
export function StudioTabs({ businessId, capabilities }: { businessId: string; capabilities: string[] }) {
  const base = `/dashboard/businesses/${businessId}`;
  const pathname = usePathname() || "";
  const tabs = [
    { href: base, label: "Home", exact: true },
    { href: `${base}/sections`, label: "Website" },
    { href: `${base}/items`, label: "Products & services" },
    { href: `${base}/photos`, label: "Photos" },
    { href: `${base}/design`, label: "Design" },
    { href: `${base}/theme`, label: "Brand & settings" },
    ...(capabilities.includes("commerce") || capabilities.includes("booking") ? [{ href: `${base}/orders`, label: "Orders & bookings" }] : []),
    ...(capabilities.includes("booking") ? [{ href: `${base}/bookings`, label: "Bookings" }] : []),
    { href: `${base}/insights`, label: "Analytics" },
    { href: `${base}/preview`, label: "Preview" },
    { href: `${base}#publish`, label: "Publish" },
  ];

  return (
    <nav className="jata-workspace-tabs flex gap-2 overflow-x-auto pb-1 text-sm" aria-label="Website studio sections">
      {tabs.map((tab) => {
        const hashless = tab.href.split("#")[0];
        const active = tab.exact ? pathname === hashless : pathname === hashless || pathname.startsWith(`${hashless}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 font-semibold ${
              active ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
