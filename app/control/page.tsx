import { redirect } from "next/navigation";
import { ControlConsole } from "@/components/control/ControlConsole";
import { WorkspaceSetupShell } from "@/components/workspace/WorkspaceAuthShell";
import { getControlIdentity } from "@/lib/control/access";
import { CONTROL_PERMISSIONS } from "@/lib/control/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control plane | JATA AFTERCALL", robots: { index: false, follow: false } };
const READ_PERMISSIONS = CONTROL_PERMISSIONS.filter((permission) => permission.endsWith(".read"));

export default async function ControlPage() {
  const access = await getControlIdentity();
  if (access.ok === false && access.code === "UNAUTHENTICATED") redirect("/control/sign-in");
  if (access.ok === false) return (
    <WorkspaceSetupShell title="Control access unavailable" subtitle="The control identity and permission store could not be verified." backHref="/control/sign-in" backLabel="Sign in">
      <p className="ws-muted" role="alert">No control data or administrative action is available. Please try again after the authoritative service recovers.</p>
    </WorkspaceSetupShell>
  );
  const canRead = access.identity.grants.some((grant) => grant.permissionKeys.some((permission) => READ_PERMISSIONS.includes(permission as any)));
  if (!canRead) return (
    <WorkspaceSetupShell title="Control access not granted" subtitle="This identity is authenticated, but it has no explicit control read capability." backHref="/" backLabel="Public site">
      <p className="ws-muted">Role names alone do not grant access. A separately approved, tenant-scoped database permission is required. No admin was created or elevated by this page.</p>
    </WorkspaceSetupShell>
  );
  return (
    <WorkspaceSetupShell title="JATA AFTERCALL control" subtitle="Operational views and guarded actions. Every module is independently permission- and tenant-scoped." backHref="/" backLabel="Public site" width="xwide" meta={<span className="ws-pill ws-pill--admin">CONTROL PLANE · NOT CUSTOMER ADMIN</span>}>
      <ControlConsole />
    </WorkspaceSetupShell>
  );
}
