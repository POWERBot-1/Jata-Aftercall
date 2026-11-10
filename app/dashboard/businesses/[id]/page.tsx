import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// Preserve the storefront-emission metadata gate while routing owners into the
// unified OpenPage editor. The shared workspace load remains tenant-scoped.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  await loadWorkspace(id);
  return { title: "Website Studio" };
}

/**
 * Single-entry Website Studio cutover.
 * Existing business data, published storefronts, subscriptions and APIs are untouched.
 * All owner editing now starts in the OpenPage-powered prompt-first Studio.
 */
export default async function LegacyStudioHome({ params }: Props) {
  const { id } = await params;
  redirect(`/dashboard/businesses/${id}/studio`);
}
