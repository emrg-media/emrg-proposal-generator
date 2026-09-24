import { NextRequest, NextResponse } from "next/server";
import { buildBrief, sendBrief, briefRecipients } from "@/lib/briefService";
import { getSessionUser } from "@/lib/auth";

// Scheduled in vercel.json. ?preview=1 renders it without sending, which an
// admin can also reach from /admin.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fromCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  const preview = req.nextUrl.searchParams.get("preview") === "1";

  if (preview) {
    const user = await getSessionUser();
    if ((!user || user.role !== "admin") && !fromCron(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brief = await buildBrief();
    return NextResponse.json({ preview: true, recipients: await briefRecipients(), ...brief });
  }

  if (!fromCron(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    return NextResponse.json(await sendBrief());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Brief failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
