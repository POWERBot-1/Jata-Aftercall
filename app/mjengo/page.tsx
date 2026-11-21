/**
 * MJENGO OS public entry (R-MJ-11).
 *
 * Every public "Get MJENGO OS" call to action links here, not to /dashboard/mjengo. The dashboard
 * layout (app/dashboard/layout.tsx) owns authentication for every /dashboard/* route and sends a
 * signed-out visitor to a bare /login. A layout cannot see which child route was requested, so the
 * MJENGO page's own redirect to /login?next=mjengo never won, and the MJENGO intent was dropped on
 * sign-in (caught by the real-Chrome journey, Premium Screenshots run 44247022065).
 *
 * This route lives outside that layout, so it decides first:
 *   signed out → /login?next=mjengo (sign-in or registration returns to MJENGO OS)
 *   signed in  → /dashboard/mjengo (the owner's business workspace, or the business picker)
 * It renders nothing and grants nothing: entitlement is still decided by the workspace gate.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MjengoEntry() {
  const session = await getSession();
  if (session) redirect("/dashboard/mjengo");
  // "mjengo" is the exact allowlisted token resolvePostAuthDestination maps back to /dashboard/mjengo.
  redirect("/login?next=mjengo");
}
