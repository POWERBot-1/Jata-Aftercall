"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { key: string; label: string; shortLabel: string; glyph: string; href: string; description?: string };

function isActive(pathname: string | null, item: Item): boolean {
  if (!pathname) return false;
  if (item.href.startsWith("/dashboard/pos/")) return pathname.startsWith(item.href);
  if (item.key === "home") return /^\/dashboard\/erp\/[^/]+\/?$/.test(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function ErpSidebarGroup({ heading, items }: { heading: string; items: Item[] }) {
  const pathname = usePathname();
  return (
    <nav className="erp-nav-group" aria-label={heading}>
      <span className="erp-nav-heading">{heading}</span>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="erp-nav-link"
          data-active={isActive(pathname, item)}
          aria-current={isActive(pathname, item) ? "page" : undefined}
          title={item.description}
        >
          <span className="erp-nav-glyph" aria-hidden="true">{item.glyph}</span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function ErpMobileBar({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return (
    <nav className="erp-mobile-bar" aria-label="Main navigation">
      {items.map((item) => (
        <Link key={item.key} href={item.href} data-active={isActive(pathname, item)} aria-current={isActive(pathname, item) ? "page" : undefined}>
          <span className="glyph" aria-hidden="true">{item.glyph}</span>
          <span>{item.shortLabel}</span>
        </Link>
      ))}
    </nav>
  );
}
