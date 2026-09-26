import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listOpportunities } from "@/lib/opportunities";
import { getSettings } from "@/lib/settings";
import { responseStatus } from "@/lib/attention";
import { checkCompleteness, missingSummary } from "@/lib/completeness";
import SiteHeader from "@/components/SiteHeader";
import SampleDataBanner from "@/components/SampleDataBanner";
import { EmptyState } from "@/components/ui";
import PipelineBoard, { type BoardCard } from "./PipelineBoard";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const user = await requireUser();
  const [rows, appSettings] = await Promise.all([listOpportunities(), getSettings()]);
  const now = new Date();

  const cards: BoardCard[] = rows.map((r) => ({
    id: r.id,
    ownerColor: r.ownerColor,
    company: r.company,
    contact: [r.firstName, r.lastName].filter(Boolean).join(" "),
    eventName: r.eventName || r.eventTypes.join(" / "),
    eventDate: r.eventDate,
    valueCents: r.proposalValueCents,
    valueEstimated: r.valueEstimated,
    feeRaw: r.feeRaw,
    stage: r.stage,
    ownerName: r.ownerName,
    collaboratorNames: r.collaboratorNames,
    leadAgeMs: now.getTime() - r.leadReceivedAt.getTime(),
    lastActivityMs: now.getTime() - r.lastActivityAt.getTime(),
    nextAction: r.nextAction,
    nextActionOverdue: !!r.nextActionDate && r.nextActionDate < now,
    followupState: r.followupState,
    approvalWaiting: r.approvalState === "waiting",
    responseStatus: responseStatus(r, now, appSettings.responseTargetMinutes),
    missingInfo: missingSummary(checkCompleteness(r)),
    missingBlocks: !checkCompleteness(r).readyToSend,
  }));

  return (
    <div className="min-h-screen" style={{ background: "var(--surface)" }}>
      <SiteHeader active="pipeline" user={user} />
      <SampleDataBanner />
      {cards.length === 0 ? (
        <div className="px-5 md:px-8 py-6 max-w-[1600px] mx-auto">
          <EmptyState
            title="The pipeline is empty."
            hint="Opportunities land here automatically the moment a proposal is generated. Nothing has come through yet."
            action={<Link href="/proposal"
              className="inline-block text-[11px] font-bold tracking-[0.16em] uppercase px-4 py-2 rounded"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>+ New Proposal</Link>}
          />
        </div>
      ) : (
        <PipelineBoard cards={cards} />
      )}
    </div>
  );
}
