import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

export function PageShell({
  title,
  subtitle,
  children,
  backHref = "/",
  backLabel = "Back",
  width = "narrow",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
  width?: "narrow" | "wide" | "xwide";
}) {
  return (
    <div className="jata-page">
      <a href="#main" className="jata-skip-link">Skip to content</a>
      <main id="main" className={width === "xwide" ? "jata-xwide" : width === "wide" ? "jata-wide" : "jata-narrow"}>
        <BrandMark compact />
        <a href={backHref} className="jata-back">
          ← {backLabel}
        </a>
        <h1 className="jata-title">{title}</h1>
        {subtitle ? <p className="jata-subtitle">{subtitle}</p> : null}
        {children}
      </main>
    </div>
  );
}
