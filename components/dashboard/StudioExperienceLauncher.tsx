import Link from "next/link";
import { ArrowUpRight, Eye, Image as ImageIcon, Layers3, Palette, Sparkles } from "lucide-react";

type Props = {
  businessId: string | null;
  businessName?: string;
};

/**
 * A visible Studio 2.0 launch surface built on the existing, permission-checked
 * business editor routes. It deliberately does not advertise unshipped AI,
 * multisite quotas, or rendering modes as available features.
 */
export function StudioExperienceLauncher({ businessId, businessName }: Props) {
  const base = businessId ? `/dashboard/businesses/${businessId}` : null;
  const actions = [
    { title: "Build your layout", detail: "Arrange the sections customers see first.", href: base ? `${base}/sections` : "/onboarding", icon: Layers3 },
    { title: "Art-direct your images", detail: "Choose the hero image and refine the visual story.", href: base ? `${base}/photos` : "/onboarding", icon: ImageIcon },
    { title: "Define your brand", detail: "Set the colours, typography and visual identity.", href: base ? `${base}/theme` : "/onboarding", icon: Palette },
    { title: "Preview every screen", detail: "Review the customer experience before publishing.", href: base ? `${base}/preview` : "/onboarding", icon: Eye },
  ];

  return (
    <section className="relative isolate overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#11151b] text-white shadow-[0_24px_70px_rgba(0,0,0,.2)]">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-lime-300/15 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
      <div className="relative grid gap-7 p-5 sm:p-7 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:p-9">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-lime-300/25 bg-lime-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[.18em] text-lime-200">
            <Sparkles size={13} aria-hidden="true" /> Website Studio 2.0
          </p>
          <h2 className="mt-4 max-w-lg text-3xl font-black leading-[1.04] tracking-tight sm:text-4xl">
            Make your website feel like <span className="text-lime-300">your brand.</span>
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-white/65">
            {businessName ? `Shape the ${businessName} customer experience` : "Shape your business customer experience"} with a visual-first workflow. Your edits stay in draft until you choose to publish.
          </p>
          {base ? (
            <Link href={base} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-lime-300 px-4 py-2.5 text-sm font-extrabold text-[#11151b] transition hover:-translate-y-0.5 hover:bg-lime-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-200">
              Open visual workspace <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <Link href="/onboarding" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-lime-300 px-4 py-2.5 text-sm font-extrabold text-[#11151b] transition hover:-translate-y-0.5 hover:bg-lime-200">
              Create your business <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {actions.map(({ title, detail, href, icon: Icon }, index) => (
            <Link key={title} href={href} className="group rounded-2xl border border-white/10 bg-white/[.045] p-4 transition hover:-translate-y-0.5 hover:border-lime-200/40 hover:bg-white/[.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-200">
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime-300/10 text-lime-200"><Icon size={18} aria-hidden="true" /></span>
                <span className="text-xs font-bold tabular-nums text-white/30">0{index + 1}</span>
              </div>
              <h3 className="mt-4 text-sm font-bold text-white">{title}</h3>
              <p className="mt-1 text-xs leading-5 text-white/55">{detail}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-lime-200">Open tool <ArrowUpRight size={13} aria-hidden="true" className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
