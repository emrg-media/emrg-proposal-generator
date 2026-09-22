import "server-only";
import { listOpportunities, type OpportunityRow } from "./opportunities";
import { STAGE_LABELS, LOST_REASON_LABELS } from "./constants";
import { fromCents } from "./fee";
import { speedToLeadMs } from "./time";

// One flat row per opportunity — the shape Mario wants to sort, filter and
// open in Excel. Kept in one place so the on-screen grid, the CSV export and
// the Google Sheet mirror can never drift apart.

export const EXPORT_HEADERS = [
  "Opportunity ID", "Created", "Stage", "Company", "First Name", "Last Name", "Title",
  "Email", "Cell Phone", "Address", "City", "State", "ZIP", "Website",
  "Lead Source", "Lead Received", "Event Name", "Event Type(s)", "Event Date",
  "Guest Count", "Venue", "Requested Services", "Budget Low", "Budget High",
  "Fee (as quoted)", "Proposal Value", "Value Is Estimate",
  "Primary Owner", "Collaborators",
  "First Response", "Speed To Lead (mins)", "Proposal Generated", "Proposal Sent",
  "Last Contact", "Last Activity", "Next Action", "Next Action Date",
  "Follow-up Status", "Approval Status", "Won Date", "Lost Date", "Lost Reason",
  "Lost Note", "Notes",
] as const;

function iso(d: Date | null): string {
  return d ? d.toISOString() : "";
}

function money(cents: number | null): string {
  const v = fromCents(cents);
  return v === null ? "" : v.toFixed(2);
}

export function toExportRow(r: OpportunityRow): unknown[] {
  const speedMs = speedToLeadMs(r);
  return [
    r.code,
    iso(r.createdAt),
    STAGE_LABELS[r.stage],
    r.company, r.firstName, r.lastName, r.title,
    r.email, r.cellPhone, r.address, r.city, r.state, r.zip, r.website,
    r.leadSource, iso(r.leadReceivedAt),
    r.eventName, r.eventTypes.join("; "), r.eventDate,
    r.guestCount, r.venue, r.requestedServices.join("; "),
    money(r.budgetLowCents), money(r.budgetHighCents),
    r.feeRaw, money(r.proposalValueCents), r.valueEstimated ? "Yes" : "No",
    r.ownerName ?? "", r.collaboratorNames.join("; "),
    iso(r.firstResponseAt),
    speedMs === null ? "" : Math.round(speedMs / 60000),
    iso(r.proposalGeneratedAt), iso(r.proposalSentAt),
    iso(r.lastContactAt), iso(r.lastActivityAt),
    r.nextAction, iso(r.nextActionDate),
    r.followupState, r.approvalState,
    iso(r.wonAt), iso(r.lostAt),
    r.lostReason ? LOST_REASON_LABELS[r.lostReason] : "",
    r.lostNote, r.notes,
  ];
}

export async function buildExport(): Promise<{ headers: string[]; rows: unknown[][] }> {
  const rows = await listOpportunities();
  return { headers: [...EXPORT_HEADERS], rows: rows.map(toExportRow) };
}
