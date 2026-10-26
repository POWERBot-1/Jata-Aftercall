import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  CATEGORY_IMAGES,
  EXPERIENCE_CATEGORY_IMAGE,
  POS_TYPE_IMAGE,
  focalToObjectPosition,
  imageForPosType,
} from "@/lib/categoryImagery";
import { CREATIVE_EXAMPLES, parseCreativeInstruction } from "@/lib/creative/intent";
import { PosHeaderImage } from "@/components/pos/PosHeaderImage";
import { PreviewClient } from "./PreviewClient";

/**
 * Developer preview of the image-first category gallery, POS header and creative intent
 * reading. Development only (`notFound()` in a production build, no environment flag can
 * switch it on). It renders the real registry and components with no database and no
 * login, so the owner can review every category picture at phone and desktop widths.
 * Nothing here saves anything or claims AI generation happened.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Category gallery preview (development only)",
  robots: { index: false, follow: false },
};

export default function CategoryGalleryPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <header>
        <p className="jata-kicker">Development preview — not a customer page</p>
        <h1 className="text-2xl font-bold">Image-first category gallery</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Every Website Studio category and POS trade below resolves from the real registries. AI-made illustrations are labelled as such.
        </p>
      </header>

      <PreviewClient categoryKey="electronics" label="Electronics" />

      <section aria-label="POS headers" className="space-y-3">
        <h2 className="text-lg font-bold">POS headers by trade</h2>
        {["grocery", "pharmacy", "hardware", "restaurant"].map((typeKey) => {
          const image = imageForPosType(typeKey);
          return (
            <div key={typeKey} className="pos-shell">
              <p className="text-sm font-semibold capitalize">{typeKey.replace(/_/g, " ")}</p>
              <PosHeaderImage
                image={{
                  src: image.src, srcSet: image.srcSet, webp: image.webp, webpSrcSet: image.webpSrcSet,
                  alt: image.alt, width: image.width, height: image.height,
                  focal: focalToObjectPosition(image.focal),
                }}
              />
            </div>
          );
        })}
      </section>

      <section aria-label="Creative command reading">
        <h2 className="text-lg font-bold">How Create reads a command</h2>
        <ul className="mt-2 space-y-2">
          {CREATIVE_EXAMPLES.map((example) => {
            const intent = parseCreativeInstruction(example, { hasReferenceImage: example.toLowerCase().includes("photo") });
            return (
              <li key={example} className="rounded-xl border bg-white px-3 py-2 text-sm">
                <span className="font-semibold">“{example}”</span>
                <span className="block text-zinc-600">→ {intent.mediaType} · {intent.aspect} · {intent.understood}{intent.followUp ? ` · Asks: ${intent.followUp}` : ""}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="All category images">
        <h2 className="text-lg font-bold">All category images ({Object.keys(CATEGORY_IMAGES).length})</h2>
        <p className="text-sm text-zinc-600">
          {Object.keys(EXPERIENCE_CATEGORY_IMAGE).length} Website Studio categories · {Object.keys(POS_TYPE_IMAGE).length} POS trades mapped.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Object.values(CATEGORY_IMAGES).map((image) => (
            <li key={image.id} className="overflow-hidden rounded-2xl border bg-white">
              <picture>
                {image.webp ? <source srcSet={image.webpSrcSet} type="image/webp" sizes="300px" /> : null}
                <img src={image.src} srcSet={image.srcSet} sizes="300px" alt={image.alt} width={image.width} height={image.height}
                  loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover"
                  style={{ objectPosition: focalToObjectPosition(image.focal) }} />
              </picture>
              <p className="px-2.5 py-2 text-[13px] font-bold">{image.label}</p>
              <p className="px-2.5 pb-2 text-[11px] text-zinc-500">{image.provenance === "ai-generated-illustration" ? "AI-made illustration" : "Illustrative photo"}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
