import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy design URL: visual editing now lives in the unified Website Studio. */
export default async function LegacyDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/businesses/${id}/studio`);
}
