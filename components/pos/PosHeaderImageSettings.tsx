"use client";

/**
 * POS header image settings.
 *
 * The owner's optional POS picture: chosen from the ready images for their trade, their
 * own gallery photo (through upload), or restored to the suggested category image. Saving
 * goes to the presentation endpoint, which is permission-checked (EDIT_CONFIGURATION),
 * tenant-scoped, and presentation-only — it can never change the till, prices or plan.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CategoryImagePicker, type PickedImage } from "@/components/media/CategoryImagePicker";
import { galleryForPosType } from "@/lib/categoryImagery";
import type { PosPresentationConfig } from "@/lib/pos/types";

type Props = {
  businessId: string;
  businessTypeKey: string;
  presentation: PosPresentationConfig;
};

export function PosHeaderImageSettings({ businessId, businessTypeKey, presentation }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<string | null>(presentation.headerImageUrl ?? null);
  const [alt, setAlt] = useState<string | undefined>(presentation.headerImageAlt);
  const [focal, setFocal] = useState<{ x: number; y: number } | null>(
    presentation.headerFocalX !== undefined || presentation.headerFocalY !== undefined
      ? { x: presentation.headerFocalX ?? 50, y: presentation.headerFocalY ?? 45 }
      : null,
  );

  async function save(next: PosPresentationConfig) {
    const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/presentation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presentation: next }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "save_failed");
    const saved = (data.presentation ?? {}) as PosPresentationConfig;
    setValue(saved.headerImageUrl ?? null);
    setAlt(saved.headerImageAlt);
    setFocal(
      saved.headerFocalX !== undefined || saved.headerFocalY !== undefined
        ? { x: saved.headerFocalX ?? 50, y: saved.headerFocalY ?? 45 }
        : null,
    );
    router.refresh();
  }

  return (
    <CategoryImagePicker
      gallery={galleryForPosType(businessTypeKey)}
      value={value}
      focal={focal}
      businessId={businessId}
      title="Your POS header image (optional)"
      description="A picture for the top of your POS, matched to your kind of business. It stays small on the Sell screen so selling is never slowed down, and changing it never affects your till or prices."
      onUse={async (image: PickedImage) => {
        await save({
          headerImageUrl: image.src,
          headerImageAlt: image.alt,
          headerFocalX: image.focal.x,
          headerFocalY: image.focal.y,
        });
      }}
      onRestore={async () => {
        await save({});
      }}
      onFocalChange={async (next) => {
        await save({
          headerImageUrl: value ?? undefined,
          headerImageAlt: alt,
          headerFocalX: next.x,
          headerFocalY: next.y,
        });
      }}
    />
  );
}

export default PosHeaderImageSettings;
