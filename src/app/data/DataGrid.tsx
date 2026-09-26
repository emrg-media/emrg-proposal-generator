"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { STAGES, STAGE_LABELS } from "@/lib/constants";
import { fmtCents } from "@/lib/fee";
import { fmtDate } from "@/lib/time";
import { StageChip } from "@/components/ui";

// The spreadsheet view (brief §9): search, sort, filter by owner / stage /
// period, and export the lot. Filtering happens in the browser — the whole
// table is a few hundred rows at most, so this stays instant and avoids a
// round trip on every keystroke.

export interface GridRow {
  id: string; code: string; createdAt: string; leadReceivedAt: string;
  stage: string; company: string; contact: string; email: string;
  eventName: string; eventDate: string; guestCount: string; venue: string;
  feeRaw: string; valueCents: number | null; valueEstimated: boolean;
  ownerName: string | null; collaborators: string;
  speedMins: number | null; proposalSentAt: string | null;
  lastActivityAt: string; nextAction: string;
}

type SortKey = "leadReceivedAt" | "company" | "stage" | "valueCents" | "ownerName" | "lastActivityAt" | "speedMins";
type Period = "all" | "week" | "month" | "ytd" | "custom";

const COLUMNS: Array<{ key: SortKey | null; label: string; align?: "right" }> = [
  { key: "leadReceivedAt", label: "Lead date" },
  { key: "company", label: "Company" },
  { key: null, label: "Contact" },
  { key: null, label: "Event" },
  { key: null, label: "Event date" },
  { key: "stage", label: "Stage" },
  { key: "valueCents", label: "Value", align: "right" },
  { key: "ownerName", label: "Owner" },
  { key: "speedMins", label: "Speed", align: "right" },
  { key: "lastActivityAt", label: "Last activity" },
];

export default function DataGrid({ rows, owners }: { rows: GridRow[]; owners: string[] }) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortKey>("leadReceivedAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const { start, end } = periodRange(period, from, to);

    const out = rows.filter((r) => {
      if (stage && r.stage !== stage) return false;
      if (owner && r.ownerName !== owner) return false;
      if (start || end) {
        // Filter on when the lead actually arrived, not when the row was
        // inserted — that is the date the team reasons about.
        const t = new Date(r.leadReceivedAt).getTime();
        if (start && t < start) return false;
        if (end && t > end) return false;
      }
      if (!q) return true;
      return [r.company, r.contact, r.email, r.eventName, r.venue, r.code, r.ownerName, r.nextAction]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });

    const factor = dir === "asc" ? 1 : -1;
    return out.sort((a, b) => {
      const av = a[sort], bv = b[sort];
      // Nulls always sort last, whichever direction is active.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, query, stage, owner, period, from, to, sort, dir]);

  const totalValue = filtered.reduce((s, r) => s + (r.valueCents ?? 0), 0);

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDir("desc"); }
  }

  return (
    <div className="px-5 md:px-8 py-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--ink)" }}>Data</h1>
          {/* Mirrors the line on /proposals on purpose. The two screens share
              four columns, so without stating the grain they read as duplicates. */}
          <p className="text-[13px] text-ink3 mt-1">
            One row per opportunity, however many proposals it has taken.
          </p>
          <p className="text-[12.5px] text-ink3 mt-0.5">
            {filtered.length} of {rows.length} opportunities
            {totalValue > 0 && <> · {fmtCents(totalValue)} total</>}
          </p>
        </div>
        <a href="/api/export" download
          className="text-[11px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded border-2"
          style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)", background: "var(--raised)" }}>
          Export CSV
        </a>
      </div>

      <div className="bg-raised border border-line rounded-lg p-3 mb-4 flex flex-wrap items-center gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company, contact, email, event, venue…"
          className="flex-1 min-w-[220px] border-2 border-line-strong rounded-md px-3 py-1.5 text-[13.5px] bg-raised" />

        <select value={stage} onChange={(e) => setStage(e.target.value)}
          className="border-2 border-line-strong rounded-md px-2.5 py-1.5 text-[13px] bg-raised">
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>

        <select value={owner} onChange={(e) => setOwner(e.target.value)}
          className="border-2 border-line-strong rounded-md px-2.5 py-1.5 text-[13px] bg-raised">
          <option value="">All owners</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>

        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}
          className="border-2 border-line-strong rounded-md px-2.5 py-1.5 text-[13px] bg-raised">
          <option value="all">All time</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="ytd">Year to date</option>
          <option value="custom">Custom…</option>
        </select>

        {period === "custom" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border-2 border-line-strong rounded-md px-2 py-1.5 text-[13px] bg-raised" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border-2 border-line-strong rounded-md px-2 py-1.5 text-[13px] bg-raised" />
          </>
        )}

        {(query || stage || owner || period !== "all") && (
          <button type="button"
            onClick={() => { setQuery(""); setStage(""); setOwner(""); setPeriod("all"); setFrom(""); setTo(""); }}
            className="text-[11px] font-bold tracking-[0.1em] uppercase px-2.5 py-1.5"
            style={{ color: "var(--accent)" }}>
            Clear
          </button>
        )}
      </div>

      <div className="bg-raised border border-line rounded-lg overflow-x-auto">
        <table className="w-full text-[13px]" style={{ minWidth: 1100 }}>
          <thead>
            <tr style={{ background: "var(--header-bg)" }} className="text-white">
              {COLUMNS.map((c) => (
                <th key={c.label}
                  onClick={() => c.key && toggleSort(c.key)}
                  className={`text-left align-middle font-semibold px-3 py-2.5 text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap ${c.key ? "cursor-pointer select-none" : ""} ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                  {sort === c.key && <span className="ml-1 opacity-70">{dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-ink3">
                {rows.length === 0
                  ? "No opportunities yet. They appear here as soon as the first proposal is generated."
                  : "Nothing matches those filters."}
              </td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-sunken">
                <td className="px-3 py-2.5 whitespace-nowrap text-ink3">{fmtDate(r.leadReceivedAt)}</td>
                <td className="px-3 py-2.5 font-medium">
                  <Link href={`/opportunity/${r.id}`} className="hover:underline">
                    {r.company || "Untitled"}
                  </Link>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.contact || ""}</td>
                <td className="px-3 py-2.5">{r.eventName || ""}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink2">{r.eventDate || ""}</td>
                <td className="px-3 py-2.5"><StageChip stage={r.stage} label={STAGE_LABELS[r.stage as keyof typeof STAGE_LABELS] ?? r.stage} /></td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {r.valueCents === null ? (r.feeRaw || "") : (r.valueEstimated ? "≈ " : "") + fmtCents(r.valueCents)}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.ownerName ?? <span style={{ color: "var(--accent)" }}>Unassigned</span>}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-ink2">
                  {r.speedMins === null ? "" : `${r.speedMins}m`}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink3">{fmtDate(r.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Start/end epoch bounds for the selected period. */
function periodRange(period: Period, from: string, to: string): { start: number | null; end: number | null } {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // Monday start
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return { start: d.getTime(), end: null };
  }
  if (period === "month") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: null };
  }
  if (period === "ytd") {
    return { start: new Date(now.getFullYear(), 0, 1).getTime(), end: null };
  }
  if (period === "custom") {
    return {
      start: from ? new Date(`${from}T00:00:00`).getTime() : null,
      // Inclusive of the whole end day.
      end: to ? new Date(`${to}T23:59:59.999`).getTime() : null,
    };
  }
  return { start: null, end: null };
}
