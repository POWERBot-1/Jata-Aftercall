"use client";

import { MediaPicker } from "@/components/dashboard/MediaPicker";
import { useOpenPagePersistence } from "./OpenPagePersistenceContext";

export function OpenPageMediaField({
  label,
  value,
  onChange,
  kind = "IMAGE",
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  kind?: "IMAGE" | "LOGO" | "HERO" | "OTHER";
}) {
  const { businessId } = useOpenPagePersistence();
  return (
    <div className="openpage-media-field mb-3 rounded-lg border border-border-default bg-bg-2 p-2.5">
      <MediaPicker
        businessId={businessId}
        label={label}
        value={value}
        onChange={onChange}
        kind={kind}
        subjectType={kind === "LOGO" ? "LOGO" : "SECTION"}
        subjectName={label}
      />
    </div>
  );
}
