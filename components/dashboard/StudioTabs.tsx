"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarCheck,
  Coins,
  Gift,
  Image as ImageIcon,
  Megaphone,
  MessageSquare,
  Package,
  QrCode,
  Receipt,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/ui";

/**
 * Website Studio workspace navigation.
 *
 * OpenPage is the sole website editing surface. The remaining links are business operations
 * (catalogue, media, orders, customers and analytics), not competing website editors.
 */
export function StudioTabs({ businessId, capabilities, showEnquiries = false }: { businessId: string; capabilities: string[]; showEnquiries?: boolean }) {
  const base = `/dashboard/businesses/${businessId}`;
  const pathname = usePathname() || "";
  const tabs = [
    { href: `${base}/studio`, label: "Website Studio", icon: Sparkles },
    ...(showEnquiries ? [{ href: `${base}/enquiries`, label: "Enquiries", icon: MessageSquare }] : []),
    { href: `${base}/items`, label: "Products & services", icon: Package },
    { href: `${base}/photos`, label: "Gallery", icon: ImageIcon },
    ...(capabilities.includes("commerce") || capabilities.includes("booking")
      ? [{ href: `${base}/orders`, label: "Orders & bookings", icon: Receipt }]
      : []),
    ...(capabilities.includes("booking") ? [{ href: `${base}/bookings`, label: "Bookings", icon: CalendarCheck }] : []),
    { href: `${base}/insights`, label: "Analytics", icon: BarChart3 },
    { href: `${base}/customers`, label: "Customers", icon: Users },
    { href: `${base}/promotions`, label: "Promotions", icon: Megaphone },
    { href: `${base}/loyalty`, label: "Loyalty", icon: Gift, exact: true },
    { href: `${base}/loyalty/points`, label: "Points", icon: Coins },
    { href: `${base}/qr`, label: "QR code", icon: QrCode },
  ];

  return (
    <nav className="jata-workspace-tabs flex gap-2 overflow-x-auto pb-1" aria-label="Website Studio sections">
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
