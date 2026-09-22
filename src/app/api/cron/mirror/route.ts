import { NextRequest, NextResponse } from "next/server";
import { mirrorToSheet } from "@/lib/sheetMirror";

// Scheduled by Vercel Cron. These routes sit outside the session gate (there
// is no logged-in user), so they authenticate with CRON_SECRET instead.
// Vercel sends it as `Authorization: Bearer <CRON_SECRET>`.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: an unset secret means the endpoint is unavailable, never open.
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await mirrorToSheet();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Mirror failed";
    return NextResponse.json({ ok: false, reason: msg }, { status: 500 });
  }
}
