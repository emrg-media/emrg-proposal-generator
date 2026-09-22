import type { Stage, LostReason, ActivityType, UserRole } from "@/db/schema";

// Display labels and ordering for everything the UI renders from an enum.
// Keeping them here means the pipeline, exec dashboard, exports and the daily
// brief all speak the same language.

export const STAGES: Stage[] = [
  "new_lead", "contacted", "proposal_needed", "proposal_review",
  "proposal_sent", "client_reviewing", "contract_deposit", "won", "lost",
];

export const STAGE_LABELS: Record<Stage, string> = {
  new_lead: "New Lead",
  contacted: "Contacted",
  proposal_needed: "Proposal Needed",
  proposal_review: "Proposal Review",
  proposal_sent: "Proposal Sent",
  client_reviewing: "Client Reviewing",
  contract_deposit: "Contract / Deposit",
  won: "Won",
  lost: "Lost",
};

// Stages that still count as live pipeline money.
export const OPEN_STAGES: Stage[] = [
  "new_lead", "contacted", "proposal_needed", "proposal_review",
  "proposal_sent", "client_reviewing", "contract_deposit",
];

export function isOpen(s: Stage): boolean {
  return OPEN_STAGES.includes(s);
}

export const LOST_REASONS: LostReason[] = [
  "budget", "date_unavailable", "competitor", "ghosted", "event_canceled",
  "event_postponed", "timing_future", "not_a_fit", "other",
];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  budget: "Budget",
  date_unavailable: "Date unavailable",
  competitor: "Went with competitor",
  ghosted: "Ghosted",
  event_canceled: "Event canceled",
  event_postponed: "Event postponed",
  timing_future: "Timing / future opportunity",
  not_a_fit: "Not a fit",
  other: "Other",
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  lead_received: "Lead received",
  note: "Note",
  email_out: "Email sent",
  email_in: "Client replied",
  call: "Phone call",
  meeting: "Meeting",
  proposal_generated: "Proposal generated",
  proposal_sent: "Proposal sent",
  approval_requested: "Approval requested",
  approved: "Approved",
  stage_change: "Stage changed",
  owner_change: "Owner changed",
  followup_sent: "Follow-up sent",
  followup_paused: "Follow-up paused",
  followup_resumed: "Follow-up resumed",
  won: "Won",
  lost: "Lost",
  field_change: "Details updated",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  planner: "Event Planner",
};

// A human touch on the opportunity. The first of these stamps firstResponseAt,
// and any of them pauses an active follow-up sequence (brief §17).
export const HUMAN_TOUCH_TYPES: ActivityType[] = ["email_out", "call", "meeting"];

// Anything that means a real conversation is live — includes the client's side.
export const CONVERSATION_TYPES: ActivityType[] = [
  "email_out", "email_in", "call", "meeting",
];

export const EVENT_TYPES = [
  "Corporate Event", "Holiday Party", "Conference", "Client Summit",
  "Bar Mitzvah", "Bat Mitzvah", "Fundraiser", "Charity Gala",
  "Product Launch", "Experiential Marketing Event", "Corporate Retreat",
  "Engagement Party", "Wedding", "Networking Event", "Awards Gala",
  "Investor Event", "Executive Retreat", "Trade Show",
  "Employee Appreciation Event", "Sales Meeting", "Annual Meeting",
  "Board Meeting", "Team Building Activity", "Training Seminar",
  "Grand Opening / Ribbon Cutting", "Pop-Up Event", "Celebrity Event",
  "Anniversary Party", "Birthday Party", "Sweet 16",
  "Walk / Run Fundraiser", "Other",
];

export const LEAD_SOURCES = [
  "Inbound Email", "Website Form", "Referral", "Repeat Client",
  "Phone Call", "Discovery Call", "Event Networking", "Cold Outreach", "Other",
];

// Defaults, overridable in /admin via the settings table.
export const DEFAULT_RESPONSE_TARGET_MINUTES = 15;
export const DEFAULT_FOLLOWUP_CADENCE_DAYS = [1, 3, 7];
