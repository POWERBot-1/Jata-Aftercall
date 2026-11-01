import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { WorkspaceAuthShell } from "@/components/workspace/WorkspaceAuthShell";
import { getSession } from "@/lib/auth";

export const metadata = { title: "Control sign in | JATA AFTERCALL" };

export default async function ControlSignInPage() {
  const session = await getSession();
  if (session) redirect("/control");
  return (
    <WorkspaceAuthShell
      title="Control-plane sign in"
      subtitle="Use your existing JATA AFTERCALL identity. Control access requires an explicitly provisioned role, permission grant and MFA."
      asideTitle={<>A separate, <em>audited</em> control boundary.</>}
      asideCopy="This sign-in reuses the existing identity service. It does not create or elevate an account; ordinary customers and agents are not granted platform access."
      points={["Server-verified identity and current session", "Explicit database-backed permissions; no role-name defaults", "MFA required before control data or operations"]}
      backHref="/"
      backLabel="Public site"
    >
      <LoginForm destination="/control" />
    </WorkspaceAuthShell>
  );
}
