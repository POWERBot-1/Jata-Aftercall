import { redirect } from "next/navigation";
import { getControlIdentity } from "@/lib/control/access";
import type { SessionPayload } from "./auth";

/**
 * Legacy /admin UI is not an independent authorization system.
 * Until the owner-authority policy has an explicit, verified ALLOW matrix,
 * all legacy ADMIN sessions remain denied. A role label is not owner proof.
 */
export async function requireAdminPage(): Promise<SessionPayload> {
  const access = await getControlIdentity();
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    redirect("/control/policy");
  }
  // Operational access is still not a blanket grant to legacy admin pages.
  // This route family must be migrated to explicit per-action capabilities first.
  redirect("/control/policy");
}
