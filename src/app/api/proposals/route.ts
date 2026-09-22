import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listOpportunities } from "@/lib/opportunities";

// Opportunity list in the shape the invoice builder autofills from. Now served
// from Postgres rather than the old tracker sheet, so an invoice is always
// filled from the same record the proposal came out of.

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await listOpportunities();
  const proposals = rows.map((r) => ({
    id: r.id,
    company: r.company,
    client: [r.firstName, r.lastName].filter(Boolean).join(" "),
    email: r.email,
    event: r.eventName || r.eventTypes.join(", "),
    eventDates: r.eventDate,
    guests: r.guestCount,
  }));

  return NextResponse.json({ proposals });
}
