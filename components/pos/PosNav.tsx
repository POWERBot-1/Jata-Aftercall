"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Home,
  LayoutList,
  Package,
  Plus,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import type { NavItem } from "@/lib/pos/presentation";

/**
 * The generated POS navigation (§23, §24).
 *
 * Rendered from the configuration, so a restaurant sees Menu and Kitchen while a garage sees Job
 * cards and Parts. The links are the same component everywhere — only the list differs.
 *
 * Iconography comes from the shared design system (Lucide), keyed on the module so the
 * configuration stays a plain data structure. A module without a mapped icon still renders the
 * configuration's own glyph, so no trade is ever left without its label or icon.
 */
const MODULE_ICONS: Record<string, typeof Home> = {
  dashboard: Home,
  sell: ShoppingCart,
  payment: CreditCard,
  payments: CreditCard,
  history: ScrollText,
  sales: Receipt,
  orders: ClipboardList,
  appointments: CalendarDays,
  jobs: Wrench,
  projects: ClipboardList,
  produce: Boxes,
  menu: LayoutList,
  products: Package,
  services: Wrench,
  customers: Users,
  credit: Banknote,
  inventory: Boxes,
  branches: Building2,
  suppliers: Truck,
  purchases: Package,
  staff: Users,
  reports: LayoutList,
  settings: Settings,
  notifications: Bell,
  records: ScrollText,
};

function iconFor(item: NavItem) {
  const key = (item.href.split("/").filter(Boolean).pop() || item.key || "").toLowerCase();
  const Icon = MODULE_ICONS[item.key?.toLowerCase?.() ?? ""] ?? MODULE_ICONS[key];
  if (Icon) return <Icon size={16} aria-hidden="true" strokeWidth={2.25} />;
  if (item.key === "sell") return <Plus size={16} aria-hidden="true" strokeWidth={2.5} />;
  return <span aria-hidden="true">{item.icon}</span>;
}

export function PosNav({ items, basePath }: { items: NavItem[]; basePath: string }) {
  const pathname = usePathname() || "";
  return (
    <nav className="pos-nav" aria-label="POS sections">
      {items.map((item) => {
        const active = item.href === basePath ? pathname === basePath : pathname.startsWith(item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            className="pos-nav-link"
            aria-current={active ? "page" : undefined}
            data-active={active ? "true" : undefined}
          >
            {iconFor(item)}
            <span>{item.label}</span>
            {active ? <ChevronRight size={14} aria-hidden="true" className="opacity-60" /> : null}
          </Link>
        );
      })}
      <Link href="/dashboard/pos" className="pos-nav-link" aria-label="All businesses with Business POS">
        <Store size={16} aria-hidden="true" strokeWidth={2.25} />
        <span>All POS</span>
      </Link>
    </nav>
  );
}

export default PosNav;
