"use server";

import { revalidatePath } from "next/cache";
import { requireUserOrThrow, canApprove } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import {
  createOpportunity, updateOpportunity, changeStage, setOwner, setCollaborators,
  markWon, markLost, requestApproval, approveProposal, controlFollowup,
  type CreateOpportunityInput, type EditableFields,
} from "@/lib/opportunities";
import { parseMoneyToCents } from "@/lib/fee";
import { processPastedEmail } from "@/lib/emailIntake";
import { sendClarification } from "@/lib/sendClarification";
import { LOST_REASONS, STAGES } from "@/lib/constants";
import type { Stage, LostReason, ActivityType } from "@/db/schema";

// Every mutation the UI performs. Each one re-checks authentication itself:
// Server Actions are reachable by direct POST, not only through our own forms,
// so the check in proxy.ts is not sufficient on its own.

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function fail(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
}

function refresh(id?: string) {
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/proposals");
  revalidatePath("/closed");
  revalidatePath("/data");
  revalidatePath("/exec");
  if (id) revalidatePath(`/opportunity/${id}`);
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createOpportunityAction(input: CreateOpportunityInput): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    if (!input.company?.trim() && !input.lastName?.trim()) {
      return { ok: false, error: "Add at least a company or a contact name." };
    }
    const opp = await createOpportunity(input, user);
    refresh(opp.id);
    return { ok: true, id: opp.id };
  } catch (err) { return fail(err); }
}

// ── Edit ─────────────────────────────────────────────────────────────────────

/** Accepts money as typed ("$50,000", "50k") and stores it as cents. */
export async function updateOpportunityAction(
  id: string,
  patch: EditableFields & { budgetLowText?: string; budgetHighText?: string },
): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    const clean: EditableFields = { ...patch };
    if (patch.budgetLowText !== undefined) clean.budgetLowCents = parseMoneyToCents(patch.budgetLowText);
    if (patch.budgetHighText !== undefined) clean.budgetHighCents = parseMoneyToCents(patch.budgetHighText);
    delete (clean as Record<string, unknown>).budgetLowText;
    delete (clean as Record<string, unknown>).budgetHighText;

    await updateOpportunity(id, clean, user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function changeStageAction(id: string, stage: string): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    if (!STAGES.includes(stage as Stage)) return { ok: false, error: "Unknown stage." };
    await changeStage(id, stage as Stage, user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function setOwnerAction(id: string, ownerId: string | null): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    await setOwner(id, ownerId || null, user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function setCollaboratorsAction(id: string, userIds: string[]): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    await setCollaborators(id, userIds, user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

// ── Timeline ─────────────────────────────────────────────────────────────────

const LOGGABLE: ActivityType[] = ["note", "call", "meeting", "email_out", "email_in"];

export async function logActivityAction(
  id: string, type: string, body: string,
): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    if (!LOGGABLE.includes(type as ActivityType)) return { ok: false, error: "Unknown activity type." };
    if (!body.trim()) return { ok: false, error: "Add a short description." };

    // An inbound message is the client's, not the logger's — attributing it to
    // the planner would corrupt "who touched this last" and the speed metrics.
    const actorId = type === "email_in" ? null : user.id;
    await logActivity({
      opportunityId: id, type: type as ActivityType, actorId,
      body: body.trim(), meta: type === "email_in" ? { loggedBy: user.name } : {},
    });
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

// ── Outcome ──────────────────────────────────────────────────────────────────

export async function markWonAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    await markWon(id, user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function markLostAction(id: string, reason: string, note: string): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    // A reason is mandatory (brief §18) — it is the whole point of recording losses.
    if (!LOST_REASONS.includes(reason as LostReason)) {
      return { ok: false, error: "Pick a reason this was lost." };
    }
    await markLost(id, reason as LostReason, note.trim().slice(0, 500), user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

// ── Approvals ────────────────────────────────────────────────────────────────

export async function requestApprovalAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    await requestApproval(id, user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function approveProposalAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    if (!canApprove(user)) return { ok: false, error: "Only Erica or Mario can approve proposals." };
    await approveProposal(id, user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

// ── Follow-up ────────────────────────────────────────────────────────────────

export async function controlFollowupAction(
  id: string, action: string, dateIso?: string,
): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    switch (action) {
      case "resume_now":
        await controlFollowup(id, { action: "resume_now" }, user); break;
      case "resume_on": {
        const date = dateIso ? new Date(dateIso) : null;
        if (!date || isNaN(date.getTime())) return { ok: false, error: "Pick a valid date." };
        await controlFollowup(id, { action: "resume_on", date }, user); break;
      }
      case "stay_paused":
        await controlFollowup(id, { action: "stay_paused" }, user); break;
      case "stop":
        await controlFollowup(id, { action: "stop" }, user); break;
      default:
        return { ok: false, error: "Unknown follow-up action." };
    }
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}

// ── Email intake ─────────────────────────────────────────────────────────────

export type EmailIntakeResult =
  | { ok: true; action: "created"; id: string; code: string; missing: string[]; routingReason: string }
  | { ok: true; action: "reply_logged"; id: string; code: string }
  | { ok: true; action: "ignored"; reason: string }
  | { ok: false; error: string };

/**
 * Runs a pasted email through exactly the same pipeline a connected inbox
 * will use, so what the team sees today is what automation will do later.
 */
export async function intakeEmailAction(raw: string): Promise<EmailIntakeResult> {
  try {
    const user = await requireUserOrThrow();
    if (!raw.trim()) return { ok: false, error: "Paste the email first." };

    const result = await processPastedEmail(raw, user);
    refresh(result.action === "ignored" ? undefined : result.opportunityId);

    if (result.action === "created") {
      return { ok: true, action: "created", id: result.opportunityId, code: result.code,
               missing: result.missing, routingReason: result.routingReason };
    }
    if (result.action === "reply_logged") {
      return { ok: true, action: "reply_logged", id: result.opportunityId, code: result.code };
    }
    return { ok: true, action: "ignored", reason: result.reason };
  } catch (err) { return fail(err) as EmailIntakeResult; }
}

// ── Clarification emails ─────────────────────────────────────────────────────

/**
 * Send the drafted question email to the client.
 *
 * A person has read it and pressed send, so this is reviewed rather than
 * automatic. It is logged as an outbound touch, which stops the speed-to-lead
 * clock and pauses any running follow-up, because it is a real conversation.
 */
export async function sendClarificationAction(
  id: string, subject: string, body: string,
): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    if (!subject.trim()) return { ok: false, error: "The email needs a subject." };
    if (!body.trim()) return { ok: false, error: "The email is empty." };

    await sendClarification(id, subject, body, user);
    refresh(id);
    return { ok: true };
  } catch (err) { return fail(err); }
}
