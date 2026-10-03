import { emptyStateFor } from "@/lib/pos/presentation";
import { formSpec } from "@/lib/pos/forms";
import { permissionLabel, resolveRoles } from "@/lib/pos/permissions";
import { listBranches, listStaff } from "@/lib/pos/store";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { RecordBoard } from "@/components/pos/RecordBoard";

/**
 * Staff and what each person may do (§15, §36).
 *
 * A role is a named set of permissions. The roles offered here are the ones this configuration
 * defines, so a salon offers Stylist and a garage offers Technician — one permission engine.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string }> };

export default async function PosStaffPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadPosWorkspaceCached(businessId);
  const configuration = workspace.configuration;
  const spec = formSpec(configuration, "staff");

  const [staff, branches] = await Promise.all([listStaff(businessId, { activeOnly: false }), listBranches(businessId)]);
  const roles = resolveRoles(configuration);
  const roleName = new Map(roles.map((role) => [role.key, role.name]));

  return (
    <div className="space-y-3">
      <div>
        <p className="jata-kicker">{workspace.terminology.staff}</p>
        <h2 className="text-xl font-bold">{workspace.terminology.staff}</h2>
        <p className="pos-note">
          {configuration.staff.attribution
            ? "Who uses the POS, what they can do, and whose sale it was."
            : "Who uses the POS and what they can do."}
        </p>
      </div>

      <RecordBoard
        businessId={businessId}
        basePath={workspace.basePath}
        apiPath={`/api/pos/${encodeURIComponent(businessId)}/staff`}
        word="Person"
        plural={workspace.terminology.staff}
        fields={spec.fields}
        rows={(staff as any[]).map((member) => ({ ...member, roleLabel: roleName.get(member.roleKey) ?? member.roleKey }))}
        titleKey="name"
        subtitleKeys={["roleLabel", "phone"]}
        valueColumns={configuration.staff.commissions ? [{ key: "commissionPercent", suffix: "%" }] : []}
        canEdit={workspace.permissions.includes("MANAGE_USERS")}
        updateMode="post"
        updateIdKey="staffId"
        optionSets={{ branchId: (branches as any[]).map((branch) => ({ id: branch.id, label: branch.name })) }}
        openNew={query.new === "1"}
        emptyState={emptyStateFor(configuration, "staff", workspace.basePath)}
      />

      <section className="jata-card p-5">
        <p className="jata-kicker">What each role can do</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <div className="pos-summary-group" key={role.key}>
              <h3>{role.name}</h3>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {role.permissions.map((permission) => (
                  <span className="pos-chip" key={permission}>{permissionLabel(permission)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
