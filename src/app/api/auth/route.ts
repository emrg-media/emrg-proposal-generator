import { NextRequest, NextResponse } from "next/server";
import { checkLogin } from "@/lib/auth";
import { signSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/session";

// Per-user login. Each planner has their own 6-digit PIN so the system can
// attribute ownership, route Erica's approvals, and keep Mario's executive
// dashboard genuinely private. checkLogin() enforces the lockout.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body.logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  const { userId, pin } = body;
  if (typeof userId !== "string" || typeof pin !== "string") {
    return NextResponse.json({ error: "Pick your name and enter your PIN." }, { status: 400 });
  }

  const result = await checkLogin(userId, pin);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, name: result.user.name });
  res.cookies.set(SESSION_COOKIE, await signSession(result.user.id), SESSION_COOKIE_OPTIONS);
  return res;
}
