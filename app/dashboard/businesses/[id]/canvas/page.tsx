import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy Canvas URL: route owners into the single OpenPage-powered editor. */
export default async function LegacyCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/businesses/${id}/studio`);
}
