import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_PATH_HEADER, loginPathFor } from "@/lib/post-auth-destination";

/**
 * Signed-out / expired / revoked redirect for any /dashboard server component or action (R-RT-01).
 * Layouts and pages render concurrently, so every dashboard redirect to /login must carry the same
 * validated destination, or whichever bare redirect throws first silently drops it (R-MJ-11).
 */
export async function redirectToDashboardLogin(): Promise<never> {
  let requested: string | null = null;
  try {
    requested = (await headers()).get(DASHBOARD_PATH_HEADER);
  } catch {
    // No request scope (e.g. a unit test invoking the component directly): fall back to bare /login.
  }
  redirect(loginPathFor(requested));
}
