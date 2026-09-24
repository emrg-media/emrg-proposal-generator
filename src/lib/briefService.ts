import "server-only";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { listOpportunities, toAttentionInput } from "./opportunities";
import { buildAttentionList, groupAttention } from "./attention";
import { computeKpis, type KpiInput } from "./kpi";
import { getSettings } from "./settings";
import { briefWindow, composeBrief, type Brief } from "./brief";

// Gathers the numbers for the daily brief and sends it.
//
// "Sent only to me" in the brief, so it goes to admins by default rather than
// to a list somebody has to remember to maintain.

export async function buildBrief(now: Date = new Date()): Promise<Brief> {
  const [rows, appSettings] = await Promise.all([listOpportunities(), getSettings()]);
  const window = briefWindow(now);

  const kpiInput: KpiInput[] = rows.map((r) => ({
    id: r.id, stage: r.stage, ownerId: r.ownerId, ownerName: r.ownerName,
    valueCents: r.proposalValueCents,
    leadReceivedAt: r.leadReceivedAt, firstResponseAt: r.firstResponseAt,
    proposalGeneratedAt: r.proposalGeneratedAt, proposalSentAt: r.proposalSentAt,
    nextAction: r.nextAction, nextActionDate: r.nextActionDate,
    followupState: r.followupState, followupDueAt: r.followupDueAt,
    wonAt: r.wonAt, lostAt: r.lostAt,
  }));

  const kpis = computeKpis(kpiInput, { start: window.start, end: null }, {
    now, responseTargetMinutes: appSettings.responseTargetMinutes,
  });

  const attention = groupAttention(buildAttentionList(
    rows.map(toAttentionInput),
    { now, responseTargetMinutes: appSettings.responseTargetMinutes },
  ));

  return composeBrief({
    kpis, attention, window, now,
    responseTargetMinutes: appSettings.responseTargetMinutes,
    appUrl: appUrl(),
  });
}

/**
 * Where the "open the dashboard" link points.
 *
 * Falls through deliberately: an explicit APP_URL wins, then the project's
 * production domain, then this particular deployment. Without the middle step a
 * brief sent from a preview would link to whatever is on production, which for
 * now is still the old app.
 */
function appUrl(): string {
  if (process.env.APP_URL?.trim()) return process.env.APP_URL.trim();
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;
  return "http://localhost:3000";
}

/** Who receives it. Admins, unless an explicit list has been configured. */
export async function briefRecipients(): Promise<string[]> {
  const configured = process.env.BRIEF_RECIPIENTS;
  if (configured?.trim()) {
    return configured.split(",").map((e) => e.trim()).filter(Boolean);
  }
  const rows = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true)));
  return rows.map((r) => r.email);
}

export interface BriefSendResult {
  sent: boolean;
  recipients: string[];
  reason?: string;
  subject?: string;
}

export async function sendBrief(now: Date = new Date()): Promise<BriefSendResult> {
  const recipients = await briefRecipients();
  if (recipients.length === 0) {
    return { sent: false, recipients: [], reason: "Nobody to send it to" };
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return { sent: false, recipients, reason: "SMTP is not configured" };
  }

  const brief = await buildBrief(now);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587"),
    secure: parseInt(SMTP_PORT || "587") === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    // Private by design: no BCC to the shared events inbox, unlike a proposal.
    to: recipients.join(", "),
    subject: brief.subject,
    text: brief.text,
    html: brief.html,
  });

  return { sent: true, recipients, subject: brief.subject };
}
