import { checkCompleteness, type CompletenessInput, type MissingField } from "./completeness";

// Drafting the email that asks a client for what is missing (Mario's item 5).
//
// Pure, and deliberately says nothing about where the draft ends up. Today the
// team reviews it and sends or copies it; when the Gmail drafts decision is
// made, only the destination changes. The wording does not.

export interface ClarificationInput extends CompletenessInput {
  eventName: string;
  ownerName: string;
}

export interface ClarificationDraft {
  subject: string;
  body: string;
  /** The gaps this draft actually asks about. */
  asking: MissingField[];
  /** False when there is no address to send to, which is itself a gap. */
  canSend: boolean;
  /** Why not, when canSend is false. */
  blockedReason: string;
}

function greetingName(first: string, last: string): string {
  const name = (first || last || "").trim();
  return name.split(/\s+/)[0] || "there";
}

function eventPhrase(input: ClarificationInput): string {
  const name = input.eventName.trim();
  if (name) return name;
  const type = input.eventTypes[0]?.trim();
  if (type) return `your ${type.toLowerCase()}`;
  return "your event";
}

/**
 * Compose the email.
 *
 * Only blocking and important gaps are asked about. Chasing a client for a job
 * title makes the team look like it is filling in a form rather than planning
 * an event, so optional gaps are never included.
 */
export function composeClarification(input: ClarificationInput): ClarificationDraft {
  const completeness = checkCompleteness(input);

  // The email address is itself one of the things that can be missing, and
  // there is no way to email someone to ask for their email address.
  const asking = [...completeness.blocking, ...completeness.important]
    .filter((m) => m.key !== "email");

  const first = greetingName(input.firstName, input.lastName);
  const event = eventPhrase(input);
  const questions = asking.map((m) => m.ask);

  const opening = questions.length === 1
    ? `Thanks for getting in touch about ${event}. Before I put the proposal together, one thing I still need from you:`
    : `Thanks for getting in touch about ${event}. Before I put the proposal together, could you fill in a few gaps for me?`;

  const lines = [
    `Hi ${first},`,
    ``,
    opening,
    ``,
    ...(questions.length === 1 ? [questions[0]] : questions.map((q) => `- ${q}`)),
    ``,
    questions.length > 2
      ? `Whatever you have is fine, even rough numbers. I can work with approximations and firm them up later.`
      : `Rough figures are fine if you are still deciding.`,
    ``,
    `Best,`,
    input.ownerName || "The EMRG Media team",
    `EMRG Media | 212.254.3700`,
  ];

  const canSend = !!input.email.trim();

  return {
    subject: `Quick question${questions.length === 1 ? "" : "s"} about ${event}`,
    body: lines.join("\n"),
    asking,
    canSend,
    blockedReason: canSend ? "" : "There is no email address on file for this contact yet.",
  };
}

/** Nothing to ask about, so nothing to draft. */
export function hasSomethingToAsk(input: ClarificationInput): boolean {
  return composeClarification(input).asking.length > 0;
}
