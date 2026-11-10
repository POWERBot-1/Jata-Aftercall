"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarCheck,
  Coins,
  Eye,
  Gift,
  Home,
  Image as ImageIcon,
  Megaphone,
  Package,
  QrCode,
  Receipt,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/ui";

/**
 * Studio navigation (§4, §13)
 *
 * The owner's business tools remain available, while all website editing is consolidated into
 * the single OpenPage-powered Website Studio. Every destination is a 44px touch target, the current section is marked with
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
    // One editing surface: OpenPage-powered prompt generation, refinement, preview and publishing.
    { href: `${base}/studio`, label: "Website Studio", icon: Sparkles },
    { href: `${base}/items`, label: "Products & services", icon: Package },
    { href: `${base}/photos`, label: "Gallery", icon: ImageIcon },
    { href: `${base}/theme`, label: "Brand & settings", icon: Settings2 },
    ...(capabilities.includes("commerce") || capabilities.includes("booking")
      ? [{ href: `${base}/orders`, label: "Orders & bookings", icon: Receipt }]
      : []),
    ...(capabilities.includes("booking") ? [{ href: `${base}/bookings`, label: "Bookings", icon: CalendarCheck }] : []),
    { href: `${base}/insights`, label: "Analytics", icon: BarChart3 },
    // Business Hub: customer conversion and retention on the KES149 / KES999 Business Page.
    // These four are available to every business — they do not depend on an Interactive Business
    // experience, because the Business Page subscription is what they extend.
    { href: `${base}/customers`, label: "Customers", icon: Users },
    { href: `${base}/promotions`, label: "Promotions", icon: Megaphone },
    // Loyalty has two independent mechanisms: the stamp card and the points programme. Each is
    // exact-matched so the two tabs never both light up.
    { href: `${base}/loyalty`, label: "Loyalty", icon: Gift, exact: true },
    { href: `${base}/loyalty/points`, label: "Points", icon: Coins },
    { href: `${base}/qr`, label: "QR code", icon: QrCode },
    { href: `${base}/preview`, label: "Preview", icon: Eye },
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
