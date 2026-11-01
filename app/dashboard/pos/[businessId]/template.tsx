/** Route transition for POS screens (sell, sales, reports, payments…). See app/dashboard/template.tsx. */
export default function PosTemplate({ children }: { children: React.ReactNode }) {
  return <div className="jata-route-enter">{children}</div>;
}
