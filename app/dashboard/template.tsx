/**
 * Route transition for every workspace section.
 *
 * `template.tsx` remounts on each navigation (unlike `layout.tsx`), so the content of a section
 * eases in when the owner moves between Overview, Subscription, Studio, POS and so on. The
 * entrance is opacity/translate only and is switched off under `prefers-reduced-motion`.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="jata-route-enter">{children}</div>;
}
