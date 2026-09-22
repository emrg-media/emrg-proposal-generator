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
  // Everything except the login screen, its endpoints, and static assets.
  matcher: ["/((?!login|api/auth|api/cron|_next/static|_next/image|favicon.ico|emrg-logo.png).*)"],
};
