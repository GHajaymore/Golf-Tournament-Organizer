import { NextResponse, type NextRequest } from "next/server";

/**
 * Tells each request which URL it is, and nothing else.
 *
 * A server component cannot see its own path. That is the only reason this
 * file exists: `requireSession` needs to know where somebody was heading so it
 * can send them back there after they sign in, and without this it can only
 * redirect to `/` and lose the destination.
 *
 * IT DELIBERATELY PERFORMS NO AUTHENTICATION. It does not read the session
 * cookie, does not decide who may see what, and cannot refuse a request. That
 * is not an oversight — it is the whole design:
 *
 *   - Middleware runs on every request. Auth logic here would be a second copy
 *     of a rule that already lives in `requireSession` and `requireScreen`, and
 *     two copies of an access rule is how one of them ends up wrong. The
 *     existing pair are covered by `audit-idor.test.ts`; a third opinion in a
 *     file that runs first would be the one nobody thinks to check.
 *
 *   - A cookie-presence check here would also be wrong in the common case. A
 *     session lasts seven days, so an EXPIRED cookie is present and invalid —
 *     middleware would wave it through and the page would redirect without a
 *     destination, which is exactly the bug being fixed.
 *
 * So it sets two headers and gets out of the way. Everything that decides
 * anything still decides it where it did before.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  headers.set("x-search", request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  /**
   * Everything except the things that are never a destination.
   *
   * Static assets, image optimisation and the favicon cannot be "where
   * somebody was going", and API routes answer for themselves rather than
   * redirecting a person to a sign-in screen. Excluding them keeps this off
   * the hot path for the requests that outnumber page views.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|api/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)"],
};
