import Link from "next/link";

export function BrandMark({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="jata-brand">
      <span className="jata-brand-mark">JATA</span>
      <span className="jata-brand-name">AFTERCALL</span>
      {compact ? null : <span className="jata-brand-tag">Every call leaves your business behind.</span>}
    </Link>
  );
}
