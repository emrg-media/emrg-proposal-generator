import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM = `You are an assistant that extracts structured proposal data from discovery call notes or transcripts.
Return ONLY valid JSON matching the schema below. If a field is not mentioned, use an empty string for strings or an empty array for arrays.
Never invent data that isn't in the notes.

Schema:
{
  "client_name": "string — company or client name",
  "budget_low": "string — lower bound of client budget as a dollar amount, e.g. '$50,000'. Empty if not mentioned.",
  "budget_high": "string — upper bound of client budget, e.g. '$75,000'. Empty if not mentioned.",
  "service_fee": "string — EMRG service fee if mentioned. Extract exactly as stated: a dollar amount like '$12,000' OR a percentage like '20%' or '18-22%'. Never compute or convert — if the transcript says '20%', return '20%', not a dollar figure. Empty if not mentioned at all.",
  "events": [
    {
      "date": "string — event date in a human-readable format like 'June 15, 2026' or 'MM/DD/YY'. Empty if not mentioned.",
      "eventTypes": ["array of strings — one or more of the known event types that match, or a short custom label"],
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
