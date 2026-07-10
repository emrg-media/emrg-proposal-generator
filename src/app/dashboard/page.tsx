"use client";

import { useEffect, useState } from "react";

// One-screen dashboard per Mario's spec: eight numbers + the full table.
// No searching — everything visible.

interface Proposal {
  id: string; proposalDate: string; preparedBy: string; client: string;
  company: string; email: string; event: string; eventDates: string;
  guests: string; venue: string; budget: string; fee: string;
  status: string; sentAt: string; followUp: string; notes: string;
}

const PENDING_STATUSES = ["generated", "sent", "viewed", "negotiating"];

function feeToNumber(fee: string): number | null {
  if (!fee || fee.includes("%")) return null; // percentage fees can't be summed
  const digits = fee.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday-start
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function DashboardPage() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/proposals")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load");
        setProposals(body.proposals);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  const rows = proposals ?? [];
  const parsed = rows.map((p) => ({
    ...p,
    date: p.proposalDate ? new Date(p.proposalDate) : null,
    followUpDate: p.followUp ? new Date(p.followUp) : null,
    statusLower: p.status.toLowerCase(),
    feeNum: feeToNumber(p.fee),
  }));

  const thisWeek = parsed.filter((p) => p.date && !isNaN(p.date.getTime()) && p.date >= weekStart).length;
  const thisMonth = parsed.filter((p) => p.date && !isNaN(p.date.getTime()) && p.date >= monthStart).length;
  const pending = parsed.filter((p) => PENDING_STATUSES.includes(p.statusLower));
  const won = parsed.filter((p) => p.statusLower === "signed");
  const lost = parsed.filter((p) => p.statusLower === "lost");
  const pipeline = pending.reduce((s, p) => s + (p.feeNum ?? 0), 0);
  const closed = won.reduce((s, p) => s + (p.feeNum ?? 0), 0);
  const pctFeesPending = pending.filter((p) => p.fee.includes("%")).length;
  const dueToday = parsed.filter((p) =>
    p.followUpDate && !isNaN(p.followUpDate.getTime()) &&
    p.followUpDate <= todayEnd &&
    PENDING_STATUSES.includes(p.statusLower)
  );

  const stats: Array<{ label: string; value: string; accent?: "red" | "green" | "amber"; hint?: string }> = [
    { label: "Proposals This Week", value: String(thisWeek) },
    { label: "Proposals This Month", value: String(thisMonth) },
    { label: "Pending", value: String(pending.length) },
    { label: "Won", value: String(won.length), accent: "green" },
    { label: "Lost", value: String(lost.length) },
    { label: "Revenue Pipeline", value: fmtMoney(pipeline), hint: pctFeesPending > 0 ? `+ ${pctFeesPending} percentage-fee proposal${pctFeesPending > 1 ? "s" : ""} not counted` : undefined },
    { label: "Revenue Closed", value: fmtMoney(closed), accent: "green" },
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
                  <p className="text-[30px] font-bold leading-none" style={{
                    color: s.accent === "green" ? "#15803d" : s.accent === "red" ? "var(--emrg-red)" : "#111111",
                    fontVariantNumeric: "tabular-nums",
                  }}>{s.value}</p>
                  {s.hint && <p className="text-[10.5px] text-stone-400 mt-1.5">{s.hint}</p>}
                </div>
              ))}
            </div>

            {/* Full table — everything visible */}
            <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 1100 }}>
                <thead>
                  <tr style={{ background: "var(--emrg-black)" }} className="text-white">
                    {["Proposal ID","Date","Prepared By","Client","Company","Event","Event Date(s)","Guests","Venue","Fee","Status","Sent At","Follow-up","Notes"].map((h) => (
                      <th key={h} className="text-left font-semibold px-3 py-2.5 text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap">{h}</th>
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
                      <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2.5 whitespace-nowrap font-mono text-[11.5px] text-stone-500">{p.id}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-stone-600">{p.date && !isNaN(p.date.getTime()) ? p.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : p.proposalDate}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{p.preparedBy}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-medium">{p.client}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-medium">{p.company}</td>
                        <td className="px-3 py-2.5">{p.event}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{p.eventDates}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>{p.guests}</td>
                        <td className="px-3 py-2.5">{p.venue}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{p.fee}</td>
                        <td className="px-3 py-2.5"><StatusChip status={p.status} /></td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-stone-600">{p.sentAt ? new Date(p.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-medium" style={overdue ? { color: "var(--emrg-red)" } : undefined}>
                          {p.followUp}{overdue ? " ⚠" : ""}
                        </td>
                        <td className="px-3 py-2.5 max-w-[220px] truncate text-stone-600" title={p.notes}>{p.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const s = status.toLowerCase();
  const style =
    s === "signed" ? { background: "#dcf2dc", color: "#15803d" } :
    s === "lost" ? { background: "#e7e5e4", color: "#78716c", textDecoration: "line-through" as const } :
    s === "sent" ? { background: "#111111", color: "#ffffff" } :
    s === "negotiating" || s === "viewed" ? { background: "#fdf0d5", color: "#92600a" } :
    { background: "#f5f5f4", color: "#57534e" }; // Generated
  return (
    <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide whitespace-nowrap" style={style}>
      {status}
    </span>
  );
}
