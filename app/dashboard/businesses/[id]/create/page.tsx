import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy creative surface URL: return to the unified prompt-first Website Studio. */
export default async function LegacyCreatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/businesses/${id}/studio`);
}
