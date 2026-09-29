import { computeFee, fmtMoney } from "./fee";
import type { AgreementData } from "./AgreementPDF";

// Defaults for the Event Planning Agreement.
//
// Two of these are guesses standing in for an answer from Erica, which is why
// every one of them is editable in the form rather than baked into the PDF:
//
//  · the short name. "Carbon Direct Capital (referred to as Carbon)" is legal
//    shorthand used four more times in the contract. The first word is right
//    for Carbon and for Brightwater Partners, and wrong often enough that
//    nobody should be stuck with it.
//  · the payment split. Her example is exactly half on signing and half 14
//    business days before the event. Whether that is their standard or was
//    negotiated for that client is unknown, so it defaults to half and half.

export interface AgreementInput {
  client_name?: string;
  signer_name?: string;
  signer_title?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  venue?: string;
  eventTypes?: string[];
  eventDate?: string;
  service_fee?: string;
  budget_low?: string;
  budget_high?: string;
}

/** "Carbon Direct Capital" → "Carbon". Leading "The" is skipped. */
export function shortName(company: string): string {
  const words = (company ?? "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0].toLowerCase() === "the" && words.length > 1 ? words[1] : words[0];
  // Drop a trailing comma from "Acme, Inc." without touching "AT&T".
  return first.replace(/[,.]+$/, "");
}

/** The address as it reads mid-sentence: "17 State Street New York NY 10004". */
export function addressLine(i: AgreementInput): string {
  return [i.address, i.city, i.state, i.zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/** "investor event", lowercase, as it appears mid-sentence. */
export function eventDescriptor(types: string[] | undefined): string {
  const first = (types ?? []).map((t) => (t ?? "").trim()).filter(Boolean)[0];
  return first ? first.toLowerCase() : "event";
}

/**
 * The timing clause. Her document reads "in 2026, exact date TBD" because the
 * date was not settled; with a real date it should say so instead.
 */
export function timingClause(eventDate: string | undefined): string {
  const raw = (eventDate ?? "").trim();
  if (!raw) return "exact date TBD";

  // No timeZone here on purpose. An event date is a calendar date, not an
  // instant: "March 12, 2027" parses at local midnight, so converting it to
  // New York would print March 11 from anywhere east of it. Parsing and
  // formatting in the same zone round-trips correctly everywhere.
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return `on ${parsed.toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    })}`;
  }

  // Free text like "March 2027" or "Q2 2027": quote it rather than guess.
  const year = raw.match(/\b(20\d{2})\b/)?.[1];
  return year ? `in ${year}, exact date TBD` : "exact date TBD";
}

/** Half the fee, rounded to whole dollars, as a formatted string. */
export function halfOfFee(service_fee: string, budget: string): string {
  const resolved = computeFee(service_fee, budget);
  if (resolved.value === null) return "";
  return fmtMoney(resolved.value / 2);
}

export function agreementDefaults(i: AgreementInput): AgreementData {
  const budget = [i.budget_low, i.budget_high].filter(Boolean).join(" to ");
  const half = halfOfFee(i.service_fee ?? "", budget);

  return {
    client_name: i.client_name ?? "",
    short_name: shortName(i.client_name ?? ""),
    signer_name: i.signer_name ?? "",
    signer_title: i.signer_title ?? "",
    client_address: addressLine(i),
    event_descriptor: eventDescriptor(i.eventTypes),
    // Her document says "a venue in NYC", not the venue name, because the venue
    // is usually not chosen when the agreement is signed. A named venue is
    // better when there is one.
    location: (i.venue ?? "").trim() || "NYC",
    timing: timingClause(i.eventDate),
    service_fee: i.service_fee ?? "",
    budget_low: i.budget_low ?? "",
    budget_high: i.budget_high ?? "",
    deposit_first: half,
    deposit_second: half,
  };
}
