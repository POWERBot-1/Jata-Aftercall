"use client";

/** Interactive half of the dev-only category gallery preview: a picker whose saves are
 *  local state only, clearly labelled, so the real component can be tried without a login. */

import { useState } from "react";
import { CategoryImagePicker } from "@/components/media/CategoryImagePicker";
import { galleryForExperienceCategory } from "@/lib/categoryImagery";

export function PreviewClient({ categoryKey, label }: { categoryKey: string; label: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [focal, setFocal] = useState<{ x: number; y: number } | null>(null);
  return (
    <CategoryImagePicker
      gallery={galleryForExperienceCategory(categoryKey)}
      value={value}
      focal={focal}
      title={`${label} — opening image (preview only, nothing is saved)`}
      description="Exactly what Website Studio shows on Photos/Gallery, with local preview state instead of a business."
      onUse={(image) => { setValue(image.src); setFocal(image.focal); }}
      onRestore={() => { setValue(null); setFocal(null); }}
      onRemove={() => { setValue(null); setFocal(null); }}
      onFocalChange={(next) => setFocal(next)}
    />
  );
}
