import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listOpportunities } from "@/lib/opportunities";
import { getSettings } from "@/lib/settings";
import { computeKpis, periodWindow, fmtPercent, type PeriodKey, type KpiInput } from "@/lib/kpi";
import { STAGE_LABELS } from "@/lib/constants";
import { fmtCents } from "@/lib/fee";
import { formatDuration } from "@/lib/time";
import SiteHeader from "@/components/SiteHeader";
import SampleDataBanner from "@/components/SampleDataBanner";
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
    <div className="min-h-screen" style={{ background: "var(--surface)" }}>
      <SiteHeader active="exec" user={user} />
      <SampleDataBanner />

      <div className="px-5 md:px-8 py-6 max-w-[1600px] mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--ink)" }}>
              Executive dashboard
            </h1>
            <p className="text-[13px] text-ink3 mt-1">
              Only you can see this page.
            </p>
          </div>
          <div className="flex items-center gap-1 bg-raised border border-line rounded-lg p-1">
            {PERIODS.map((p) => (
              <Link key={p.key} href={qs(p.key)}
                className="px-3.5 py-1.5 text-[11px] font-bold tracking-[0.12em] uppercase rounded-md transition-colors"
                style={period === p.key
                  ? { background: "var(--header-bg)", color: "var(--header-ink)" }
                  : { color: "var(--ink-3)" }}>
                {p.label}
              </Link>
            ))}
          </div>
        </div>

        {period === "custom" && (
          <form method="get" action="/exec" className="bg-raised border border-line rounded-lg p-3 mb-6 flex flex-wrap items-center gap-2">
            <input type="hidden" name="period" value="custom" />
            <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-ink3">From</label>
            <input type="date" name="from" defaultValue={sp.from}
              className="border-2 border-line-strong rounded-md px-2 py-1.5 text-[13px] bg-raised" />
            <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-ink3">To</label>
            <input type="date" name="to" defaultValue={sp.to}
              className="border-2 border-line-strong rounded-md px-2 py-1.5 text-[13px] bg-raised" />
            <button type="submit"
              className="text-[10px] font-bold tracking-[0.14em] uppercase px-3 py-1.5 rounded"
              
style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Apply</button>
          </form>
        )}

        {rows.length === 0 && (
          <div className="bg-raised border border-line rounded-lg px-5 py-4 mb-6">
            <p className="text-[13px] text-ink2">
              Every figure below reads zero because there is no data yet, not because the business stalled.
            </p>
            <p className="text-[12.5px] text-ink3 mt-1">
              The dashboard fills in on its own as the team generates proposals and moves deals through the pipeline.
            </p>
          </div>
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
            trend={k.openPipelineCents > 0 ? k.stalledPipelineCents / k.openPipelineCents : 0}
            sub={k.openPipelineCents > 0
              ? `${Math.round((k.stalledPipelineCents / k.openPipelineCents) * 100)}% of open pipeline, quiet 7+ days`
              : "Proposals quiet 7+ days"} />
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
          <StatCard label="Average proposal" value={k.avgProposalValueCents === null ? "None yet" : fmtCents(k.avgProposalValueCents)} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Won" value={fmtCents(k.wonCents)} accent="green"
            sub={`${k.wonCount} deal${k.wonCount === 1 ? "" : "s"}`} />
          <StatCard label="Lost" value={fmtCents(k.lostCents)}
            sub={`${k.lostCount} deal${k.lostCount === 1 ? "" : "s"}`} />
          <StatCard label="Win rate" value={fmtPercent(k.winRate)}
            accent={k.winRate !== null && k.winRate >= 0.5 ? "green" : undefined}
            trend={k.winRate ?? 0}
            sub={`${k.wonCount} won, ${k.lostCount} lost in the window`} />
          <StatCard label="Answered in target" value={fmtPercent(k.answeredWithinTargetRate)}
            accent={k.answeredWithinTargetRate !== null && k.answeredWithinTargetRate < 0.8 ? "amber" : "green"}
            trend={k.answeredWithinTargetRate ?? 0}
            sub={`Within ${appSettings.responseTargetMinutes} minutes of the lead arriving`} />
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
        <AgingBar aging={k.proposalAging} />
      </div>
    </div>
  );
}

/**
 * The aging buckets as one bar rather than four separate numbers.
 *
 * Four counts require holding them in your head to compare; a single bar shows
 * at a glance whether the weight is sitting in the healthy end or the old end,
 * which is the only question worth asking of this data.
 */
function AgingBar({ aging }: { aging: { d0_3: number; d4_7: number; d8_14: number; d15plus: number } }) {
  const buckets = [
    { label: "0 to 3 days", n: aging.d0_3, color: "var(--good)" },
    { label: "4 to 7 days", n: aging.d4_7, color: "#0d9488" },
    { label: "8 to 14 days", n: aging.d8_14, color: "var(--warn)" },
    { label: "15+ days", n: aging.d15plus, color: "var(--accent)" },
  ];
  const total = buckets.reduce((s, b) => s + b.n, 0);

  return (
    <div className="bg-raised border border-line rounded-lg px-5 py-4 mb-10">
      {total === 0 ? (
        <p className="text-[13px] text-ink3">No proposals are currently waiting on a client.</p>
      ) : (
        <>
          <div className="flex h-[10px] rounded-full overflow-hidden mb-3" style={{ background: "var(--sunken)" }}>
            {buckets.map((b) => b.n > 0 && (
              <div key={b.label} title={`${b.label}: ${b.n}`}
                style={{ width: `${(b.n / total) * 100}%`, background: b.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="w-[9px] h-[9px] rounded-sm flex-shrink-0" style={{ background: b.color }} />
                <span className="text-[12.5px] text-ink2">{b.label}</span>
                <span className="text-[13px] font-bold tabular-nums"
                  style={{ color: b.n > 0 ? "var(--ink)" : "var(--ink-3)" }}>{b.n}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[13px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--ink)" }}>
        {title}
      </h2>
      <p className="text-[12px] text-ink3 mt-0.5">{note}</p>
    </div>
  );
}

function Breakdown({ title, rows, total }: {
  title: string; rows: Array<{ label: string; count: number; cents: number }>; total: number;
}) {
  return (
    <div className="bg-raised border border-line rounded-lg p-5">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "var(--ink)" }}>
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink3">Nothing open.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const pct = total > 0 ? (r.cents / total) * 100 : 0;
            return (
              <div key={r.label}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-[13px] text-ink2 truncate">
                    {r.label} <span className="text-ink3">({r.count})</span>
                  </span>
                  <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums">
                    {fmtCents(r.cents)}
                  </span>
                </div>
                <div className="h-[5px] rounded-full bg-sunken overflow-hidden">
                  <div className="h-full rounded-full"
                    style={{ width: `${Math.max(pct, r.count > 0 ? 1.5 : 0)}%`, background: "var(--accent)" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
