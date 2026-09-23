import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listProposals } from "@/lib/proposalList";
import { STAGE_LABELS } from "@/lib/constants";
import { fmtCents } from "@/lib/fee";
import { fmtDateTime } from "@/lib/time";
import SiteHeader from "@/components/SiteHeader";
import SampleDataBanner from "@/components/SampleDataBanner";
import { EmptyState, StageChip, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  const user = await requireUser();
  const rows = await listProposals();

  const sent = rows.filter((r) => r.sentAt);
  const totalSent = sent.reduce((s, r) => s + (r.feeCents ?? 0), 0);

  return (
    <div className="min-h-screen" style={{ background: "#f5f4f2" }}>
      <SiteHeader active="proposals" user={user} />
      <SampleDataBanner />

      <div className="px-5 md:px-8 py-6 max-w-[1600px] mx-auto">
        <h1 className="text-[22px] font-bold tracking-tight mb-1" style={{ color: "#111111" }}>Proposals</h1>
        <p className="text-[13px] text-stone-500 mb-5">
          Every proposal ever generated, kept permanently — won, lost or never answered.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Proposals generated" value={String(rows.length)} />
          <StatCard label="Sent to clients" value={String(sent.length)} />
          <StatCard label="Value sent" value={fmtCents(totalSent)} />
          <StatCard label="Generated, not sent" value={String(rows.length - sent.length)}
            accent={rows.length - sent.length > 0 ? "amber" : undefined} />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No proposals yet."
            hint="Open an opportunity and generate one — it will be recorded here permanently."
          />
        ) : (
          <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 900 }}>
              <thead>
                <tr style={{ background: "var(--emrg-black)" }} className="text-white">
                  {["Generated", "Company", "Event", "Ver", "Value", "Stage", "Sent", "By"].map((h) => (
                    <th key={h} className="text-left font-semibold px-3 py-2.5 text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-2.5 whitespace-nowrap text-stone-500">{fmtDateTime(r.generatedAt)}</td>
                    <td className="px-3 py-2.5 font-medium">
                      <Link href={`/opportunity/${r.opportunityId}`} className="hover:underline">
                        {r.company || "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{r.eventName || "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums text-stone-500">v{r.version}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums font-semibold">
                      {r.feeCents !== null ? fmtCents(r.feeCents) : r.feeRaw || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <StageChip stage={r.stage} label={STAGE_LABELS[r.stage as keyof typeof STAGE_LABELS] ?? r.stage} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-stone-600">
                      {r.sentAt
                        ? <span title={r.sentTo}>{fmtDateTime(r.sentAt)}</span>
                        : <span style={{ color: "#92600a" }}>Not sent</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-stone-500">{r.generatedBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
