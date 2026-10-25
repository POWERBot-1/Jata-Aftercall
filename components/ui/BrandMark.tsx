import Link from "next/link";

/**
 * The JATA AFTERCALL wordmark.
 *
 * `compact` is for the small headers (dashboard, product shells) that carry no marketing line; the
 * landing header uses the full mark and its tagline, which `.lp-nav` lays out responsively.
 */
export function BrandMark({
  href = "/",
  compact = false,
  tagline = true,
}: {
  href?: string;
  compact?: boolean;
  /** Render the tagline next to the wordmark. Never duplicate it: one span, one rendered copy. */
  tagline?: boolean;
}) {
  return (
    <Link href={href} className="jata-brand">
      <span className="jata-brand-mark">JATA</span>
      <span className="jata-brand-name">AFTERCALL</span>
      {compact || !tagline ? null : <span className="jata-brand-tag">Every call leaves your business behind.</span>}
    </Link>
  );
}
