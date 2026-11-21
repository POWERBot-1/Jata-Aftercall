/**
 * Keep the requested workspace destination across sign-in (R-MJ-11, R-RT-01).
 *
 * app/dashboard/layout.tsx authenticates every /dashboard/* route, but a layout cannot see which
 * child was requested, so a signed-out, expired or revoked session used to land on a bare /login and
 * lose its destination. This proxy:
 *   • with no session cookie at all (getSession() is then necessarily null and the redirect certain)
 *     redirects straight to /login?next=<safe destination>;
 *   • otherwise passes the request through unchanged except for one request header carrying the
 *     requested path, which the layout uses only to build the same /login?next=… redirect if the
 *     cookie turns out to be expired, forged or revoked.
 *
 * It grants nothing: no DB, no session verification, and every server-side check still runs. The
 * header is always overwritten here, and the layout re-validates it through loginPathFor().
 */
import { NextResponse, type NextRequest } from "next/server";
import { DASHBOARD_PATH_HEADER, loginPathFor } from "@/lib/post-auth-destination";

export const MJENGO_SESSION_COOKIE = "jata_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!request.cookies.get(MJENGO_SESSION_COOKIE)?.value) {
    return NextResponse.redirect(new URL(loginPathFor(pathname), request.url));
  }
  const headers = new Headers(request.headers);
  headers.set(DASHBOARD_PATH_HEADER, pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*"],
};
