"use client";

import { useCallback, useEffect, useState } from "react";

// One-screen dashboard per Mario's spec: eight numbers + the full table.
// Status is editable inline; estimated fees (percentages / ranges) count toward
// the pipeline using averages, flagged with an info tooltip until confirmed.

interface Proposal {
  id: string; proposalDate: string; preparedBy: string; client: string;
  company: string; email: string; event: string; eventDates: string;
  guests: string; venue: string; budget: string; fee: string;
  status: string; sentAt: string; followUp: string; notes: string;
}

const PENDING_STATUSES = ["generated", "sent", "viewed", "negotiating"];
const STATUS_OPTIONS = ["Generated", "Sent", "Viewed", "Negotiating", "Signed", "Lost"];

// ── Fee math ─────────────────────────────────────────────────────────────────
// Exact:      "$12,500"            → 12500
// $ range:    "$12,000 – $15,000"  → average, estimated
// Percent:    "15%"                → 15% × budget average, estimated
// Pct range:  "18-22%"             → average pct × budget average, estimated

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

  const pcts = [...f.matchAll(/([\d.]+)\s*%/g)].map((m) => parseFloat(m[1]));
  if (pcts.length > 0) {
    const pct = average(pcts)!;
    const budgetAvg = average(moneyValues(budget || ""));
    if (!budgetAvg) return { value: null, estimated: true, basis: `${f} of budget — no budget on file to estimate from` };
    return {
      value: Math.round((pct / 100) * budgetAvg),
      estimated: true,
      basis: `${pcts.length > 1 ? `avg ${pct}%` : `${pct}%`} of ${pcts.length > 1 ? "" : ""}avg budget $${Math.round(budgetAvg).toLocaleString()}`,
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
  const [savingId, setSavingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [confirmValue, setConfirmValue] = useState("");

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

  async function updateProposal(id: string, patch: { status?: string; fee?: string }) {
    setSavingId(id);
    try {
      const res = await fetch("/api/proposals/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Update failed");
      }
      setProposals((prev) => prev?.map((p) => p.id === id ? { ...p, ...patch } as Proposal : p) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
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
    await updateProposal(id, { fee: "$" + parseInt(digits, 10).toLocaleString("en-US") });
    setConfirmingId("");
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
      <header style={{ background: "var(--emrg-black)" }} className="text-white px-10 py-5 flex items-center">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight">EMRG</span>
          <span className="text-xl font-light tracking-[0.18em] text-white/50">MEDIA</span>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <a href="/" className="text-[11px] tracking-[0.18em] uppercase text-white/60 hover:text-white transition-colors">
            + New Proposal
          </a>
          <span className="text-[9px] tracking-[0.22em] uppercase text-white/25">Dashboard</span>
        </div>
      </header>

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
              <table className="w-full text-[13px]" style={{ minWidth: 1150 }}>
                <thead>
                  <tr style={{ background: "var(--emrg-black)" }} className="text-white">
                    {["Proposal ID","Date","Prepared By","Client","Company","Event","Event Date(s)","Guests","Venue","Fee","Status","Sent At","Follow-up","Notes"].map((h) => (
                      <th key={h} className="text-left align-middle font-semibold px-3 py-2.5 text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.length === 0 && (
                    <tr><td colSpan={14} className="px-4 py-8 text-center text-stone-400">No proposals yet — generate one to see it here.</td></tr>
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
                                className="w-24 border-2 border-stone-400 rounded px-2 py-1 text-[12.5px]" placeholder="12500" />
                              <button onClick={() => confirmFee(p.id)}
                                className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded text-white"
                                style={{ background: "var(--emrg-red)" }}>Confirm</button>
                              <button onClick={() => setConfirmingId("")} className="text-stone-400 text-[12px] px-1">✕</button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-semibold">{p.feeCalc.value !== null ? `≈ ${fmtMoney(p.feeCalc.value)}` : p.fee}</span>
                              <InfoDot text={`Estimated — pending confirmation. ${p.feeCalc.basis ? `Based on ${p.feeCalc.basis} (quoted: ${p.fee}).` : `Quoted: ${p.fee}.`} Click Confirm to lock in the real number.`} />
                              <button onClick={() => openConfirm(p, p.feeCalc.value)}
                                className="text-[10px] font-bold uppercase tracking-wide underline decoration-dotted"
                                style={{ color: "var(--emrg-red)" }}>Confirm</button>
                            </span>
                          )}
                        </td>

                        {/* Status: inline editable */}
                        <td className="px-3 py-2.5 align-middle">
                          <StatusSelect status={p.status} disabled={savingId === p.id}
                            onChange={(s) => updateProposal(p.id, { status: s })} />
                        </td>

                        <td className="px-3 py-2.5 align-middle whitespace-nowrap text-stone-600">{p.sentAt ? new Date(p.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap font-medium" style={overdue ? { color: "var(--emrg-red)" } : undefined}>
                          {p.followUp}{overdue ? " ⚠" : ""}
                        </td>
                        <td className="px-3 py-2.5 align-middle max-w-[220px] truncate text-stone-600" title={p.notes}>{p.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-stone-400 mt-3">
              Status and fee edits save straight to the tracker sheet. ≈ marks an estimated fee (average) — confirm it to lock in the real number.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoDot({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group cursor-help">
      <span className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[10px] font-bold border"
        style={{ color: "var(--emrg-red)", borderColor: "var(--emrg-red)" }}>i</span>
      <span className="pointer-events-none absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-60 rounded-md px-3 py-2 text-[11.5px] leading-snug font-normal normal-case tracking-normal text-white shadow-lg"
        style={{ background: "#1c1917" }}>
        {text}
      </span>
    </span>
  );
}

function StatusSelect({ status, disabled, onChange }: { status: string; disabled: boolean; onChange: (s: string) => void }) {
  const s = status.toLowerCase();
  const style =
    s === "signed" ? { background: "#dcf2dc", color: "#15803d" } :
    s === "lost" ? { background: "#e7e5e4", color: "#78716c" } :
    s === "sent" ? { background: "#111111", color: "#ffffff" } :
    s === "negotiating" || s === "viewed" ? { background: "#fdf0d5", color: "#92600a" } :
    { background: "#f5f5f4", color: "#57534e" };
  return (
    <select value={STATUS_OPTIONS.find((o) => o.toLowerCase() === s) ?? status} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide cursor-pointer border-0 appearance-none"
      style={style}>
      {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
      {!STATUS_OPTIONS.some((o) => o.toLowerCase() === s) && <option value={status}>{status}</option>}
    </select>
  );
}
