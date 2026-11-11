import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { loadWorkspace } from "@/lib/experience/workspace";
import { ensureDefaultStudioWebsite } from "@/lib/experience/ensure-default-website";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { EntitlementBanner } from "@/components/dashboard/EntitlementBanner";
import { OpenPageEditor } from "@/components/studio/openpage/OpenPageEditor";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  await loadWorkspace(id);
  return { title: "Website Studio" };
}

/**
 * The sole Website Studio editor surface.
 * OpenPage owns native site composition; JATA retains tenant identity, subscription
 * entitlement, operational tabs and the authenticated document persistence boundary.
 * Existing ExperienceDocument and public-site records are not converted or overwritten here.
 */
export default async function WebsiteStudioPage({ params }: Props) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const studioWebsite = await ensureDefaultStudioWebsite(workspace.business.id, workspace.session);
  if (!studioWebsite) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/dashboard/businesses/${workspace.business.id}`} className="jata-btn jata-btn-ghost !px-2 !py-1 text-xs">
          <ArrowLeft size={13} /> Workspace home
        </Link>
        <p className="text-xs text-[color:var(--ws-muted)]">
          Website Studio · KES 999 / 30 days
        </p>
      </div>

      <StudioTabs businessId={workspace.business.id} capabilities={workspace.profile.capabilities} />

      <EntitlementBanner
        businessId={workspace.business.id}
        entitlement={workspace.entitlement}
        isPublished={workspace.business.isPublished}
      />

      {workspace.entitlement.entitled ? (
        <OpenPageEditor
          websiteId={studioWebsite.websiteId}
          websiteName={`${workspace.business.name} Website`}
        />
      ) : (
        <section className="rounded-2xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] p-5">
          <h2 className="text-base font-semibold text-[color:var(--ws-text)]">Website Studio is locked</h2>
          <p className="mt-1 text-sm text-[color:var(--ws-muted)]">
            Activate the Website Studio subscription to open the editor. Your existing website content remains untouched.
          </p>
        </section>
      )}
    </div>
  );
}
