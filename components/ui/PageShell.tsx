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
  width?: "narrow" | "wide";
}) {
  return (
    <div className="jata-page">
      <div className={width === "wide" ? "jata-wide" : "jata-narrow"}>
        <BrandMark compact />
        <a href={backHref} className="jata-back">
          ← {backLabel}
        </a>
        <h1 className="jata-title">{title}</h1>
        {subtitle ? <p className="jata-subtitle">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}
