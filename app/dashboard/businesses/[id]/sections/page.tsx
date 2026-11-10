import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy section editor URL: editing is consolidated into Website Studio. */
export default async function LegacySectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/businesses/${id}/studio`);
}
