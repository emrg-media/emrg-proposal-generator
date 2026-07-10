"use client";

import { useCallback, useEffect, useState } from "react";

// One-screen dashboard per Mario's spec: eight numbers + the full table.
// Status editable inline, pencil opens a full row editor, estimated fees
// (percentages / ranges) count toward the pipeline using averages until confirmed.

interface Proposal {
  id: string; proposalDate: string; preparedBy: string; client: string;
  company: string; email: string; event: string; eventDates: string;
  guests: string; venue: string; budget: string; fee: string;
  status: string; sentAt: string; followUp: string; notes: string;
}

const PENDING_STATUSES = ["generated", "sent", "viewed", "negotiating"];
const STATUS_OPTIONS = ["Generated", "Sent", "Viewed", "Negotiating", "Signed", "Lost"];

const AMBER = "#92600a";

// ── Fee math ─────────────────────────────────────────────────────────────────

function moneyValues(text: string): number[] {
  return [...text.matchAll(/\$?\s*([\d][\d,]*(?:\.\d+)?)\s*([kK])?/g)]
    .map((m) => parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1))
    .filter((n) => !isNaN(n) && n > 0);
}

function average(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function computeFee(fee: string, budget: string): { value: number | null; estimated: boolean; basis: string } {
  const f = (fee || "").trim();
  if (!f) return { value: null, estimated: false, basis: "No fee entered" };

  // "18-22%" is a range even though only the second number carries the % sign
  const pctRange = f.match(/([\d.]+)\s*[-–—]\s*([\d.]+)\s*%/);
  const pcts = pctRange
    ? [parseFloat(pctRange[1]), parseFloat(pctRange[2])]
    : [...f.matchAll(/([\d.]+)\s*%/g)].map((m) => parseFloat(m[1]));
  if (pcts.length > 0) {
    const pct = average(pcts)!;
    const budgetAvg = average(moneyValues(budget || ""));
    if (!budgetAvg) return { value: null, estimated: true, basis: `${f} of budget — no budget on file to estimate from` };
    return {
      value: Math.round((pct / 100) * budgetAvg),
      estimated: true,
      basis: `${pct}% of avg budget $${Math.round(budgetAvg).toLocaleString()}`,
    };
  }

  const amounts = moneyValues(f);
  if (amounts.length === 0) return { value: null, estimated: false, basis: "Unreadable fee" };
  if (amounts.length === 1) return { value: Math.round(amounts[0]), estimated: false, basis: "" };
  return { value: Math.round(average(amounts)!), estimated: true, basis: `average of ${f}` };
}

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday-start
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [savingId, setSavingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [editing, setEditing] = useState<Proposal | null>(null);

  const load = useCallback(() => {
    fetch("/api/proposals")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load");
        setProposals(body.proposals);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => { load(); }, [load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  }

  async function updateProposal(id: string, fields: Partial<Proposal>): Promise<boolean> {
    setSavingId(id);
    try {
      const res = await fetch("/api/proposals/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, fields }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Update failed");
      }
      setProposals((prev) => prev?.map((p) => p.id === id ? { ...p, ...fields } : p) ?? null);
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Update failed");
      load(); // re-sync with the sheet so stale rows disappear
      return false;
    } finally {
      setSavingId("");
    }
  }

  function openConfirm(p: Proposal, estimate: number | null) {
    setConfirmingId(p.id);
    setConfirmValue(estimate ? String(estimate) : "");
  }

  async function confirmFee(id: string) {
    const digits = confirmValue.replace(/[^\d]/g, "");
    if (!digits) return;
    const ok = await updateProposal(id, { fee: "$" + parseInt(digits, 10).toLocaleString("en-US") });
    if (ok) setConfirmingId("");
  }

  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  const parsed = (proposals ?? []).map((p) => ({
    ...p,
    date: p.proposalDate ? new Date(p.proposalDate) : null,
    followUpDate: p.followUp ? new Date(p.followUp) : null,
    statusLower: p.status.toLowerCase(),
    feeCalc: computeFee(p.fee, p.budget),
  }));

  const thisWeek = parsed.filter((p) => p.date && !isNaN(p.date.getTime()) && p.date >= weekStart).length;
  const thisMonth = parsed.filter((p) => p.date && !isNaN(p.date.getTime()) && p.date >= monthStart).length;
  const pending = parsed.filter((p) => PENDING_STATUSES.includes(p.statusLower));
  const won = parsed.filter((p) => p.statusLower === "signed");
  const lost = parsed.filter((p) => p.statusLower === "lost");

  const pipeline = pending.reduce((s, p) => s + (p.feeCalc.value ?? 0), 0);
  const closed = won.reduce((s, p) => s + (p.feeCalc.value ?? 0), 0);
  const pipelineEstimates = pending.filter((p) => p.feeCalc.estimated && p.feeCalc.value !== null).length;
  const closedEstimates = won.filter((p) => p.feeCalc.estimated && p.feeCalc.value !== null).length;
  const uncountable = pending.filter((p) => p.fee && p.feeCalc.value === null).length;

  const dueToday = parsed.filter((p) =>
    p.followUpDate && !isNaN(p.followUpDate.getTime()) &&
    p.followUpDate <= todayEnd &&
    PENDING_STATUSES.includes(p.statusLower)
  );

  const stats: Array<{ label: string; value: string; accent?: "red" | "green"; info?: string }> = [
    { label: "Proposals This Week", value: String(thisWeek) },
    { label: "Proposals This Month", value: String(thisMonth) },
    { label: "Pending", value: String(pending.length) },
    { label: "Won", value: String(won.length), accent: "green" },
    { label: "Lost", value: String(lost.length) },
    {
      label: "Revenue Pipeline", value: fmtMoney(pipeline),
      info: pipelineEstimates > 0 || uncountable > 0
        ? [
            pipelineEstimates > 0 ? `Includes ${pipelineEstimates} estimated fee${pipelineEstimates > 1 ? "s" : ""} (averages) pending confirmation — confirm them in the Fee column below.` : "",
            uncountable > 0 ? `${uncountable} proposal${uncountable > 1 ? "s" : ""} couldn't be estimated (percentage fee with no budget).` : "",
          ].filter(Boolean).join(" ")
        : undefined,
    },
    {
      label: "Revenue Closed", value: fmtMoney(closed), accent: "green",
      info: closedEstimates > 0 ? `Includes ${closedEstimates} estimated fee${closedEstimates > 1 ? "s" : ""} pending confirmation.` : undefined,
    },
    { label: "Follow-ups Due Today", value: String(dueToday.length), accent: dueToday.length > 0 ? "red" : undefined },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#f5f4f2" }}>
      <div style={{ height: 4, background: "var(--emrg-red)" }} />
      <SiteHeader active="dashboard" />

      <div className="px-10 py-8 max-w-[1400px] mx-auto">
        {error && (
          <p className="text-[14px] font-semibold mb-6" style={{ color: "var(--emrg-red)" }}>{error}</p>
        )}
        {!proposals && !error && (
          <p className="text-[14px] text-stone-500">Loading proposals…</p>
        )}

        {proposals && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
              {stats.map((s) => (
                <div key={s.label} className="bg-white border border-stone-200 rounded-lg px-5 py-4">
                  <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-stone-500 mb-1.5">{s.label}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-[30px] font-bold leading-none" style={{
                      color: s.accent === "green" ? "#15803d" : s.accent === "red" ? "var(--emrg-red)" : "#111111",
                      fontVariantNumeric: "tabular-nums",
                    }}>{s.value}</p>
                    {s.info && <InfoDot text={s.info} />}
                  </div>
                </div>
              ))}
            </div>

            {/* Full table — everything visible */}
            <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 1200 }}>
                <thead>
                  <tr style={{ background: "var(--emrg-black)" }} className="text-white">
                    {["Proposal ID","Date","Prepared By","Client","Company","Event","Event Date(s)","Guests","Venue","Fee","Status","Sent At","Follow-up","Notes",""].map((h, i) => (
                      <th key={i} className="text-left align-middle font-semibold px-3 py-2.5 text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.length === 0 && (
                    <tr><td colSpan={15} className="px-4 py-8 text-center text-stone-400">No proposals yet — generate one to see it here.</td></tr>
                  )}
                  {[...parsed].reverse().map((p) => {
                    const overdue = p.followUpDate && !isNaN(p.followUpDate.getTime()) &&
                      p.followUpDate <= todayEnd && PENDING_STATUSES.includes(p.statusLower);
                    return (
                      <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50" style={{ opacity: savingId === p.id ? 0.5 : 1 }}>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap font-mono text-[11.5px] text-stone-500">{p.id}</td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap text-stone-600">{p.date && !isNaN(p.date.getTime()) ? p.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : p.proposalDate}</td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap">{p.preparedBy}</td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap font-medium">{p.client}</td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap font-medium">{p.company}</td>
                        <td className="px-3 py-2.5 align-middle">{p.event}</td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap">{p.eventDates}</td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>{p.guests}</td>
                        <td className="px-3 py-2.5 align-middle">{p.venue}</td>

                        {/* Fee: exact, or estimate + info + confirm */}
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {!p.feeCalc.estimated ? (
                            <span className="font-semibold">{p.fee}</span>
                          ) : confirmingId === p.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <input autoFocus value={confirmValue}
                                onChange={(e) => setConfirmValue(e.target.value.replace(/[^\d]/g, ""))}
                                onKeyDown={(e) => { if (e.key === "Enter") confirmFee(p.id); if (e.key === "Escape") setConfirmingId(""); }}
                                className="w-24 border-2 border-stone-300 rounded px-2 py-1 text-[12.5px]" placeholder="12500" />
                              <button onClick={() => confirmFee(p.id)}
                                className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded text-white"
                                style={{ background: "var(--emrg-black)" }}>Save</button>
                              <button onClick={() => setConfirmingId("")} className="text-stone-400 text-[12px] px-1">✕</button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-semibold">{p.feeCalc.value !== null ? `≈ ${fmtMoney(p.feeCalc.value)}` : p.fee}</span>
                              <InfoDot text={`Estimated — pending confirmation. ${p.feeCalc.basis ? `Based on ${p.feeCalc.basis} (quoted: ${p.fee}).` : `Quoted: ${p.fee}.`} Click Confirm to lock in the real number.`} />
                              <button onClick={() => openConfirm(p, p.feeCalc.value)}
                                className="text-[10px] font-bold uppercase tracking-wide underline decoration-dotted"
                                style={{ color: AMBER }}>Confirm</button>
                            </span>
                          )}
                        </td>

                        {/* Status: inline editable, chip hugs the text */}
                        <td className="px-3 py-2.5 align-middle">
                          <StatusSelect status={p.status} disabled={savingId === p.id}
                            onChange={(s) => updateProposal(p.id, { status: s })} />
                        </td>

                        <td className="px-3 py-2.5 align-middle whitespace-nowrap text-stone-600">{p.sentAt ? new Date(p.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap font-medium" style={overdue ? { color: "var(--emrg-red)" } : undefined}>
                          {p.followUp}{overdue ? " ⚠" : ""}
                        </td>
                        <td className="px-3 py-2.5 align-middle max-w-[200px] truncate text-stone-600" title={p.notes}>{p.notes}</td>

                        {/* Pencil: edit everything */}
                        <td className="px-3 py-2.5 align-middle">
                          <button onClick={() => setEditing(p)} aria-label={`Edit ${p.id}`}
                            className="text-stone-400 hover:text-stone-800 transition-colors p-1">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                              <path d="M11.3 1.7a1.6 1.6 0 0 1 2.3 2.3l-8.3 8.3-3 .7.7-3 8.3-8.3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-stone-400 mt-3">
              Edits save straight to the tracker sheet. ≈ marks an estimated fee (average) — confirm it to lock in the real number.
            </p>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-lg text-white text-[13px] shadow-xl"
          style={{ background: "#1c1917" }}>
          {toast}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <EditModal proposal={editing} saving={savingId === editing.id}
          onClose={() => setEditing(null)}
          onSave={async (fields) => {
            const ok = await updateProposal(editing.id, fields);
            if (ok) setEditing(null);
          }} />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

export function SiteHeader({ active }: { active: "new" | "dashboard" }) {
  return (
    <header style={{ background: "var(--emrg-black)" }} className="text-white px-10 py-5 flex items-center relative">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold tracking-tight">EMRG</span>
        <span className="text-xl font-light tracking-[0.18em] text-white/50">MEDIA</span>
      </div>
      <nav className="ml-auto lg:ml-0 lg:absolute lg:left-1/2 lg:-translate-x-1/2 flex items-center gap-6 lg:gap-10">
        <a href="/" className="text-[11px] tracking-[0.22em] uppercase transition-colors pb-0.5"
          style={active === "new"
            ? { color: "#fff", borderBottom: "1px solid var(--emrg-red)" }
            : { color: "rgba(255,255,255,0.45)" }}>
          New Proposal
        </a>
        <a href="/dashboard" className="text-[11px] tracking-[0.22em] uppercase transition-colors pb-0.5"
          style={active === "dashboard"
            ? { color: "#fff", borderBottom: "1px solid var(--emrg-red)" }
            : { color: "rgba(255,255,255,0.45)" }}>
          Dashboard
        </a>
      </nav>
    </header>
  );
}

function InfoDot({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group cursor-help">
      <span className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[10px] font-bold border"
        style={{ color: AMBER, borderColor: AMBER }}>i</span>
      <span className="pointer-events-none absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-60 rounded-md px-3 py-2 text-[11.5px] leading-snug font-normal normal-case tracking-normal text-white shadow-lg"
        style={{ background: "#1c1917" }}>
        {text}
      </span>
    </span>
  );
}

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  generated: { background: "#f5f5f4", color: "#57534e" },
  sent: { background: "#111111", color: "#ffffff" },
  viewed: { background: "#dbeafe", color: "#1d4ed8" },
  negotiating: { background: "#fdf0d5", color: "#92600a" },
  signed: { background: "#dcf2dc", color: "#15803d" },
  lost: { background: "#e7e5e4", color: "#78716c" },
};

// Chip that hugs its text, with an invisible select layered on top for editing
function StatusSelect({ status, disabled, onChange }: { status: string; disabled: boolean; onChange: (s: string) => void }) {
  const style = STATUS_STYLES[status.toLowerCase()] ?? STATUS_STYLES.generated;
  return (
    <span className="relative inline-flex">
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
        style={style}>
        {status}
        <svg width="7" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
      </span>
      <select value={STATUS_OPTIONS.find((o) => o.toLowerCase() === status.toLowerCase()) ?? status}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        aria-label="Change status">
        {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        {!STATUS_OPTIONS.some((o) => o.toLowerCase() === status.toLowerCase()) && <option value={status}>{status}</option>}
      </select>
    </span>
  );
}

const EDIT_FIELDS: Array<{ key: keyof Proposal; label: string; wide?: boolean }> = [
  { key: "client", label: "Client" },
  { key: "company", label: "Company" },
  { key: "email", label: "Client Email", wide: true },
  { key: "event", label: "Event" },
  { key: "eventDates", label: "Event Date(s)" },
  { key: "guests", label: "Guest Count" },
  { key: "venue", label: "Venue" },
  { key: "budget", label: "Budget" },
  { key: "fee", label: "Fee" },
  { key: "preparedBy", label: "Prepared By" },
  { key: "followUp", label: "Next Follow-up" },
  { key: "notes", label: "Notes", wide: true },
];

function EditModal({ proposal, saving, onClose, onSave }: {
  proposal: Proposal; saving: boolean;
  onClose: () => void; onSave: (fields: Partial<Proposal>) => void;
}) {
  const [form, setForm] = useState<Partial<Proposal>>(() => {
    const f: Partial<Proposal> = {};
    for (const { key } of EDIT_FIELDS) f[key] = proposal[key];
    f.status = proposal.status;
    return f;
  });

  function set(key: keyof Proposal, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function changedFields(): Partial<Proposal> {
    const out: Partial<Proposal> = {};
    for (const key of Object.keys(form) as Array<keyof Proposal>) {
      if (form[key] !== proposal[key]) out[key] = form[key];
    }
    return out;
  }

  const changes = changedFields();

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-6"
      style={{ background: "rgba(20,18,16,0.55)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-7 py-5 border-b border-stone-200 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "#111111" }}>
              Edit Proposal
            </p>
            <p className="text-[12px] text-stone-500 mt-0.5 font-mono">{proposal.id}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none px-1" aria-label="Close">×</button>
        </div>
        <div className="px-7 py-5 overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {EDIT_FIELDS.map(({ key, label, wide }) => (
              <div key={key} className={wide ? "col-span-2" : ""}>
                <label className="block text-[10px] font-bold tracking-[0.18em] uppercase mb-1" style={{ color: "#111111" }}>{label}</label>
                <input type="text" value={(form[key] as string) ?? ""} onChange={(e) => set(key, e.target.value)}
                  className="w-full border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white text-stone-900" />
              </div>
            ))}
            <div>
              <label className="block text-[10px] font-bold tracking-[0.18em] uppercase mb-1" style={{ color: "#111111" }}>Status</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value)}
                className="w-full border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white text-stone-900">
                {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="px-7 py-4 border-t border-stone-200 flex justify-end gap-3">
          <button onClick={onClose}
            className="px-5 py-2.5 text-[13px] font-bold tracking-wider uppercase rounded-md border-2 border-stone-300 text-stone-600">
            Cancel
          </button>
          <button onClick={() => onSave(changes)} disabled={saving || Object.keys(changes).length === 0}
            className="px-6 py-2.5 text-[13px] font-bold tracking-wider uppercase rounded-md text-white disabled:opacity-40"
            style={{ background: "var(--emrg-red)" }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
