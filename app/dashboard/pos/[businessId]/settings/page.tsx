import prisma from "@/lib/db";
import { getOwnedBusinessIds } from "@/lib/tenant";
import { auditActionLabel, listPosAudit } from "@/lib/pos/audit";
import { CLONE_SCOPES, TEMPLATE_LIBRARY, describeCloneScope } from "@/lib/pos/templates";
import { listVersions } from "@/lib/pos/provisioning";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { SettingsClient } from "@/components/pos/SettingsClient";

/**
 * Settings (§25, §26, §37, §48).
 *
 * Publishing, history, copying a setup, templates and the activity log — all owner-level, all
 * audited. Nothing here can reach another business: the copy targets are listed from
 * authenticated membership, and the server re-checks ownership of both sides before copying.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "POS settings" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosSettingsPage({ params }: Props) {
  const { businessId } = await params;
  const workspace = await loadPosWorkspaceCached(businessId);

  if (!workspace.permissions.includes("EDIT_CONFIGURATION")) {
    return (
      <div className="jata-card p-6">
        <p className="jata-kicker">Not allowed</p>
        <h2 className="text-lg font-bold">These settings belong to the owner</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Ask the owner of {workspace.business.name} if something needs to change.
        </p>
      </div>
    );
  }

  const canSeeAudit = workspace.permissions.includes("VIEW_AUDIT");
  const [versions, auditEntries, ownedIds, savedTemplates] = await Promise.all([
    listVersions(businessId, 20),
    canSeeAudit ? listPosAudit(businessId, { take: 40 }) : Promise.resolve([]),
    getOwnedBusinessIds(workspace.session),
    prisma.posTemplate
      .findMany({
        where: { ownerId: workspace.session.userId },
        select: { id: true, name: true, description: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 20,
      })
      .catch(() => []),
  ]);

  const actorIds = versions.map((version) => version.createdById).filter(Boolean) as string[];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }).catch(() => [])
    : [];
  const actorName = new Map(actors.map((actor: any) => [actor.id, actor.name || actor.email]));

  const targets = await prisma.business
    .findMany({
      where: { id: { in: ownedIds.filter((id) => id !== businessId) } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    .catch(() => []);

  const draftVersion = workspace.record?.draftVersion ?? 1;
  const publishedVersion = workspace.record?.publishedVersion ?? 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="jata-kicker">Settings</p>
        <h2 className="text-xl font-bold">How your POS is run</h2>
        <p className="pos-note">Publishing, history, copying your setup, and who did what.</p>
      </div>

      <SettingsClient
        businessId={businessId}
        basePath={workspace.basePath}
        businessName={workspace.business.name}
        entitled={workspace.entitlement.entitled}
        lifecycleLabel={workspace.lifecycleLabel}
        entitlementReason={workspace.entitlement.reason}
        expiresAt={workspace.entitlement.expiresAt ? new Date(workspace.entitlement.expiresAt).toISOString() : null}
        draftVersion={draftVersion}
        publishedVersion={publishedVersion}
        hasUnpublishedChanges={draftVersion > publishedVersion || publishedVersion === 0}
        canPublish={workspace.permissions.includes("EDIT_CONFIGURATION")}
        versions={versions.map((version) => ({
          id: version.id,
          version: version.version,
          note: version.note || null,
          publishedAt: version.publishedAt ? new Date(version.publishedAt).toISOString() : new Date().toISOString(),
          createdByName: version.createdById ? actorName.get(version.createdById) ?? null : null,
        }))}
        audit={auditEntries.map((entry) => ({
          id: entry.id,
          when: new Date(entry.createdAt).toISOString(),
          actor: entry.actorName ?? "System",
          label: auditActionLabel(entry.action),
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
        }))}
        scopes={CLONE_SCOPES}
        explained={describeCloneScope(CLONE_SCOPES.map((scope) => scope.key))}
        targets={targets as { id: string; name: string }[]}
        savedTemplates={(savedTemplates as any[]).map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description ?? null,
          updatedAt: new Date(template.updatedAt).toISOString(),
        }))}
        builtInTemplates={TEMPLATE_LIBRARY.map((template) => ({
          key: template.key,
          name: template.name,
          description: template.description,
        }))}
      />
    </div>
  );
}
