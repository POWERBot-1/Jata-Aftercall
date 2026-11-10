import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Single-entry Website Studio cutover.
 * Existing business data, published storefronts, subscriptions and APIs are untouched.
 * All owner editing now starts in the OpenPage-powered prompt-first Studio.
 */
export default async function LegacyStudioHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/businesses/${id}/studio`);
}
