"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/pos/presentation";

/**
 * The generated POS navigation (§23, §24).
 *
 * Rendered from the configuration, so a restaurant sees Menu and Kitchen while a garage sees Job
 * cards and Parts. The links are the same component everywhere — only the list differs.
 */
export function PosNav({ items, basePath }: { items: NavItem[]; basePath: string }) {
  const pathname = usePathname() || "";
  return (
    <nav className="pos-nav" aria-label="POS sections">
      {items.map((item) => {
        const active = item.href === basePath ? pathname === basePath : pathname.startsWith(item.href);
        return (
          <Link key={item.key} href={item.href} className="pos-nav-link" aria-current={active ? "page" : undefined} data-active={active ? "true" : undefined}>
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
