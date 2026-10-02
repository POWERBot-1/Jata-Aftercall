"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function StudioTabs({ businessId, capabilities }: { businessId: string; capabilities: string[] }) {
  const base = `/dashboard/businesses/${businessId}`;
  const pathname = usePathname() || "";
  const tabs = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/sections`, label: "Sections" },
    { href: `${base}/items`, label: "Catalogue" },
    { href: `${base}/theme`, label: "Theme & brand" },
    { href: `${base}/preview`, label: "Preview" },
    ...(capabilities.includes("commerce") ? [{ href: `${base}/orders`, label: "Orders" }] : []),
    ...(capabilities.includes("booking") ? [{ href: `${base}/bookings`, label: "Bookings" }] : []),
    { href: `${base}/insights`, label: "Insights" },
  ];

  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 text-sm" aria-label="Website studio sections">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
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
