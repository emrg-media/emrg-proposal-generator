import { NextRequest, NextResponse } from "next/server";
import { checkLogin } from "@/lib/auth";
import { signSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/session";
import { clientAddress, isThrottled, recordFailure, clearAddress, THROTTLE } from "@/lib/loginThrottle";

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

  // Throttle the source address BEFORE checking the PIN. The account lockout
  // below protects the PIN, but it locks the account, and /login lists every
  // user's id — so without this anyone who finds the page can keep all five
  // people out permanently. Refusing here means a real account's counter is
  // never touched by an attacker.
  const ip = clientAddress(req.headers);
  if (await isThrottled(ip)) {
    return NextResponse.json(
      { error: `Too many attempts from this connection. Try again in ${THROTTLE.WINDOW_MINUTES} minutes.` },
      { status: 429 },
    );
  }

  const result = await checkLogin(userId, pin);
  if (!result.ok) {
    await recordFailure(ip);
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  await clearAddress(ip);
  const res = NextResponse.json({ ok: true, name: result.user.name });
  res.cookies.set(SESSION_COOKIE, await signSession(result.user.id), SESSION_COOKIE_OPTIONS);
  return res;
}
