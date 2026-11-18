/**
 * R-MJ-11 — keep the MJENGO OS destination for a signed-out deep link.
 *
 * app/dashboard/layout.tsx authenticates every /dashboard/* route and redirects a signed-out
 * visitor to a bare /login; a layout cannot see which child was requested, so a shared or
 * bookmarked /dashboard/mjengo link lost the MJENGO destination on sign-in. With no session cookie
 * at all getSession() is necessarily null and that redirect is certain, so redirecting here
 * instead only adds the allowlisted ?next=mjengo token. This proxy grants nothing: a request that
 * carries a cookie (valid or not) passes through unchanged to the normal server-side checks.
 *
 * Deliberately narrow: no DB, no session verification, and a matcher limited to MJENGO routes.
 * The cookie name is asserted equal to SESSION_COOKIE_NAME in tests/unit/mjengo-entry-route.test.ts.
 */
import { NextResponse, type NextRequest } from "next/server";

export const MJENGO_SESSION_COOKIE = "jata_session";

export function proxy(request: NextRequest) {
  if (request.cookies.get(MJENGO_SESSION_COOKIE)?.value) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.search = "?next=mjengo";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/mjengo", "/dashboard/mjengo/:path*"],
};
