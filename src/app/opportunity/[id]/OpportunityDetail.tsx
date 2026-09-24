"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Opportunity } from "@/db/schema";
import {
  STAGES, STAGE_LABELS, LOST_REASONS, LOST_REASON_LABELS, ACTIVITY_LABELS, LEAD_SOURCES,
} from "@/lib/constants";
import { fmtCents, computeFee, budgetText, feeLabel } from "@/lib/fee";
import { checkCompleteness, clarificationQuestions } from "@/lib/completeness";
import { formatDuration, fmtDateTime, isoDate } from "@/lib/time";
import { StageChip } from "@/components/ui";
import {
  updateOpportunityAction, changeStageAction, setOwnerAction, setCollaboratorsAction,
  logActivityAction, markWonAction, markLostAction, requestApprovalAction,
  approveProposalAction, controlFollowupAction,
} from "@/app/actions";

// One opportunity, everything about it. Details on the left, the full
// chronological history on the right — so anyone picking this up mid-stream can
// see what has already happened without asking (brief §20).

interface TimelineEntry {
  id: string; type: string; body: string; occurredAt: string; actorName: string | null;
}
interface ProposalEntry {
  id: string; version: number; feeRaw: string; feeCents: number | null;
  generatedAt: string; sentAt: string | null; sentTo: string;
}
interface TeamMember { id: string; name: string; role: string }

