"use client";

/**
 * The website opening-image panel (Website Studio, image-first pass).
 *
 * Sits at the top of Photos: a large live preview, the category starter gallery, upload,
 * generate and crop-position controls. A choice is saved to the *draft* website document
 * (`brand.heroImageUrl` + focal point) through the same versioned, tenant-scoped PATCH the
 * theme editor uses, so it survives refreshes, never reaches customers before publishing,
 * and a stale window can never overwrite a newer draft.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CategoryImagePicker, type PickedImage } from "@/components/media/CategoryImagePicker";
import { galleryForExperienceCategory } from "@/lib/categoryImagery";

type Props = {
  businessId: string;
  categoryKey: string;
  heroImageUrl: string | null;
  heroFocal: { x: number; y: number } | null;
  /** Null until the owner has created their website draft. */
  draftVersion: number | null;
};

export function HeroImagePanel({ businessId, categoryKey, heroImageUrl, heroFocal, draftVersion }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<string | null>(heroImageUrl);
  const [focal, setFocal] = useState<{ x: number; y: number } | null>(heroFocal);
  const [version, setVersion] = useState<number | null>(draftVersion);
  const [conflict, setConflict] = useState<string | null>(null);

  const gallery = galleryForExperienceCategory(categoryKey);

  async function saveBrand(brand: Record<string, unknown>) {
    const response = await fetch("/api/experience", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, brand, expectedDraftVersion: version }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 || response.status === 428) {
      setConflict("Your website changed in another window, so this was not saved. The page will reload to the latest draft — nothing was overwritten.");
      router.refresh();
      throw new Error("draft_conflict");
    }
    if (!response.ok) throw new Error(data.error || "save_failed");
    const nextBrand = data.document?.brand ?? {};
    setValue(nextBrand.heroImageUrl || null);
    setFocal(
      typeof nextBrand.heroFocalX === "number" || typeof nextBrand.heroFocalY === "number"
        ? { x: nextBrand.heroFocalX ?? 50, y: nextBrand.heroFocalY ?? 45 }
        : null,
    );
    if (typeof data.experience?.draftVersion === "number") setVersion(data.experience.draftVersion);
    router.refresh();
  }

  if (!draftVersion) {
    return (
      <section className="jata-card" aria-label="Website opening image">
        <h2 className="text-base font-bold">Your website opening image</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Create your website first, then come back here to pick its opening image from the ready
          pictures for your kind of business — or use your own photo.
        </p>
        <Link href={`/dashboard/businesses/${businessId}`} className="jata-btn jata-btn-primary mt-3">
          Create my website
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-2">
      {conflict ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{conflict}</p>
      ) : null}
      <CategoryImagePicker
        gallery={gallery}
        value={value}
        focal={focal}
        businessId={businessId}
        createHref={`/dashboard/businesses/${businessId}/create`}
        title="Your website opening image"
        description="The big picture at the top of your website. Pick a ready one for your kind of business, generate one in Create, or use your own photo. Saved to your draft — customers see it when you publish."
        onUse={async (image: PickedImage) => {
          await saveBrand({ heroImageUrl: image.src, heroFocalX: image.focal.x, heroFocalY: image.focal.y });
        }}
        onRestore={async () => {
          const suggested = gallery.images[0];
          await saveBrand({ heroImageUrl: suggested.src, heroFocalX: suggested.focal.x, heroFocalY: suggested.focal.y });
        }}
        onRemove={async () => {
          await saveBrand({ heroImageUrl: "" });
        }}
        onFocalChange={async (next) => {
          await saveBrand({ heroFocalX: next.x, heroFocalY: next.y });
        }}
      />
    </div>
  );
}

export default HeroImagePanel;
