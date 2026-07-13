import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Gate every page and API route behind the shared passcode (see /api/auth).
// Fail-open only when APP_PASSCODE is unset, so the site is not bricked before
// the env var is configured; set APP_PASSCODE in the environment to activate.

async function tokenFor(passcode: string): Promise<string> {
  const data = new TextEncoder().encode("emrg-auth:" + passcode);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function proxy(req: NextRequest) {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return NextResponse.next(); // gate inactive until configured

  const cookie = req.cookies.get("emrg_auth")?.value;
  if (cookie && cookie === (await tokenFor(passcode))) return NextResponse.next();

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
  // Gate everything except the login page, the auth endpoint, and static assets
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|emrg-logo.png).*)"],
};
