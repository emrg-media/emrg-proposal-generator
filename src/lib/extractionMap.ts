// Translates what /api/extract returns into what the proposal builder holds.
//
// No "server-only" here on purpose: a client component imports this.
//
// This exists as its own module because the two sides drifted apart once
// already and nothing caught it. The extract schema was widened to feed the
// opportunity record (company, first_name, last_name, title, email, plus flat
// event fields), the /new form was updated to match, and the proposal
// builder's Smart Import was left reading the older names (client_name,
// signer_name, signer_title, client_email, and a nested events array). Every
// one of those reads returned undefined, so the button appeared to do nothing.
// A pure function can be tested against the schema; an inline object literal
// inside a component cannot.

/** The fields /api/extract returns. Keep in step with the schema in that route. */
export interface ExtractedFields {
  company?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  cell_phone?: string;
  website?: string;
  lead_source?: string;
  event_name?: string;
  event_types?: string[];
  event_date?: string;
  guest_count?: string;
  venue?: string;
  budget_low?: string;
  budget_high?: string;
  service_fee?: string;
  requested_services?: string[];
  notes?: string;
}

/** Only the keys actually present, so an import never blanks something typed. */
export interface ProposalExtraction {
  client: {
    client_name?: string;
    signer_name?: string;
    signer_title?: string;
    client_email?: string;
    venue?: string;
    budget_low?: string;
    budget_high?: string;
    service_fee?: string;
  };
  leadSource?: string;
  event?: { date: string; eventTypes: string[]; guestCount: string };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function mapExtractionToProposal(raw: unknown): ProposalExtraction {
  const d = (raw && typeof raw === "object" ? raw : {}) as ExtractedFields;
  const out: ProposalExtraction = { client: {} };

  const set = <K extends keyof ProposalExtraction["client"]>(key: K, value: string) => {
    if (value) out.client[key] = value;
  };

  set("client_name", str(d.company));
  set("signer_name", [str(d.first_name), str(d.last_name)].filter(Boolean).join(" "));
  set("signer_title", str(d.title));
  set("client_email", str(d.email));
  set("venue", str(d.venue));
  set("budget_low", str(d.budget_low));
  set("budget_high", str(d.budget_high));
  set("service_fee", str(d.service_fee));

  const leadSource = str(d.lead_source);
  if (leadSource) out.leadSource = leadSource;

  // The schema is flat, one event per extraction. The builder holds a list, so
  // this becomes a single row rather than replacing the list with nothing.
  const date = str(d.event_date);
  const guestCount = str(d.guest_count);
  const eventTypes = Array.isArray(d.event_types) ? d.event_types.map(str).filter(Boolean) : [];
  if (date || guestCount || eventTypes.length > 0) {
    out.event = { date, eventTypes, guestCount };
  }

  return out;
}
