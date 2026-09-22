import {
  pgTable, pgEnum, uuid, text, integer, bigint, boolean,
  timestamp, jsonb, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// The whole revenue system hangs off these five tables. Every field the brief
// asks for has a real column; anything added later goes in the `custom` jsonb
// on each table, so new fields never require a rebuild (brief §8).

// ── Enums ────────────────────────────────────────────────────────────────────

export const userRole = pgEnum("user_role", ["admin", "manager", "planner"]);

// The nine pipeline stages, in order. Stored as snake_case, rendered via STAGE_LABELS.
export const stage = pgEnum("stage", [
  "new_lead", "contacted", "proposal_needed", "proposal_review",
  "proposal_sent", "client_reviewing", "contract_deposit", "won", "lost",
]);

export const followupState = pgEnum("followup_state", ["inactive", "active", "paused", "stopped"]);

export const approvalState = pgEnum("approval_state", ["not_required", "waiting", "approved"]);

export const lostReason = pgEnum("lost_reason", [
  "budget", "date_unavailable", "competitor", "ghosted", "event_canceled",
  "event_postponed", "timing_future", "not_a_fit", "other",
]);

// Every kind of thing that can land on an opportunity's timeline.
export const activityType = pgEnum("activity_type", [
  "lead_received", "note", "email_out", "email_in", "call", "meeting",
  "proposal_generated", "proposal_sent", "approval_requested", "approved",
  "stage_change", "owner_change", "followup_sent", "followup_paused",
  "followup_resumed", "won", "lost", "field_change",
]);

// ── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  // scrypt hash of the personal PIN, stored as "salt:derivedKey" (see lib/auth.ts)
  pinHash: text("pin_hash").notNull(),
  role: userRole("role").notNull().default("planner"),
  active: boolean("active").notNull().default(true),
  // PIN throttling — a 6-digit PIN is only safe with a lockout.
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Opportunities ────────────────────────────────────────────────────────────

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Human-facing ID, e.g. EMRG-20260921-A4F2. Shared with the proposal PDF.
  code: text("code").notNull().unique(),

  // Contact (brief §7) — email is the one field we insist on before sending.
  company: text("company").notNull().default(""),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  title: text("title").notNull().default(""),
  email: text("email").notNull().default(""),
  cellPhone: text("cell_phone").notNull().default(""),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  zip: text("zip").notNull().default(""),
  website: text("website").notNull().default(""),

  // Where it came from. rawIntake keeps the original transcript/email/voice text
  // so an extraction can always be re-run or audited.
  leadSource: text("lead_source").notNull().default(""),
  leadReceivedAt: timestamp("lead_received_at", { withTimezone: true }).notNull().defaultNow(),
  rawIntake: jsonb("raw_intake").$type<Record<string, unknown>>().notNull().default({}),

  // Event (brief §8)
  eventName: text("event_name").notNull().default(""),
  eventTypes: text("event_types").array().notNull().default([]),
  eventDate: text("event_date").notNull().default(""), // free text: dates are often "TBD" or a range
  guestCount: text("guest_count").notNull().default(""),
  venue: text("venue").notNull().default(""),
  requestedServices: text("requested_services").array().notNull().default([]),
  notes: text("notes").notNull().default(""),

  // Money. feeRaw preserves exactly what was quoted ("20%", "$8k-12k") because
  // the resolved dollar figure may be an estimate — see lib/fee.ts.
  feeRaw: text("fee_raw").notNull().default(""),
  budgetLowCents: bigint("budget_low_cents", { mode: "number" }),
  budgetHighCents: bigint("budget_high_cents", { mode: "number" }),
  proposalValueCents: bigint("proposal_value_cents", { mode: "number" }),
  valueEstimated: boolean("value_estimated").notNull().default(false),

  // People. Owner is a single column so accountability is never ambiguous;
  // collaborators are additive via opportunityCollaborators.
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  lastTouchedById: uuid("last_touched_by_id").references(() => users.id, { onDelete: "set null" }),

  stage: stage("stage").notNull().default("new_lead"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),

  // Speed-to-lead timestamps (brief §13). firstResponseAt is stamped by the
  // activity logger on the first human outbound touch — never typed by hand.
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  proposalGeneratedAt: timestamp("proposal_generated_at", { withTimezone: true }),
  proposalSentAt: timestamp("proposal_sent_at", { withTimezone: true }),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),

  nextAction: text("next_action").notNull().default(""),
  nextActionDate: timestamp("next_action_date", { withTimezone: true }),
  nextActionOwnerId: uuid("next_action_owner_id").references(() => users.id, { onDelete: "set null" }),

  // Follow-up engine (brief §16/§17)
  followupState: followupState("followup_state").notNull().default("inactive"),
  followupStep: integer("followup_step").notNull().default(0),
  followupPausedReason: text("followup_paused_reason").notNull().default(""),
  followupResumeAt: timestamp("followup_resume_at", { withTimezone: true }),
  // When the next automated touch is due. Set now so the Phase 2 cron needs no
  // migration; Needs Attention already reads it to spot overdue follow-ups.
  followupDueAt: timestamp("followup_due_at", { withTimezone: true }),

  // Approvals (brief §15)
  approvalState: approvalState("approval_state").notNull().default("not_required"),
  approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  // Outcome. Lost records are never deleted (brief §18).
  wonAt: timestamp("won_at", { withTimezone: true }),
  lostAt: timestamp("lost_at", { withTimezone: true }),
  lostReason: lostReason("lost_reason"),
  lostNote: text("lost_note").notNull().default(""),

  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The dashboards filter on these constantly.
  index("opportunities_stage_idx").on(t.stage),
  index("opportunities_owner_idx").on(t.ownerId),
  index("opportunities_lead_received_idx").on(t.leadReceivedAt),
  index("opportunities_last_activity_idx").on(t.lastActivityAt),
]);

// ── Collaborators ────────────────────────────────────────────────────────────

export const opportunityCollaborators = pgTable("opportunity_collaborators", {
  opportunityId: uuid("opportunity_id").notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.opportunityId, t.userId] }),
  index("collaborators_user_idx").on(t.userId),
]);

// ── Activities (the timeline) ────────────────────────────────────────────────

// This table is the engine behind the timeline, last activity, speed-to-lead,
// human-takeover detection and most Needs Attention rules. actorId is null for
// anything the system did on its own.
export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  type: activityType("type").notNull(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull().default(""),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("activities_opportunity_idx").on(t.opportunityId, t.occurredAt),
  index("activities_type_idx").on(t.type),
]);

// ── Proposals ────────────────────────────────────────────────────────────────

// One row per generated version, kept permanently whatever happens to the deal
// (brief §6). `snapshot` is the exact ProposalData handed to the PDF renderer,
// so any past proposal can be reproduced byte-for-byte.
export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  feeRaw: text("fee_raw").notNull().default(""),
  feeCents: bigint("fee_cents", { mode: "number" }),
  generatedById: uuid("generated_by_id").references(() => users.id, { onDelete: "set null" }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentTo: text("sent_to").notNull().default(""),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  uniqueIndex("proposals_opportunity_version_idx").on(t.opportunityId, t.version),
]);

// ── Settings ─────────────────────────────────────────────────────────────────

// Small key/value store: response target, follow-up cadence, brief recipients.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Inferred types ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;

export type Stage = (typeof stage.enumValues)[number];
export type ActivityType = (typeof activityType.enumValues)[number];
export type LostReason = (typeof lostReason.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