export default function OpportunityDetail({
  opportunity: opp, timeline, collaborators, proposals, team,
  currentUserCanApprove, responseTargetMinutes,
}: {
  opportunity: Opportunity;
  timeline: TimelineEntry[];
  collaborators: Array<{ userId: string; name: string }>;
  proposals: ProposalEntry[];
  team: TeamMember[];
  currentUserCanApprove: boolean;
  responseTargetMinutes: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [lostOpen, setLostOpen] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  const fee = computeFee(opp.feeRaw, budgetText(opp.budgetLowCents, opp.budgetHighCents));
  const contactName = [opp.firstName, opp.lastName].filter(Boolean).join(" ");
  const completeness = checkCompleteness(opp);

  const speedMs = opp.firstResponseAt
    ? new Date(opp.firstResponseAt).getTime() - new Date(opp.leadReceivedAt).getTime()
    : null;
  const withinTarget = speedMs !== null && speedMs <= responseTargetMinutes * 60_000;

  return (
    <div className="px-5 md:px-8 py-6 max-w-[1600px] mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1.5">
            <h1 className="text-[24px] font-bold tracking-tight truncate" style={{ color: "#111111" }}>
              {opp.company || contactName || "Untitled opportunity"}
            </h1>
            <StageChip stage={opp.stage} label={STAGE_LABELS[opp.stage]} />
            {opp.approvalState === "waiting" && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-[0.08em] uppercase"
                style={{ background: "#fff7ed", color: "#9a3412" }}>
                Waiting for Erica
              </span>
            )}
          </div>
          <p className="text-[13.5px] text-stone-500">
            {[opp.eventName, opp.eventDate, opp.guestCount && `${opp.guestCount} guests`, opp.venue]
              .filter(Boolean).join("  ·  ") || "No event details yet"}
          </p>
          <p className="text-[11.5px] font-mono text-stone-400 mt-1">{opp.code}</p>
        </div>

        <div className="text-right">
          <p className="text-[26px] font-bold leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
            {feeLabel(fee, opp.feeRaw)}
          </p>
          {fee.estimated && fee.basis && (
            <p className="text-[11px] mt-1 max-w-[230px]" style={{ color: "#92600a" }}>{fee.basis}</p>
          )}
        </div>
      </div>

      {completeness.missing.length > 0 && <MissingInfo completeness={completeness} />}
      {opp.followupState === "paused" && (
        <FollowupPaused
          reason={opp.followupPausedReason}
          pending={pending}
          onCommand={(action, date) => run(() => controlFollowupAction(opp.id, action, date))}
        />
      )}
      {error && <Banner tone="red">{error}</Banner>}

      {/* ── Actions ── */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Link href={`/opportunity/${opp.id}/proposal`}
          className="text-[11px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded text-white"
          style={{ background: "var(--emrg-red)" }}>
          {proposals.length ? "New proposal version" : "Generate proposal"}
        </Link>

        {opp.approvalState !== "waiting" && opp.approvalState !== "approved" && (
          <ActionButton disabled={pending} onClick={() => run(() => requestApprovalAction(opp.id))}>
            Send to Erica
          </ActionButton>
        )}
        {opp.approvalState === "waiting" && currentUserCanApprove && (
          <ActionButton disabled={pending} tone="green" onClick={() => run(() => approveProposalAction(opp.id))}>
            Approve
          </ActionButton>
        )}
        {opp.stage !== "won" && (
          <ActionButton disabled={pending} tone="green" onClick={() => run(() => markWonAction(opp.id))}>
            Mark won
          </ActionButton>
        )}
        {opp.stage !== "lost" && (
          <ActionButton disabled={pending} onClick={() => setLostOpen(true)}>Mark lost</ActionButton>
        )}

        <div className="ml-auto flex items-center gap-2">
          <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500">Stage</label>
          <select
            value={opp.stage}
            disabled={pending}
            onChange={(e) => run(() => changeStageAction(opp.id, e.target.value))}
            className="border-2 border-stone-300 rounded-md px-3 py-1.5 text-[13px] bg-white"
          >
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </div>
      </div>

      {opp.stage === "lost" && opp.lostReason && (
        <Banner tone="grey">
          <strong>Lost: {LOST_REASON_LABELS[opp.lostReason]}.</strong>{" "}
          {opp.lostNote || "Kept on record for reporting and future nurture."}
        </Banner>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
        {/* ── Left: details ── */}
        <div className="space-y-5">
          <Panel title="Ownership">
            <Field label="Primary owner">
              <select
                value={opp.ownerId ?? ""}
                disabled={pending}
                onChange={(e) => run(() => setOwnerAction(opp.id, e.target.value || null))}
                className="w-full border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white"
              >
                <option value="">Unassigned</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Collaborators">
              <div className="flex flex-wrap gap-1.5">
                {team.filter((m) => m.id !== opp.ownerId).map((m) => {
                  const on = collaborators.some((c) => c.userId === m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const next = on
                          ? collaborators.filter((c) => c.userId !== m.id).map((c) => c.userId)
                          : [...collaborators.map((c) => c.userId), m.id];
                        run(() => setCollaboratorsAction(opp.id, next));
                      }}
                      className="px-2.5 py-1 rounded text-[12px] font-medium border transition-colors"
                      style={on
                        ? { borderColor: "var(--emrg-red)", background: "rgba(192,24,42,0.06)", color: "#111" }
                        : { borderColor: "#d6d3d1", background: "#fff", color: "#78716c" }}
                    >
                      {m.name.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <NextAction opp={opp} pending={pending} onSave={(patch) =>
              run(() => updateOpportunityAction(opp.id, patch))} />
          </Panel>

          <EditableDetails opp={opp} pending={pending}
            onSave={(patch) => run(() => updateOpportunityAction(opp.id, patch))} />

          <Panel title="Speed &amp; timing">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat label="Lead received" value={fmtDateTime(opp.leadReceivedAt)} />
              <Stat
                label="Speed to lead"
                value={speedMs === null ? "Not answered yet" : formatDuration(speedMs)}
                tone={speedMs === null ? "red" : withinTarget ? "green" : "amber"}
              />
              <Stat label="Proposal generated" value={fmtDateTime(opp.proposalGeneratedAt)} />
              <Stat label="Proposal sent" value={fmtDateTime(opp.proposalSentAt)} />
              <Stat label="Last contact" value={fmtDateTime(opp.lastContactAt)} />
              <Stat label="Last activity" value={fmtDateTime(opp.lastActivityAt)} />
            </dl>
          </Panel>

          {proposals.length > 0 && (
            <Panel title={`Proposals (${proposals.length})`}>
              <div className="space-y-2">
                {proposals.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-stone-100 last:border-0">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-stone-800">Version {p.version}</p>
                      <p className="text-[11.5px] text-stone-400">
                        Generated {fmtDateTime(p.generatedAt)}
                        {p.sentAt ? ` · Sent to ${p.sentTo}` : " · Not sent"}
                      </p>
                    </div>
                    <span className="text-[13px] font-semibold whitespace-nowrap"
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                      {p.feeCents !== null ? fmtCents(p.feeCents) : p.feeRaw || "Not set"}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        {/* ── Right: timeline ── */}
        <div className="space-y-5">
          <LogActivity opp={opp} pending={pending}
            onLog={(type, body) => run(() => logActivityAction(opp.id, type, body))} />
          <Panel title="Timeline">
            {timeline.length === 0 ? (
              <p className="text-[13px] text-stone-400">Nothing recorded yet.</p>
            ) : (
              <ol className="relative">
                {timeline.map((t, i) => (
                  <li key={t.id} className="flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <span className="w-[9px] h-[9px] rounded-full mt-1.5"
                        style={{ background: i === 0 ? "var(--emrg-red)" : "#d6d3d1" }} />
                      {i < timeline.length - 1 && <span className="w-px flex-1 bg-stone-200 mt-1" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] text-stone-800">
                        <span className="font-semibold">
                          {ACTIVITY_LABELS[t.type as keyof typeof ACTIVITY_LABELS] ?? t.type}
                        </span>
                        {t.body && <span className="text-stone-600">: {t.body}</span>}
                      </p>
                      <p className="text-[11.5px] text-stone-400 mt-0.5">
                        {fmtDateTime(t.occurredAt)}{t.actorName ? ` · ${t.actorName}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>

      {lostOpen && (
        <LostModal
          pending={pending}
          onClose={() => setLostOpen(false)}
          onConfirm={(reason, note) => {
            setLostOpen(false);
            run(() => markLostAction(opp.id, reason, note));
          }}
        />
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-stone-200 rounded-lg p-5">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "#111111" }}>
        {title}
      </p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" | "green" | "amber" }) {
  const color = tone === "green" ? "#15803d" : tone === "red" ? "var(--emrg-red)"
    : tone === "amber" ? "#92600a" : "#292524";
  return (
    <div>
      <dt className="text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500">{label}</dt>
      <dd className="text-[13.5px] font-medium mt-0.5" style={{ color }}>{value}</dd>
    </div>
  );
}

function ActionButton({ children, onClick, disabled, tone }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: "green";
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="text-[11px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded border-2 transition-colors disabled:opacity-40"
      style={tone === "green"
        ? { borderColor: "#15803d", color: "#15803d", background: "#fff" }
        : { borderColor: "#d6d3d1", color: "#57534e", background: "#fff" }}>
      {children}
    </button>
  );
}

/**
 * What is still outstanding, split by whether it stops the proposal going out
 * or merely weakens it. The questions are already phrased for the client, so
 * chasing the gaps is a copy and paste rather than a writing job.
 */
function MissingInfo({ completeness }: { completeness: ReturnType<typeof checkCompleteness> }) {
  const [copied, setCopied] = useState(false);
  const { blocking, important, optional } = completeness;
  const tone = blocking.length > 0
    ? { bg: "#fef2f2", border: "#fecaca", fg: "#991b1b" }
    : { bg: "#fdf6e9", border: "#e7d3a6", fg: "#7a5309" };

  const questions = clarificationQuestions(completeness);

  return (
    <div className="mb-4 px-4 py-3 rounded-lg border"
      style={{ background: tone.bg, borderColor: tone.border }}>
      <p className="text-[12.5px] font-bold tracking-[0.06em] uppercase mb-2" style={{ color: tone.fg }}>
        {blocking.length > 0
          ? "Cannot send yet"
          : `Still needed (${important.length})`}
      </p>

      {blocking.length > 0 && (
        <p className="text-[13px] mb-2" style={{ color: tone.fg }}>
          <strong>{blocking.map((m) => m.label).join(" and ")}</strong>{" "}
          {blocking.length === 1 ? "is" : "are"} required before this proposal can go out.
        </p>
      )}

      {important.length > 0 && (
        <p className="text-[13px] mb-2" style={{ color: tone.fg }}>
          Also missing: {important.map((m) => m.label.toLowerCase()).join(", ")}.
        </p>
      )}

      {optional.length > 0 && (
        <p className="text-[12px] mb-2" style={{ color: tone.fg, opacity: 0.8 }}>
          Nice to have: {optional.map((m) => m.label.toLowerCase()).join(", ")}.
        </p>
      )}

      {questions.length > 0 && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(questions.map((q) => `\u2022 ${q}`).join("\n"))
              .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
              .catch(() => {});
          }}
          className="text-[11px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border"
          style={{ borderColor: tone.border, color: tone.fg, background: "#fff" }}
        >
          {copied ? "Copied" : `Copy ${questions.length} question${questions.length === 1 ? "" : "s"} for the client`}
        </button>
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: "red" | "amber" | "grey"; children: React.ReactNode }) {
  const s = tone === "red" ? { background: "#fef2f2", border: "#fecaca", color: "#991b1b" }
    : tone === "amber" ? { background: "#fdf6e9", border: "#e7d3a6", color: "#7a5309" }
    : { background: "#f5f5f4", border: "#e7e5e4", color: "#57534e" };
  return (
    <div className="mb-4 px-4 py-2.5 rounded-lg border text-[13px]"
      style={{ background: s.background, borderColor: s.border, color: s.color }}>
      {children}
    </div>
  );
}

/** Human takeover controls (brief §17). */
function FollowupPaused({ reason, pending, onCommand }: {
  reason: string; pending: boolean; onCommand: (action: string, date?: string) => void;
}) {
  const [date, setDate] = useState("");
  return (
    <div className="mb-4 px-4 py-3 rounded-lg border"
      style={{ background: "#fdf6e9", borderColor: "#e7d3a6" }}>
      <p className="text-[12.5px] font-bold tracking-[0.06em] uppercase mb-1" style={{ color: "#7a5309" }}>
        Follow-up paused: {reason || "human conversation active"}
      </p>
      <p className="text-[12.5px] mb-3" style={{ color: "#7a5309" }}>
        Automated follow-ups have stepped aside so they don&apos;t talk over a live conversation.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => onCommand("resume_now")}
          className="text-[11px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border"
          style={{ borderColor: "#c9a227", color: "#7a5309", background: "#fff" }}>
          Resume now
        </button>
        <div className="flex items-center gap-1.5">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="border rounded px-2 py-1.5 text-[12.5px] bg-white" style={{ borderColor: "#e7d3a6" }} />
          <button type="button" disabled={pending || !date}
            onClick={() => onCommand("resume_on", new Date(date).toISOString())}
            className="text-[11px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border disabled:opacity-40"
            style={{ borderColor: "#c9a227", color: "#7a5309", background: "#fff" }}>
            Resume on date
          </button>
        </div>
        <button type="button" disabled={pending} onClick={() => onCommand("stay_paused")}
          className="text-[11px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border"
          style={{ borderColor: "#e7d3a6", color: "#7a5309", background: "#fff" }}>
          Stay paused
        </button>
        <button type="button" disabled={pending} onClick={() => onCommand("stop")}
          className="text-[11px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border"
          style={{ borderColor: "#e7d3a6", color: "#7a5309", background: "#fff" }}>
          Stop follow-up
        </button>
      </div>
    </div>
  );
}

function NextAction({ opp, pending, onSave }: {
  opp: Opportunity; pending: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(opp.nextAction);
  const [date, setDate] = useState(opp.nextActionDate ? isoDate(opp.nextActionDate) : "");
  const dirty = text !== opp.nextAction || date !== (opp.nextActionDate ? isoDate(opp.nextActionDate) : "");

  return (
    <Field label="Next action">
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)}
          placeholder="What happens next?"
          className="flex-1 border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white" />
      </div>
      {dirty && (
        <button type="button" disabled={pending}
          onClick={() => onSave({
            nextAction: text,
            nextActionDate: date ? new Date(`${date}T12:00:00`) : null,
          })}
          className="mt-2 text-[10px] font-bold tracking-[0.14em] uppercase px-3 py-1.5 rounded text-white"
          style={{ background: "var(--emrg-red)" }}>
          Save next action
        </button>
      )}
    </Field>
  );
}

function LogActivity({ opp, pending, onLog }: {
  opp: Opportunity; pending: boolean; onLog: (type: string, body: string) => void;
}) {
  const [type, setType] = useState("note");
  const [body, setBody] = useState("");
  const options = [
    { v: "note", l: "Note" }, { v: "call", l: "Phone call" }, { v: "meeting", l: "Meeting" },
    { v: "email_out", l: "Email we sent" }, { v: "email_in", l: "Client replied" },
  ];

  return (
    <Panel title="Log what happened">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {options.map((o) => (
          <button key={o.v} type="button" onClick={() => setType(o.v)}
            className="px-2.5 py-1 rounded text-[12px] font-medium border transition-colors"
            style={type === o.v
              ? { borderColor: "var(--emrg-red)", background: "rgba(192,24,42,0.06)", color: "#111" }
              : { borderColor: "#d6d3d1", background: "#fff", color: "#78716c" }}>
            {o.l}
          </button>
        ))}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="A sentence is enough. It goes on the timeline."
        className="w-full h-20 border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white resize-none" />
      <div className="flex items-center justify-between mt-2 gap-3">
        <p className="text-[11.5px] text-stone-400">
          {opp.followupState === "active"
            ? "Logging a conversation pauses automated follow-up."
            : "Recorded against you and added to the timeline."}
        </p>
        <button type="button" disabled={pending || !body.trim()}
          onClick={() => { onLog(type, body); setBody(""); }}
          className="text-[10px] font-bold tracking-[0.14em] uppercase px-3.5 py-2 rounded text-white disabled:opacity-40 whitespace-nowrap"
          style={{ background: "var(--emrg-red)" }}>
          Add to timeline
        </button>
      </div>
    </Panel>
  );
}

// Field keys the details panel edits. Declared here, outside the component,
// because the inputs below must be stable component types — see DetailInput.
type DetailsForm = Record<string, string>;

/**
 * Defined at module scope, NOT inside EditableDetails.
 *
 * A component created during render is a new type on every render, so React
 * unmounts and remounts it — which meant the field lost focus after every
 * single keystroke and the panel was unusable for typing.
 */
function DetailInput({ label, value, onChange, placeholder, type = "text", highlight }: {
  label: string; value: string; placeholder?: string; type?: string; highlight?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1">
        {label}
      </label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border-2 rounded-md px-3 py-1.5 text-[14px] bg-white"
        style={{ borderColor: highlight ? "#e7d3a6" : "#d6d3d1" }} />
    </div>
  );
}

function EditableDetails({ opp, pending, onSave }: {
  opp: Opportunity; pending: boolean; onSave: (patch: Record<string, unknown>) => void;
}) {
  const initial: DetailsForm = {
    company: opp.company, firstName: opp.firstName, lastName: opp.lastName, title: opp.title,
    email: opp.email, cellPhone: opp.cellPhone, website: opp.website,
    address: opp.address, city: opp.city, state: opp.state, zip: opp.zip,
    leadSource: opp.leadSource, eventName: opp.eventName, eventDate: opp.eventDate,
    guestCount: opp.guestCount, venue: opp.venue, notes: opp.notes, feeRaw: opp.feeRaw,
    budgetLowText: opp.budgetLowCents ? String(opp.budgetLowCents / 100) : "",
    budgetHighText: opp.budgetHighCents ? String(opp.budgetHighCents / 100) : "",
  };
  const [form, setForm] = useState<DetailsForm>(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Panel title="Details">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <DetailInput label="Company" value={form.company} onChange={set("company")} />
        <div>
          <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1">Lead source</label>
          <select value={form.leadSource} onChange={(e) => set("leadSource")(e.target.value)}
            className="w-full border-2 border-stone-300 rounded-md px-3 py-1.5 text-[14px] bg-white">
            <option value="">Not set</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            {form.leadSource && !LEAD_SOURCES.includes(form.leadSource) &&
              <option value={form.leadSource}>{form.leadSource}</option>}
          </select>
        </div>
        <DetailInput label="First name" value={form.firstName} onChange={set("firstName")} />
        <DetailInput label="Last name" value={form.lastName} onChange={set("lastName")} />
        <DetailInput label="Title" value={form.title} onChange={set("title")} />
        <DetailInput label="Email (required to send)" value={form.email} onChange={set("email")}
          type="email" placeholder="name@company.com" highlight={!form.email.trim()} />
        <DetailInput label="Cell phone" value={form.cellPhone} onChange={set("cellPhone")} />
        <DetailInput label="Website" value={form.website} onChange={set("website")} />
        <DetailInput label="Address" value={form.address} onChange={set("address")} />
        <DetailInput label="City" value={form.city} onChange={set("city")} />
        <DetailInput label="State" value={form.state} onChange={set("state")} />
        <DetailInput label="ZIP" value={form.zip} onChange={set("zip")} />
      </div>

      <div className="border-t border-stone-100 pt-3 grid grid-cols-2 gap-3 mb-3">
        <DetailInput label="Event name" value={form.eventName} onChange={set("eventName")} />
        <DetailInput label="Event date" value={form.eventDate} onChange={set("eventDate")}
          placeholder="December 14, 2026" />
        <DetailInput label="Guest count" value={form.guestCount} onChange={set("guestCount")} placeholder="200" />
        <DetailInput label="Venue" value={form.venue} onChange={set("venue")} />
        <DetailInput label="Budget low" value={form.budgetLowText} onChange={set("budgetLowText")} placeholder="50000" />
        <DetailInput label="Budget high" value={form.budgetHighText} onChange={set("budgetHighText")} placeholder="75000" />
        <div className="col-span-2">
          <DetailInput label="Fee (a figure, a range, or a %)" value={form.feeRaw} onChange={set("feeRaw")}
            placeholder="$12,000 or 20%" />
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1">Notes</label>
        <textarea value={form.notes} onChange={(e) => set("notes")(e.target.value)}
          className="w-full h-20 border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white resize-none" />
      </div>

      {dirty && (
        <div className="flex items-center gap-2 mt-3">
          <button type="button" disabled={pending} onClick={() => onSave(form)}
            className="text-[10px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded text-white"
            style={{ background: "var(--emrg-red)" }}>
            Save changes
          </button>
          <button type="button" onClick={() => setForm(initial)}
            className="text-[10px] font-bold tracking-[0.14em] uppercase px-3 py-2 text-stone-500">
            Discard
          </button>
        </div>
      )}
    </Panel>
  );
}

function LostModal({ pending, onClose, onConfirm }: {
  pending: boolean; onClose: () => void; onConfirm: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: "#111111" }}>
          Mark as lost
        </p>
        <p className="text-[13px] text-stone-500 mb-4">
          Nothing is deleted. Recording why is what makes the reporting useful later.
        </p>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {LOST_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className="px-3 py-2 rounded text-[12.5px] font-medium border text-left transition-colors"
              style={reason === r
                ? { borderColor: "var(--emrg-red)", background: "rgba(192,24,42,0.06)", color: "#111" }
                : { borderColor: "#d6d3d1", background: "#fff", color: "#57534e" }}>
              {LOST_REASON_LABELS[r]}
            </button>
          ))}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth remembering (optional)"
          className="w-full h-20 border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] resize-none mb-4" />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="text-[11px] font-bold tracking-[0.14em] uppercase px-3 py-2 text-stone-500">
            Cancel
          </button>
          <button type="button" disabled={pending || !reason} onClick={() => onConfirm(reason, note)}
            className="text-[11px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded text-white disabled:opacity-40"
            style={{ background: "var(--emrg-red)" }}>
            Mark lost
          </button>
        </div>
      </div>
    </div>
  );
}
