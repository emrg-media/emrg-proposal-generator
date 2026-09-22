import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireUserOrThrow } from "@/lib/auth";
import { EVENT_TYPES, LEAD_SOURCES } from "@/lib/constants";

// Turns a transcript, a dictated note or a pasted email into the standardized
// opportunity record. All four intake routes in the brief funnel through here,
// so there is exactly one extraction schema to maintain.

const client = new Anthropic();

const SYSTEM = `You are an assistant that extracts structured event-opportunity data from discovery call notes, transcripts, dictated voice notes, or inbound enquiry emails.
Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} — resolve relative dates ("next year", "this December", "in Q2") against it, and never produce a date in the past.
Return ONLY valid JSON matching the schema below. If a field is not mentioned, use an empty string for strings or an empty array for arrays.
Never invent data that isn't in the source. Do not guess an email address from a person's name.

Schema:
{
  "company": "string — company or client organisation name",
  "first_name": "string — the main contact's first name",
  "last_name": "string — the main contact's last name",
  "title": "string — that person's job title, e.g. 'Head of Global Events'",
  "email": "string — the contact's email address, only if explicitly stated",
  "cell_phone": "string — a direct/cell phone number if stated",
  "address": "string — street address if stated",
  "city": "string",
  "state": "string — two-letter state code if stated",
  "zip": "string",
  "website": "string — company website if stated",
  "lead_source": "string — how this lead arrived, chosen from this list when one fits: ${LEAD_SOURCES.join(", ")}. Empty if unclear.",
  "event_name": "string — a short natural name for the event, e.g. 'Google Holiday Party'. Build one from the company and event type if not stated outright.",
  "event_types": ["array of strings — one or more matching event types, copied EXACTLY (same capitalization) from this list when applicable: ${EVENT_TYPES.filter((t) => t !== "Other").join(", ")}. Only map to a list entry when it is genuinely the same kind of event — do NOT substitute culturally distinct celebrations (e.g. a Quinceañera is NOT a Sweet 16; return 'Quinceañera'). Use a custom Title Case label when nothing fits. Never return the same type twice."],
  "event_date": "string — event date in a human-readable format like 'June 15, 2026'. Empty if not mentioned.",
  "guest_count": "string — estimated guest count or range, digits only like '250' or '100-150'",
  "venue": "string — the venue if decided. If only candidates are mentioned ('thinking X or Y'), return empty.",
  "budget_low": "string — lower bound of client budget as a dollar amount, e.g. '$50,000'",
  "budget_high": "string — upper bound of client budget",
  "service_fee": "string — EMRG service fee if mentioned. Extract exactly as stated: a dollar amount like '$12,000' OR a percentage like '20%' or '18-22%'. Never compute or convert — if the source says '20%', return '20%', not a dollar figure.",
  "requested_services": ["array of strings — services the client asked about, e.g. 'Entertainment', 'AV', 'Staffing', 'Catering'. Title Case."],
  "notes": "string — anything else worth keeping: constraints, preferences, decision process, deadlines. A few sentences at most."
}`;

export async function POST(req: NextRequest) {
  try {
    await requireUserOrThrow();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { notes } = await req.json();
  if (!notes || typeof notes !== "string" || !notes.trim()) {
    return NextResponse.json({ error: "Paste some notes first." }, { status: 400 });
  }
  // Keep a lid on cost and latency for an accidentally huge paste.
  const source = notes.slice(0, 40_000);

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: "user", content: `Extract opportunity data from this:\n\n${source}` }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const data = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
