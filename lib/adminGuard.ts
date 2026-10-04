import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "./auth";

/**
 * Per-page authorization for the admin console.
 *
 * `app/admin/layout.tsx` redirects non-admins, but a layout is NOT an authorization boundary:
 * with partial rendering a request that says "the layout is already loaded" (`RSC: 1` plus a
 * `Next-Router-State-Tree` header) renders the page segment alone, so the page — and every
 * customer email, phone number and payment reference it queries — ran for anonymous visitors.
 * Every admin page therefore calls this *before* it reads anything.
 *
 * `redirect()` throws, so nothing after the call runs for a refused request.
 */
export async function requireAdminPage(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");
  return session;
}
