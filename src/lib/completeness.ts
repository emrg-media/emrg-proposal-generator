import { computeFee, budgetText } from "./fee";

// What is still missing before a proposal can go out (brief §7, and Mario's
// "missing information check").
//
// Pure, so the intake form, the opportunity screen, the pipeline card and the
// Needs Attention rules all judge completeness the same way. Each gap carries
// the question you would actually ask the client, which is what the
// clarification drafts will be built from.

export type Severity = "blocking" | "important" | "optional";

export interface MissingField {
  key: string;
  label: string;
  severity: Severity;
  /** Phrased as you would ask the client, ready for a clarification email. */
  ask: string;
}

export interface CompletenessInput {
  company: string;
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  cellPhone: string;
  eventDate: string;
  guestCount: string;
  venue: string;
  eventTypes: string[];
  requestedServices: string[];
  feeRaw: string;
  budgetLowCents: number | null;
  budgetHighCents: number | null;
}

export interface Completeness {
  missing: MissingField[];
  blocking: MissingField[];
  important: MissingField[];
  optional: MissingField[];
  /** Nothing blocking is outstanding, so a proposal can legitimately be sent. */
  readyToSend: boolean;
  /** Share of the fields that matter (blocking + important) that are filled. */
  score: number;
}

const blank = (v: string | null | undefined) => !String(v ?? "").trim();

export function checkCompleteness(o: CompletenessInput): Completeness {
  const missing: MissingField[] = [];
  const add = (key: string, label: string, severity: Severity, ask: string) =>
    missing.push({ key, label, severity, ask });

  // Blocking: the proposal cannot correctly go out without these.
  if (blank(o.company) && blank(o.lastName)) {
    add("company", "Company or contact name", "blocking",
      "Who should the proposal be addressed to?");
  }
  if (blank(o.email)) {
    add("email", "Email address", "blocking",
      "What is the best email address to send the proposal to?");
  }

  // Important: the proposal is weak or the reporting is wrong without these.
  if (blank(o.lastName)) {
    add("lastName", "Contact name", "important",
      "Who is the main contact for this event?");
  }
  if (blank(o.eventDate)) {
    add("eventDate", "Event date", "important",
      "What date is the event, or roughly which week?");
  }
  if (blank(o.guestCount)) {
    add("guestCount", "Guest count", "important",
      "Roughly how many guests are you expecting?");
  }
  if (blank(o.venue)) {
    add("venue", "Venue", "important",
      "Has a venue been decided, or would you like us to source options?");
  }
  if (o.eventTypes.length === 0) {
    add("eventTypes", "Event type", "important",
      "What kind of event is this?");
  }
  if (o.requestedServices.length === 0) {
    add("requestedServices", "Services requested", "important",
      "Which services do you need from us, for example entertainment, AV, staffing or catering?");
  }

  // The fee is what the whole pipeline value is built on.
  if (blank(o.feeRaw)) {
    add("feeRaw", "Fee", "important",
      "What fee has been quoted for this event?");
  } else {
    // A percentage fee with no budget cannot be resolved into a number, so the
    // deal silently contributes nothing to the pipeline total.
    const calc = computeFee(o.feeRaw, budgetText(o.budgetLowCents, o.budgetHighCents));
    if (calc.needsBudget) {
      add("budget", "Event budget", "important",
        "What budget are you working with? The fee is a percentage, so we need this to quote a figure.");
    }
  }

  if (o.budgetLowCents === null && o.budgetHighCents === null
      && !missing.some((m) => m.key === "budget")) {
    add("budget", "Event budget", "important",
      "What budget range are you working with?");
  }

  // Optional: useful to have, never a reason to hold anything up.
  if (blank(o.cellPhone)) {
    add("cellPhone", "Phone number", "optional",
      "What is the best number to reach you on?");
  }
  if (blank(o.title)) {
    add("title", "Job title", "optional",
      "What is your role there? It goes on the agreement.");
  }

  const blocking = missing.filter((m) => m.severity === "blocking");
  const important = missing.filter((m) => m.severity === "important");
  const optional = missing.filter((m) => m.severity === "optional");

  // Ten fields carry real weight: the two blocking ones and eight important.
  const WEIGHTED_TOTAL = 10;
  const missedWeight = blocking.length + important.length;
  const score = Math.max(0, Math.min(1, (WEIGHTED_TOTAL - missedWeight) / WEIGHTED_TOTAL));

  return { missing, blocking, important, optional, readyToSend: blocking.length === 0, score };
}

/** One line for a card or a table cell. */
export function missingSummary(c: Completeness): string {
  if (c.blocking.length > 0) {
    return `Missing ${c.blocking.map((m) => m.label.toLowerCase()).join(" and ")}`;
  }
  if (c.important.length > 0) {
    return `${c.important.length} detail${c.important.length === 1 ? "" : "s"} still needed`;
  }
  return "";
}

/**
 * The questions to put to the client, ready to drop into an email.
 * Blocking first, then important. Optional fields are never chased.
 */
export function clarificationQuestions(c: Completeness): string[] {
  return [...c.blocking, ...c.important].map((m) => m.ask);
}
