import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  await loadWorkspace(id);
  return { title: "Website Studio" };
}

/**
 * The former JATA editor home is retired.
 *
 * Resolve the business through the existing tenant-scoped workspace guard, then send the owner
 * directly to the sole Website Studio: the OpenPage-powered editor. No business, site, media,
 * revision, subscription or publication records are changed by this route.
 */
export default async function BusinessStudioHome({ params }: Props) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  redirect(`/dashboard/businesses/${id}/studio`);
}
