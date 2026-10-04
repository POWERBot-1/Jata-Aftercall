import { StudioCopilot } from "@/components/dashboard/StudioCopilot";
import { StudioHistory } from "@/components/dashboard/StudioHistory";

/**
 * Every Studio screen shares the assistant and the history (§5, §45).
 *
 * Both are children of the dashboard layout, so they inherit the `<main id="main">` landmark and
 * the owner's session, and they can read the same business the page is showing. Undo/Redo covers
 * sections, design, photos, catalogue edits and AI content with one dataset.
 */
export default async function BusinessStudioLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      {children}
      <StudioHistory businessId={id} />
      <StudioCopilot businessId={id} />
    </>
  );
}
