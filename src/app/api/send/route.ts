import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import nodemailer from "nodemailer";
import { buildProposalDocument } from "@/lib/ProposalPDF";
import { logProposal, entryFromProposal } from "@/lib/logProposal";

// Email template (copy supplied by Mario) — merge fields filled from the form.

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function formatDateOrdinal(raw: string): string {
  if (!raw?.trim()) return "";
  const trimmed = raw.trim();
  const m = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{2,4}))?$/);
  let month = -1, day = 0;
  if (m) {
    month = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3)));
    day = parseInt(m[2]);
  } else {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) { month = d.getMonth(); day = d.getDate(); }
  }
  if (month < 0 || !day) return trimmed;
  const suffix = [11,12,13].includes(day % 100) ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
  return `${MONTHS[month]} ${day}${suffix}`;
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  const { client_name, signer_name, events } = data;
  const client_email = typeof data.client_email === "string" ? data.client_email.trim() : "";

  if (!client_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)) {
    return NextResponse.json({ error: "Valid client email required." }, { status: 400 });
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return NextResponse.json(
      { error: "Email is not configured yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optional SMTP_FROM) to the environment." },
      { status: 500 },
    );
  }

  // Build the PDF (cover + letter + agreement)
  const logoPath = join(process.cwd(), "public", "emrg-logo.png");
  const logoBase64 = readFileSync(logoPath).toString("base64");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await renderToBuffer(buildProposalDocument({ ...data, logoBase64 }) as any);

  const nameWords = (signer_name || "").trim().split(/\s+/).filter(Boolean);
  const isHonorific = (w: string) => /^(dr|mr|mrs|ms|miss|prof|rev)\.?$/i.test(w);
  const firstName = nameWords.length > 0
    ? (isHonorific(nameWords[0]) && nameWords.length > 2 ? nameWords[1] : isHonorific(nameWords[0]) ? nameWords.join(" ") : nameWords[0])
    : "there";
  const eventTypes: string[] = [...new Set((events ?? []).flatMap((e: { eventTypes?: string[] }) => e.eventTypes ?? []))] as string[];
  const eventLabel = eventTypes.join(" / ") || "event";
  const dateOrdinal = formatDateOrdinal(events?.[0]?.date ?? "");

  // The UI can pass a reviewed/edited subject + body; otherwise fall back to the default template
  const defaultSubject = `${client_name || "Your Event"} ${eventLabel !== "event" ? eventLabel : ""} | Proposal from EMRG Media`.replace(/\s+/g, " ").trim();
  // Strip CR/LF from the (possibly user-edited) subject — prevents header injection
  const subject: string = (data.subject ?? "").replace(/[\r\n]+/g, " ").trim() || defaultSubject;

  const defaultBody = [
    `Hi ${firstName},`,
    ``,
    `Great speaking with you. Attached is our proposal and agreement for ${client_name ? `${client_name}'s` : "your"} ${eventLabel !== "event" ? eventLabel.toLowerCase() : "event"}${dateOrdinal ? ` on ${dateOrdinal}` : ""}.`,
    ``,
    `Everything we discussed is reflected in the scope. Review at your convenience, and I'm happy to jump on a call with any questions.`,
    ``,
    `Talk soon,`,
    `Mario`,
    ``,
    `Mario Stewart | Founder and CEO, EMRG Media`,
    `212.254.3700 | www.emrgmedia.com`,
  ].join("\n");

  const bodyText: string = (data.body ?? "").trim() || defaultBody;

  // Escape HTML so names/edited text can't inject markup into the email
  const escapeHtml = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const bodyHtml = bodyText
    .split("\n")
    .map((line: string) => (line ? `<p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111">${escapeHtml(line)}</p>` : `<br/>`))
    .join("");

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587"),
    secure: parseInt(SMTP_PORT || "587") === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const filename = `${(client_name || "proposal").replace(/[^a-z0-9]/gi, "-").toLowerCase()}-proposal.pdf`;

  try {
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: client_email,
      // Every outgoing proposal lands in EMRG's inbox as a record
      bcc: process.env.SMTP_BCC || "events@emrgmedia.com",
      subject,
      text: bodyText,
      html: bodyHtml,
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
    });
    logProposal(entryFromProposal("sent", data));
    return NextResponse.json({ ok: true, sentAt: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
