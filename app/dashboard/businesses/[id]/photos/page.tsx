import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { MediaLibrary } from "@/components/dashboard/MediaLibrary";

export const metadata: Metadata = { title: "Photos" };
export const dynamic = "force-dynamic";

/**
 * Photos (§18, §19)
 *
 * The Studio's media home: every upload, every JATA-created image and every improved photo, with
 * the tools to describe, crop, reuse and remove them. Uploads from a phone are normalized on the
 * device first, which is why this page works on a slow connection.
 */
export default async function PhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Photos</h1>
        <p className="text-sm text-zinc-600">
          Your images for {workspace.business.name}. Upload from your phone, or ask JATA to create images that match your brand.
        </p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <MediaLibrary businessId={id} heroImageUrl={workspace.document.brand.heroImageUrl || null} />
    </div>
  );
}
