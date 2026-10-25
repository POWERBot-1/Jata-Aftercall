"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarCheck,
  Eye,
  Home,
  Image as ImageIcon,
  LayoutTemplate,
  Package,
  Palette,
  PanelsTopLeft,
  Receipt,
  Settings2,
  UploadCloud,
} from "lucide-react";
import { cn } from "@/lib/ui";

/**
 * Studio navigation (§4, §13)
 *
 * The owner's map of their website, named in their language: Home, Website, Products & services,
 * Photos, Design, Brand, Orders & bookings, Analytics, Preview — plus the publish panel back on
 * Home. Every destination is a 44px touch target, the current section is marked with
 * `aria-current="page"` and is visibly distinct, and the row scrolls horizontally on a phone
 * rather than wrapping into an unusable grid.
 *
 * The tabs now read their colours from the shared design system (`.jata-tab`), so the Studio
 * matches the dashboard, the POS and every other owner surface under all product themes.
 */
export function StudioTabs({ businessId, capabilities }: { businessId: string; capabilities: string[] }) {
  const base = `/dashboard/businesses/${businessId}`;
  const pathname = usePathname() || "";
  const tabs = [
    { href: base, label: "Home", icon: Home, exact: true },
    // The Canvas is the editing surface; it sits second so "edit my website" is one tap from Home.
    { href: `${base}/canvas`, label: "Canvas", icon: PanelsTopLeft },
    { href: `${base}/sections`, label: "Website", icon: LayoutTemplate },
    { href: `${base}/items`, label: "Products & services", icon: Package },
    { href: `${base}/photos`, label: "Photos", icon: ImageIcon },
    { href: `${base}/design`, label: "Design", icon: Palette },
    { href: `${base}/theme`, label: "Brand & settings", icon: Settings2 },
    ...(capabilities.includes("commerce") || capabilities.includes("booking")
      ? [{ href: `${base}/orders`, label: "Orders & bookings", icon: Receipt }]
      : []),
    ...(capabilities.includes("booking") ? [{ href: `${base}/bookings`, label: "Bookings", icon: CalendarCheck }] : []),
    { href: `${base}/insights`, label: "Analytics", icon: BarChart3 },
    { href: `${base}/preview`, label: "Preview", icon: Eye },
    { href: `${base}#publish`, label: "Publish", icon: UploadCloud },
  ];

  return (
    <nav className="jata-workspace-tabs flex gap-2 overflow-x-auto pb-1" aria-label="Website studio sections">
      {tabs.map((tab) => {
        const hashless = tab.href.split("#")[0];
        const active = tab.exact ? pathname === hashless : pathname === hashless || pathname.startsWith(`${hashless}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            data-active={active ? "true" : undefined}
            className={cn("jata-tab shrink-0")}
          >
            <Icon size={15} aria-hidden="true" strokeWidth={2.25} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default StudioTabs;
