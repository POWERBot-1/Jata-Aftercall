import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui";

export type Crumb = { label: string; href?: string };

/**
 * Page header: breadcrumb, one h1, a short explanation and the page's primary actions.
 *
 * The h1 lives here so a screen cannot forget it, and every dashboard/package page reuses the
 * same heading scale, spacing and action placement.
 */
export function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
  className,
  id = "page-title",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <header className={cn("jata-page-head", className)}>
      <div className="jata-page-head__copy">
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb">
            <ol className="jata-breadcrumb">
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 ? (
                    <span className="jata-breadcrumb__sep" aria-hidden="true">
                      /
                    </span>
                  ) : null}
                  {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 id={id} className="jata-page-head__title">
          {title}
        </h1>
        {subtitle ? <p className="jata-page-head__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="jata-page-head__actions">{actions}</div> : null}
    </header>
  );
}

export default PageHeader;
