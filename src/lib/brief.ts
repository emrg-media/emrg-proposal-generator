import type { Kpis } from "./kpi";
import type { AttentionGroup } from "./attention";
import { fmtCents } from "./fee";
import { formatDuration } from "./time";
import { fmtPercent } from "./kpi";

// Mario's private daily brief (brief §25).
//
// Pure: it is handed the numbers and the attention list and turns them into an
// email. Those come from kpi.ts and attention.ts, the same modules the screens
// read, so the brief and the dashboard can never tell different stories.
//
// Ordered by what he can act on. Things only he can unblock come first,
// then the state of the business, then what moved, then the detail. A quiet
// day should be three lines and take five seconds to dismiss.

export interface BriefWindow {
  start: Date;
  /** "yesterday", "over the weekend", used in the headings. */
  label: string;
}

/**
 * What the brief covers. Normally the previous day; on a Monday it reaches back
 * over the weekend so nothing that happened on Saturday is silently skipped.
 */
export function briefWindow(now: Date): BriefWindow {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const day = now.getDay(); // 0 Sunday, 1 Monday
  if (day === 1) {
    start.setDate(start.getDate() - 3); // back to Friday
    return { start, label: "since Friday" };
  }
  if (day === 0) {
    start.setDate(start.getDate() - 2);
    return { start, label: "since Friday" };
  }
  start.setDate(start.getDate() - 1);
  return { start, label: "yesterday" };
}

export interface BriefInput {
  kpis: Kpis;
  attention: AttentionGroup[];
  window: BriefWindow;
  now: Date;
  responseTargetMinutes: number;
  appUrl: string;
}

export interface Brief {
  subject: string;
  text: string;
  html: string;
  /** Nothing happened and nothing needs him. */
  quiet: boolean;
}

function dateLine(now: Date): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long", day: "numeric", month: "long",
  });
}

/** The things only Mario can unblock, or that nobody else has picked up. */
function needsHim(attention: AttentionGroup[]): AttentionGroup[] {
  return attention.filter((g) =>
    g.primary.kind === "awaiting_approval" || g.ownerId === null);
}

export function composeBrief(input: BriefInput): Brief {
  const { kpis: k, attention, window, now, responseTargetMinutes, appUrl } = input;

  const mine = needsHim(attention);
  const moved = k.newLeads + k.proposalsSent + k.wonCount + k.lostCount;
  const quiet = mine.length === 0 && moved === 0 && attention.length === 0;

  const money = (c: number) => fmtCents(c);
  const lines: string[] = [];

  lines.push(`EMRG Revenue Brief`, dateLine(now), ``);

  if (quiet) {
    lines.push(
      `Quiet ${window.label}. Nothing needs you, nothing is overdue,`,
      `and ${money(k.openPipelineCents)} is open across ${k.openCount} opportunit${k.openCount === 1 ? "y" : "ies"}.`,
      ``, appUrl,
    );
    const text = lines.join("\n");
    return { subject: `EMRG brief: quiet ${window.label}`, text, html: toHtml(text, appUrl), quiet: true };
  }

  // 1. Only he can clear these.
  if (mine.length > 0) {
    lines.push(`NEEDS YOU`);
    for (const g of mine.slice(0, 6)) {
      lines.push(`  ${g.company || g.code}${g.valueCents ? `, ${money(g.valueCents)}` : ""}`);
      lines.push(`    ${g.primary.headline}`);
    }
    if (mine.length > 6) lines.push(`  and ${mine.length - 6} more`);
    lines.push(``);
  }

  // 2. The state of the business, which a date filter must never change.
  lines.push(`RIGHT NOW`);
  lines.push(`  Open pipeline     ${money(k.openPipelineCents)} across ${k.openCount}`);
  if (k.stalledPipelineCents > 0) {
    lines.push(`  Stalled           ${money(k.stalledPipelineCents)} quiet for a week or more`);
  }
  if (k.leadsOutsideTarget > 0) {
    lines.push(`  Unanswered        ${k.leadsOutsideTarget} lead${k.leadsOutsideTarget === 1 ? "" : "s"} past the ${responseTargetMinutes} minute target`);
  }
  if (k.noNextAction > 0) {
    lines.push(`  No next action    ${k.noNextAction}`);
  }
  lines.push(``);

  // 3. What actually moved.
  lines.push(window.label.toUpperCase());
  lines.push(`  New leads         ${k.newLeads}`);
  lines.push(`  Proposals sent    ${k.proposalsSent}${k.proposalValueSentCents > 0 ? `  (${money(k.proposalValueSentCents)})` : ""}`);
  if (k.wonCount > 0) lines.push(`  Won               ${money(k.wonCents)} across ${k.wonCount}`);
  if (k.lostCount > 0) lines.push(`  Lost              ${money(k.lostCents)} across ${k.lostCount}`);
  if (k.avgSpeedToLeadMs !== null) {
    lines.push(`  Speed to lead     ${formatDuration(k.avgSpeedToLeadMs)} average, ${fmtPercent(k.answeredWithinTargetRate)} within target`);
  }
  lines.push(``);

  // 4. The rest, capped so the email stays readable.
  const others = attention.filter((g) => !mine.includes(g)).slice(0, 8);
  if (others.length > 0) {
    lines.push(`NEEDS ATTENTION`);
    for (const g of others) {
      const owner = g.ownerName ? ` (${g.ownerName})` : "";
      lines.push(`  ${g.company || g.code}${g.valueCents ? `, ${money(g.valueCents)}` : ""}${owner}`);
      lines.push(`    ${g.primary.headline}`);
    }
    const remaining = attention.length - mine.length - others.length;
    if (remaining > 0) lines.push(`  and ${remaining} more`);
    lines.push(``);
  }

  lines.push(appUrl);

  const text = lines.join("\n");
  const headline = mine.length > 0
    ? `${mine.length} need${mine.length === 1 ? "s" : ""} you`
    : `${money(k.openPipelineCents)} open, ${k.newLeads} new`;

  return {
    subject: `EMRG brief: ${headline}`,
    text,
    html: toHtml(text, appUrl),
    quiet: false,
  };
}

/** Monospaced so the aligned columns survive; headings picked out in EMRG red. */
function toHtml(text: string, appUrl: string): string {
  const escape = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const body = text.split("\n").map((line) => {
    if (!line.trim()) return "<div style=\"height:10px\"></div>";
    if (line === appUrl) {
      return `<div style="margin-top:14px"><a href="${escape(appUrl)}" style="color:#c0182a;font-weight:600">Open the dashboard</a></div>`;
    }
    if (/^[A-Z][A-Z ]+$/.test(line.trim())) {
      return `<div style="font-weight:700;letter-spacing:1.5px;color:#c0182a;margin-top:6px">${escape(line)}</div>`;
    }
    if (line === "EMRG Revenue Brief") {
      return `<div style="font-size:18px;font-weight:700;color:#111">${escape(line)}</div>`;
    }
    return `<div style="white-space:pre">${escape(line)}</div>`;
  }).join("");

  return `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px;line-height:1.55;color:#111">${body}</div>`;
}
