import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Optimistic gate only. Per the Next.js docs, proxy is explicitly not a session
// management or authorisation solution — it must stay fast and must not touch
// the database. It checks that the cookie carries a valid, unexpired signature
// and nothing more. Whether that user still exists, is still active, and is
// allowed to see a given screen is decided by requireUser()/requireAdmin() in
// lib/auth.ts, which runs on every protected page, action and route.

export async function proxy(req: NextRequest) {
  const payload = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (payload) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login screen, static assets, and the endpoints that
  // are called by machines rather than people.
  //
  // api/cron and api/intake authenticate themselves with a shared secret and
  // both fail closed when that secret is unset. They have to sit outside this
  // gate because their callers carry a Bearer token, not a session cookie;
  // leaving them inside it silently rejects every automated request.
  matcher: [
    "/((?!login|api/auth|api/cron|api/intake|_next/static|_next/image|favicon.ico|emrg-logo.png).*)",
  ],
};
