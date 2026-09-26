import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listOpportunities, toAttentionInput } from "@/lib/opportunities";
import { getSettings } from "@/lib/settings";
import {
  buildAttentionList, attentionCounts, groupAttention, totalValueAtStake,
  type AttentionKind, type AttentionGroup,
} from "@/lib/attention";
import { fmtCents } from "@/lib/fee";
import SiteHeader from "@/components/SiteHeader";
import SampleDataBanner from "@/components/SampleDataBanner";
import { EmptyState, OwnerBadge, StatCard } from "@/components/ui";

// Wow feature #1 (brief §14). Nobody should have to read the whole pipeline to
// work out what to do — this page opens with the answer, most urgent first.

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<AttentionKind, string> = {
  unanswered_lead: "Unanswered leads",
  client_waiting: "Clients waiting on us",
  missing_info: "Missing information",
  awaiting_approval: "Waiting for approval",
  next_action_overdue: "Overdue next actions",
  followup_overdue: "Overdue follow-ups",
  proposal_silent: "Silent proposals",
  no_next_action: "No next action",
};

// Red for "someone is waiting on us right now", amber for slipping, grey for tidy-up.
const KIND_TONE: Record<AttentionKind, "red" | "amber" | "grey"> = {
  unanswered_lead: "red",
  client_waiting: "red",
  missing_info: "red",
  awaiting_approval: "amber",
  next_action_overdue: "amber",
  followup_overdue: "amber",
  proposal_silent: "amber",
  no_next_action: "grey",
};

const TONE_STYLES = {
  red: { dot: "var(--accent)", text: "var(--accent)" },
  amber: { dot: "#d97706", text: "var(--warn)" },
  grey: { dot: "var(--ink-3)", text: "var(--ink-3)" },
};

export default async function NeedsAttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const user = await requireUser();
  const { scope } = await searchParams;
  const mineOnly = scope !== "all";

  const [rows, appSettings] = await Promise.all([listOpportunities(), getSettings()]);
  const now = new Date();

  const all = buildAttentionList(rows.map(toAttentionInput), {
    now,
    responseTargetMinutes: appSettings.responseTargetMinutes,
  });

  // "Mine" means I own it, or nobody does — an unowned lead is everyone's
  // problem, and hiding it is exactly how leads go cold.
  const mine = all.filter((i) => i.ownerId === user.id || i.ownerId === null);
  const items = mineOnly ? mine : all;
  const counts = attentionCounts(items);

  // Grouped so one deal is one row, however many rules it trips — otherwise
  // the list is noisy and any total computed from it double-counts.
  const groups = groupAttention(items);
  const mineGroups = groupAttention(mine);
  const allGroups = groupAttention(all);

  const urgent = groups.filter((g) => KIND_TONE[g.primary.kind] === "red").length;
  const atRisk = groups.filter((g) => KIND_TONE[g.primary.kind] === "amber").length;
  const totalValue = totalValueAtStake(groups);

  return (
    <div className="min-h-screen" style={{ background: "var(--surface)" }}>
      <SiteHeader active="attention" user={user} />
      <SampleDataBanner />

      <div className="px-5 md:px-8 py-7 max-w-[1600px] mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--ink)" }}>
              {mineOnly ? `Good to see you, ${user.name.split(" ")[0]}` : "Everything that needs attention"}
            </h1>
            <p className="text-[13px] text-ink3 mt-1">
              {groups.length === 0
                ? "Nothing needs you right now."
                : `${groups.length} opportunit${groups.length === 1 ? "y needs" : "ies need"} attention, most urgent first.`}
            </p>
          </div>

          <div className="flex items-center gap-1 bg-raised border border-line rounded-lg p-1">
            {[
              { key: "mine", label: `Mine (${mineGroups.length})`, href: "/" },
              { key: "all", label: `Everyone (${allGroups.length})`, href: "/?scope=all" },
            ].map((t) => {
              const active = (t.key === "mine") === mineOnly;
              return (
                <Link key={t.key} href={t.href}
                  className="px-4 py-1.5 text-[11px] font-bold tracking-[0.12em] uppercase rounded-md transition-colors"
                  style={active
                    ? { background: "var(--header-bg)", color: "var(--header-ink)" }
                    : { color: "var(--ink-3)" }}>
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <StatCard label="Someone is waiting" value={String(urgent)} accent={urgent > 0 ? "red" : undefined}
            sub="Unanswered leads and client replies" />
          <StatCard label="Slipping" value={String(atRisk)} accent={atRisk > 0 ? "amber" : undefined}
            sub="Overdue actions, approvals, silence" />
          <StatCard label="Needs tidying" value={String(counts.no_next_action)}
            sub="No next action set" />
          <StatCard label="Value at stake" value={fmtCents(totalValue)}
            sub="Across everything listed" />
        </div>

        {groups.length === 0 ? (
          <EmptyState
            title="Nothing needs your attention."
            hint={rows.length === 0
              ? "Nothing has come through yet. The first proposal generated lands here automatically."
              : mineOnly && allGroups.length > 0
              ? `${allGroups.length} opportunit${allGroups.length === 1 ? "y" : "ies"} on the wider team. Switch to Everyone to see them.`
              : "Every lead has been answered and every deal has a next action."}
            action={<Link href="/proposal"
              className="inline-block text-[11px] font-bold tracking-[0.16em] uppercase px-4 py-2 rounded"
              
style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>+ New Proposal</Link>}
          />
        ) : (
          <div className="bg-raised border border-line rounded-lg overflow-hidden">
            {groups.map((group, i) => (
              <AttentionRow key={group.opportunityId} group={group} first={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AttentionRow({ group, first }: { group: AttentionGroup; first: boolean }) {
  const tone = TONE_STYLES[KIND_TONE[group.primary.kind]];
  return (
    <Link
      href={`/opportunity/${group.opportunityId}`}
      className={`flex items-center gap-4 px-5 py-3.5 hover:bg-sunken transition-colors ${first ? "" : "border-t border-line"}`}
    >
      <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: tone.dot }} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[14.5px] font-semibold text-ink truncate">
            {group.company || "Untitled"}
          </span>
          {group.eventName && (
            <span className="text-[13px] text-ink3 truncate">{group.eventName}</span>
          )}
        </div>
        <p className="text-[12.5px] font-medium mt-0.5" style={{ color: tone.text }}>
          {group.primary.headline}
          {group.others.length > 0 && (
            <span className="text-ink3 font-normal">
              {" · "}
              {group.others.map((o) => o.headline.toLowerCase()).join(" · ")}
            </span>
          )}
        </p>
      </div>

      <span className="text-[13.5px] font-semibold text-ink2 whitespace-nowrap hidden sm:block"
        style={{ fontVariantNumeric: "tabular-nums" }}>
        {group.valueCents ? fmtCents(group.valueCents) : ""}
      </span>

      <span className="hidden md:block w-[110px] text-right">
        <OwnerBadge name={group.ownerName} color={group.ownerColor} />
      </span>

      <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-ink3 whitespace-nowrap hidden lg:block w-[130px] text-right">
        {KIND_LABELS[group.primary.kind]}
      </span>
    </Link>
  );
}
