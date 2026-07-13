import { NextRequest, NextResponse } from "next/server";

// Shared-passcode gate for the whole team tool. On correct passcode we set an
// httpOnly cookie holding a hash of the passcode; the proxy checks it on every
// request. This keeps client and financial data (and the send/delete APIs) off
// the open internet. It is a single shared login, not per-user accounts.

async function tokenFor(passcode: string): Promise<string> {
  const data = new TextEncoder().encode("emrg-auth:" + passcode);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body.logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("emrg_auth", "", { path: "/", maxAge: 0 });
    return res;
  }

  const expected = process.env.APP_PASSCODE;
  if (!expected) {
    return NextResponse.json({ error: "Login is not configured yet." }, { status: 500 });
  }
  if (typeof body.passcode !== "string" || body.passcode !== expected) {
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("emrg_auth", await tokenFor(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
