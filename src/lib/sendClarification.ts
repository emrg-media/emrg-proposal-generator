import "server-only";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getDb } from "@/db";
import { opportunities, type User } from "@/db/schema";
import { logActivity } from "./activity";

// Sending the drafted question email. Separate from the proposal send because
// it is a different act: no PDF, no follow-up sequence armed, and it is asking
// for something rather than delivering something.

export async function sendClarification(
  opportunityId: string, subject: string, body: string, actor: User,
): Promise<void> {
  const db = getDb();
  const [opp] = await db.select().from(opportunities)
    .where(eq(opportunities.id, opportunityId)).limit(1);
  if (!opp) throw new Error("Opportunity not found.");

  const to = opp.email.trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("There is no valid email address on file for this contact.");
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("Email is not configured yet. Add the SMTP settings to the environment.");
  }

  // Strip CR/LF from a subject the user may have edited, which would otherwise
  // allow extra headers to be injected.
  const cleanSubject = subject.replace(/[\r\n]+/g, " ").trim();

  const escapeHtml = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = body.split("\n")
    .map((line) => (line
      ? `<p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111">${escapeHtml(line)}</p>`
      : "<br/>"))
    .join("");

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587"),
    secure: parseInt(SMTP_PORT || "587") === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    bcc: process.env.SMTP_BCC || "events@emrgmedia.com",
    subject: cleanSubject,
    text: body,
    html,
  });

  // Logged as an outbound touch, so it counts as the first response if nothing
  // earlier did, and pauses any running follow-up. It is a real conversation.
  await logActivity({
    opportunityId,
    type: "email_out",
    actorId: actor.id,
    body: `Asked the client for missing details: ${cleanSubject}`,
    meta: { clarification: true, to },
  });
}
