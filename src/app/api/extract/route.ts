import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM = `You are an assistant that extracts structured proposal data from discovery call notes or transcripts.
Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} — resolve relative dates ("next year", "this December", "in Q2") against it, and never produce a date in the past.
Return ONLY valid JSON matching the schema below. If a field is not mentioned, use an empty string for strings or an empty array for arrays.
Never invent data that isn't in the notes.

Schema:
{
  "client_name": "string — company or client name",
  "signer_name": "string — full name of the person who will sign the agreement (the main contact), e.g. 'Jane Smith'. Empty if not mentioned.",
  "signer_title": "string — that person's job title, e.g. 'Head of Global Events'. Empty if not mentioned.",
  "client_email": "string — the contact's email address. Empty if not mentioned.",
  "venue": "string — the event venue if decided, e.g. 'Guastavino's'. If only candidates are mentioned ('thinking X or Y'), return empty. Empty if not mentioned.",
  "budget_low": "string — lower bound of client budget as a dollar amount, e.g. '$50,000'. Empty if not mentioned.",
  "budget_high": "string — upper bound of client budget, e.g. '$75,000'. Empty if not mentioned.",
  "service_fee": "string — EMRG service fee if mentioned. Extract exactly as stated: a dollar amount like '$12,000' OR a percentage like '20%' or '18-22%'. Never compute or convert — if the transcript says '20%', return '20%', not a dollar figure. Empty if not mentioned at all.",
  "events": [
    {
      "date": "string — event date in a human-readable format like 'June 15, 2026' or 'MM/DD/YY'. Empty if not mentioned.",
      "eventTypes": ["array of strings — one or more matching event types, copied EXACTLY (same capitalization) from this list when applicable: Corporate Event, Holiday Party, Conference, Client Summit, Bar Mitzvah, Bat Mitzvah, Fundraiser, Charity Gala, Product Launch, Experiential Marketing Event, Corporate Retreat, Engagement Party, Wedding, Networking Event, Awards Gala, Investor Event, Executive Retreat, Trade Show, Employee Appreciation Event, Sales Meeting, Annual Meeting, Board Meeting, Team Building Activity, Training Seminar, Grand Opening / Ribbon Cutting, Pop-Up Event, Celebrity Event, Anniversary Party, Birthday Party, Sweet 16, Walk / Run Fundraiser. Only map to a list entry when it is genuinely the same kind of event — do NOT substitute culturally distinct celebrations (e.g. a Quinceañera is NOT a Sweet 16; return 'Quinceañera'). Use a custom Title Case label when nothing fits. Never return the same type twice."],
      "guestCount": "string — estimated guest count or range, digits only like '250' or '100-150'. Empty if not mentioned."
    }
  ]
}`;

export async function POST(req: NextRequest) {
  const { notes } = await req.json();
  if (!notes || typeof notes !== "string" || !notes.trim()) {
    return NextResponse.json({ error: "notes required" }, { status: 400 });
  }

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: `Extract proposal data from these notes:\n\n${notes}` }],
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
