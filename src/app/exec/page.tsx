import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listOpportunities } from "@/lib/opportunities";
import { getSettings } from "@/lib/settings";
import { computeKpis, periodWindow, fmtPercent, type PeriodKey, type KpiInput } from "@/lib/kpi";
import { STAGE_LABELS } from "@/lib/constants";
import { fmtCents } from "@/lib/fee";
import { formatDuration } from "@/lib/time";
import SiteHeader from "@/components/SiteHeader";
import { StatCard } from "@/components/ui";

// Mario's private view (brief §21–24). requireAdmin() redirects anyone else,
// and it runs on the server, so the page never reaches a non-admin's browser.

export const dynamic = "force-dynamic";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "ytd", label: "YTD" },
  { key: "custom", label: "Custom" },
];

export default async function ExecPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const period = (PERIODS.some((p) => p.key === sp.period) ? sp.period : "month") as PeriodKey;

  const [rows, appSettings] = await Promise.all([listOpportunities(), getSettings()]);
  const now = new Date();
  const window = periodWindow(period, now, sp.from, sp.to);

  const input: KpiInput[] = rows.map((r) => ({
    id: r.id, stage: r.stage, ownerId: r.ownerId, ownerName: r.ownerName,
    valueCents: r.proposalValueCents,
    leadReceivedAt: r.leadReceivedAt, firstResponseAt: r.firstResponseAt,
    proposalGeneratedAt: r.proposalGeneratedAt, proposalSentAt: r.proposalSentAt,
    nextAction: r.nextAction, nextActionDate: r.nextActionDate,
    followupState: r.followupState, followupDueAt: r.followupDueAt,
    wonAt: r.wonAt, lostAt: r.lostAt,
  }));

  const k = computeKpis(input, window, {
    now, responseTargetMinutes: appSettings.responseTargetMinutes,
  });

  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const qs = (p: PeriodKey) => `/exec?period=${p}${sp.from ? `&from=${sp.from}` : ""}${sp.to ? `&to=${sp.to}` : ""}`;

  return (
    <div className="min-h-screen" style={{ background: "#f5f4f2" }}>
      <SiteHeader active="exec" user={user} />

      <div className="px-5 md:px-8 py-6 max-w-[1600px] mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "#111111" }}>
              Executive dashboard
            </h1>
            <p className="text-[13px] text-stone-500 mt-1">
              Only you can see this page.
            </p>
          </div>
          <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-lg p-1">
            {PERIODS.map((p) => (
              <Link key={p.key} href={qs(p.key)}
                className="px-3.5 py-1.5 text-[11px] font-bold tracking-[0.12em] uppercase rounded-md transition-colors"
                style={period === p.key
                  ? { background: "var(--emrg-black)", color: "#fff" }
                  : { color: "#78716c" }}>
                {p.label}
              </Link>
            ))}
          </div>
        </div>

        {period === "custom" && (
          <form method="get" action="/exec" className="bg-white border border-stone-200 rounded-lg p-3 mb-6 flex flex-wrap items-center gap-2">
            <input type="hidden" name="period" value="custom" />
            <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500">From</label>
            <input type="date" name="from" defaultValue={sp.from}
              className="border-2 border-stone-300 rounded-md px-2 py-1.5 text-[13px] bg-white" />
            <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500">To</label>
            <input type="date" name="to" defaultValue={sp.to}
              className="border-2 border-stone-300 rounded-md px-2 py-1.5 text-[13px] bg-white" />
            <button type="submit"
              className="text-[10px] font-bold tracking-[0.14em] uppercase px-3 py-1.5 rounded text-white"
              style={{ background: "var(--emrg-red)" }}>Apply</button>
          </form>
        )}

        {/* ── Right now ── */}
        <SectionHeading
          title="Right now"
          note="The current state of the business. Deliberately unaffected by the date filter." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Open pipeline" value={fmtCents(k.openPipelineCents)}
            sub={`${k.openCount} open opportunit${k.openCount === 1 ? "y" : "ies"}`} />
          <StatCard label="Stalled pipeline" value={fmtCents(k.stalledPipelineCents)}
            accent={k.stalledPipelineCents > 0 ? "amber" : undefined}
            sub="Proposals quiet 7+ days" />
          <StatCard label="Outside response target" value={String(k.leadsOutsideTarget)}
            accent={k.leadsOutsideTarget > 0 ? "red" : undefined}
            sub={`Target is ${appSettings.responseTargetMinutes} minutes`} />
          <StatCard label="No next action" value={String(k.noNextAction)}
            accent={k.noNextAction > 0 ? "amber" : undefined}
            sub={`${k.overdueFollowups} overdue follow-up${k.overdueFollowups === 1 ? "" : "s"}`} />
        </div>

        {/* ── Period ── */}
        <SectionHeading title={`This ${periodLabel}`} note="Things that happened in the selected window." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <StatCard label="New leads" value={String(k.newLeads)} />
          <StatCard label="Proposals generated" value={String(k.proposalsGenerated)} />
          <StatCard label="Proposals sent" value={String(k.proposalsSent)}
            sub={`${fmtCents(k.proposalValueSentCents)} of value`} />
          <StatCard label="Average proposal" value={k.avgProposalValueCents === null ? "—" : fmtCents(k.avgProposalValueCents)} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Won" value={fmtCents(k.wonCents)} accent="green"
            sub={`${k.wonCount} deal${k.wonCount === 1 ? "" : "s"}`} />
          <StatCard label="Lost" value={fmtCents(k.lostCents)}
            sub={`${k.lostCount} deal${k.lostCount === 1 ? "" : "s"}`} />
          <StatCard label="Win rate" value={fmtPercent(k.winRate)}
            accent={k.winRate !== null && k.winRate >= 0.5 ? "green" : undefined}
            sub="Of deals decided in the window" />
          <StatCard label="Answered in target" value={fmtPercent(k.answeredWithinTargetRate)}
            accent={k.answeredWithinTargetRate !== null && k.answeredWithinTargetRate < 0.8 ? "amber" : "green"}
            sub={`Within ${appSettings.responseTargetMinutes} minutes`} />
        </div>

        {/* ── Speed ── */}
        <SectionHeading title="Speed" note="How fast the team is moving, for leads in the window." />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          <StatCard label="Average speed to lead" value={formatDuration(k.avgSpeedToLeadMs)}
            sub="Lead received → first human response" />
          <StatCard label="Lead to proposal" value={formatDuration(k.avgLeadToProposalMs)}
            sub="Lead received → proposal generated" />
          <StatCard label="Proposal to close" value={formatDuration(k.avgProposalToCloseMs)}
            sub="Proposal sent → won or lost" />
        </div>

        {/* ── Breakdowns ── */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <Breakdown
            title="Pipeline by stage"
            rows={k.byStage.map((s) => ({
              label: STAGE_LABELS[s.stage], count: s.count, cents: s.cents,
            }))}
            total={k.openPipelineCents} />
          <Breakdown
            title="Pipeline by owner"
            rows={k.byOwner.map((o) => ({ label: o.ownerName, count: o.count, cents: o.cents }))}
            total={k.openPipelineCents} />
        </div>

        {/* ── Aging ── */}
        <SectionHeading title="Proposal aging" note="Open proposals, by how long since they were sent." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <StatCard label="0–3 days" value={String(k.proposalAging.d0_3)} />
          <StatCard label="4–7 days" value={String(k.proposalAging.d4_7)} />
          <StatCard label="8–14 days" value={String(k.proposalAging.d8_14)}
            accent={k.proposalAging.d8_14 > 0 ? "amber" : undefined} />
          <StatCard label="15+ days" value={String(k.proposalAging.d15plus)}
            accent={k.proposalAging.d15plus > 0 ? "red" : undefined} />
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[13px] font-bold tracking-[0.18em] uppercase" style={{ color: "#111111" }}>
        {title}
      </h2>
      <p className="text-[12px] text-stone-400 mt-0.5">{note}</p>
    </div>
  );
}

function Breakdown({ title, rows, total }: {
  title: string; rows: Array<{ label: string; count: number; cents: number }>; total: number;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-5">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "#111111" }}>
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-stone-400">Nothing open.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const pct = total > 0 ? (r.cents / total) * 100 : 0;
            return (
              <div key={r.label}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-[13px] text-stone-700 truncate">
                    {r.label} <span className="text-stone-400">({r.count})</span>
                  </span>
                  <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums">
                    {fmtCents(r.cents)}
                  </span>
                </div>
                <div className="h-[5px] rounded-full bg-stone-100 overflow-hidden">
                  <div className="h-full rounded-full"
                    style={{ width: `${Math.max(pct, r.count > 0 ? 1.5 : 0)}%`, background: "var(--emrg-red)" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
