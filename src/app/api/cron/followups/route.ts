import { NextRequest, NextResponse } from "next/server";
import { runFollowups, previewFollowups } from "@/lib/followup";
import { getSessionUser } from "@/lib/auth";

// Runs on a schedule (see vercel.json). Outside the session gate, so it
// authenticates with CRON_SECRET and fails closed when that is unset.
//
// ?preview=1 returns what WOULD be sent and sends nothing. That path also
// accepts a signed-in session, so the team can inspect the queue from the app.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function fromCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  const preview = req.nextUrl.searchParams.get("preview") === "1";

  if (preview) {
    const user = await getSessionUser();
    if (!user && !fromCron(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.json({
      preview: true,
      enabled: process.env.FOLLOWUPS_ENABLED === "true",
      messages: await previewFollowups(),
    });
  }

  if (!fromCron(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    return NextResponse.json(await runFollowups());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Follow-up run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
