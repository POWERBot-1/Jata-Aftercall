/**
 * Landing icon set — inline SVG, no icon dependency and no client JavaScript.
 *
 * Strokes use `currentColor`, so an icon inherits the colour of the card it sits in and stays
 * legible in both the light and dark sections of the landing page.
 */
import type { LandingIconKey } from "@/lib/landing";

const paths: Record<LandingIconKey, React.ReactNode> = {
  phone: (
    <>
      <path d="M7.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M10 6.5h4" />
      <path d="M11 17.5h2" />
    </>
  ),
  tag: (
    <>
      <path d="M12.6 3.6 20 11a1.7 1.7 0 0 1 0 2.4l-6.6 6.6a1.7 1.7 0 0 1-2.4 0L3.6 12.6A1.7 1.7 0 0 1 3 11.4V5a2 2 0 0 1 2-2h6.4c.4 0 .9.2 1.2.6Z" />
      <path d="M7.5 7.5h.01" />
    </>
  ),
  map: (
    <>
      <path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
  cart: (
    <>
      <path d="M3.5 4.5h1.9l2.2 10.4h9.6" />
      <path d="M7 8.5h12l-1.6 6.4H8" />
      <circle cx="9" cy="19" r="1.3" />
      <circle cx="17.5" cy="19" r="1.3" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5 13.6 9l5.4 1.7-5.4 1.7L12 18l-1.6-5.6L5 10.7 10.4 9Z" />
      <path d="M18.5 16.5l.7 2.2 2.3.8-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.8Z" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V5" />
      <path d="M4 20h16" />
      <path d="M8 20v-6" />
      <path d="M12.5 20V8.5" />
      <path d="M17 20v-4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v6c0 4.2-2.9 7.3-7 8.5-4.1-1.2-7-4.3-7-8.5V6Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  bolt: <path d="M13.5 3 6 13.5h4.5L10 21l7.5-10.5H13Z" />,
};

export function LandingIcon({ name, className = "" }: { name: LandingIconKey; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export default LandingIcon;
