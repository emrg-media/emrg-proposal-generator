import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listOpportunities } from "@/lib/opportunities";
import { LOST_REASON_LABELS, LOST_REASONS } from "@/lib/constants";
import { fmtCents } from "@/lib/fee";
import { fmtDate, formatDuration } from "@/lib/time";
import SiteHeader from "@/components/SiteHeader";
import SampleDataBanner from "@/components/SampleDataBanner";
import { EmptyState, StatCard, OwnerBadge } from "@/components/ui";

// Won and lost, side by side. Nothing is ever deleted (brief §18) — the lost
// column and its reasons are the raw material for the nurture work later.

export const dynamic = "force-dynamic";

export default async function ClosedPage() {
  const user = await requireUser();
  const rows = await listOpportunities({ stages: ["won", "lost"] });

  const won = rows.filter((r) => r.stage === "won")
    .sort((a, b) => (b.wonAt?.getTime() ?? 0) - (a.wonAt?.getTime() ?? 0));
  const lost = rows.filter((r) => r.stage === "lost")
    .sort((a, b) => (b.lostAt?.getTime() ?? 0) - (a.lostAt?.getTime() ?? 0));

  const wonCents = won.reduce((s, r) => s + (r.proposalValueCents ?? 0), 0);
  const lostCents = lost.reduce((s, r) => s + (r.proposalValueCents ?? 0), 0);
  const decided = won.length + lost.length;
  const winRate = decided ? Math.round((won.length / decided) * 100) : null;

  // Lost reasons, most common first — the thing worth acting on.
  const reasonCounts = LOST_REASONS
    .map((reason) => ({ reason, count: lost.filter((r) => r.lostReason === reason).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="min-h-screen" style={{ background: "#f5f4f2" }}>
      <SiteHeader active="closed" user={user} />
      <SampleDataBanner />

      <div className="px-5 md:px-8 py-6 max-w-[1600px] mx-auto">
        <h1 className="text-[22px] font-bold tracking-tight mb-1" style={{ color: "#111111" }}>Won / Lost</h1>
        <p className="text-[13px] text-stone-500 mb-5">
          The complete history. Nothing here is ever deleted.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Won" value={fmtCents(wonCents)} accent="green"
            sub={`${won.length} deal${won.length === 1 ? "" : "s"}`} />
          <StatCard label="Lost" value={fmtCents(lostCents)}
            sub={`${lost.length} deal${lost.length === 1 ? "" : "s"}`} />
          <StatCard label="Win rate" value={winRate === null ? "" : `${winRate}%`}
            accent={winRate !== null && winRate >= 50 ? "green" : undefined}
            sub="Of everything decided" />
          <StatCard label="Top lost reason"
            value={reasonCounts[0] ? String(reasonCounts[0].count) : ""}
            sub={reasonCounts[0] ? LOST_REASON_LABELS[reasonCounts[0].reason] : "Nothing lost yet"} />
        </div>

        {reasonCounts.length > 0 && (
          <div className="bg-white border border-stone-200 rounded-lg p-4 mb-6">
            <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-3" style={{ color: "#111111" }}>
              Why we lost
            </p>
            <div className="flex flex-wrap gap-2">
              {reasonCounts.map(({ reason, count }) => (
                <span key={reason}
                  className="px-3 py-1.5 rounded text-[12.5px] border border-stone-200 bg-stone-50 text-stone-700">
                  {LOST_REASON_LABELS[reason]} <span className="font-bold ml-1">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {decided === 0 ? (
          <EmptyState title="Nothing closed yet."
            hint="Deals marked won or lost will be kept here permanently." />
        ) : (
          <div className="grid lg:grid-cols-2 gap-6">
            <Column title={`Won (${won.length})`} tone="green" rows={won} />
            <Column title={`Lost (${lost.length})`} tone="grey" rows={lost} />
          </div>
        )}
      </div>
    </div>
  );
}

function Column({ title, tone, rows }: {
  title: string; tone: "green" | "grey";
  rows: Awaited<ReturnType<typeof listOpportunities>>;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase"
          style={{ color: tone === "green" ? "#15803d" : "#57534e" }}>
          {title}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-[13px] text-stone-400 text-center">Nothing here.</p>
      ) : (
        <div>
          {rows.map((r) => {
            const closedAt = r.wonAt ?? r.lostAt;
            const cycleMs = closedAt ? closedAt.getTime() - r.leadReceivedAt.getTime() : null;
            return (
              <Link key={r.id} href={`/opportunity/${r.id}`}
                className="flex items-center gap-3 px-5 py-3 border-t border-stone-100 first:border-t-0 hover:bg-stone-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-stone-900 truncate">
                    {r.company || "Untitled"}
                  </p>
                  <p className="text-[11.5px] text-stone-500 truncate">
                    {[r.eventName, fmtDate(closedAt), cycleMs ? `${formatDuration(cycleMs)} cycle` : ""]
                      .filter(Boolean).join(" · ")}
                  </p>
                  {r.stage === "lost" && r.lostReason && (
                    <p className="text-[11.5px] mt-0.5" style={{ color: "#92600a" }}>
                      {LOST_REASON_LABELS[r.lostReason]}
                      {r.lostNote ? `. ${r.lostNote}` : ""}
                    </p>
                  )}
                </div>
                <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums"
                  style={{ color: tone === "green" ? "#15803d" : "#57534e" }}>
                  {r.proposalValueCents ? fmtCents(r.proposalValueCents) : ""}
                </span>
                <span className="hidden sm:block w-[100px] text-right">
                  <OwnerBadge name={r.ownerName} color={r.ownerColor} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
