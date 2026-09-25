import { requireUser } from "@/lib/auth";
import { listOpportunities } from "@/lib/opportunities";
import SiteHeader from "@/components/SiteHeader";
import SampleDataBanner from "@/components/SampleDataBanner";
import DataGrid, { type GridRow } from "./DataGrid";
import { speedToLeadMs } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  const user = await requireUser();
  const rows = await listOpportunities();

  const grid: GridRow[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    createdAt: r.createdAt.toISOString(),
    leadReceivedAt: r.leadReceivedAt.toISOString(),
    stage: r.stage,
    company: r.company,
    contact: [r.firstName, r.lastName].filter(Boolean).join(" "),
    email: r.email,
    eventName: r.eventName,
    eventDate: r.eventDate,
    guestCount: r.guestCount,
    venue: r.venue,
    feeRaw: r.feeRaw,
    valueCents: r.proposalValueCents,
    valueEstimated: r.valueEstimated,
    ownerName: r.ownerName,
    collaborators: r.collaboratorNames.join(", "),
    speedMins: (() => { const ms = speedToLeadMs(r); return ms === null ? null : Math.round(ms / 60000); })(),
    proposalSentAt: r.proposalSentAt ? r.proposalSentAt.toISOString() : null,
    lastActivityAt: r.lastActivityAt.toISOString(),
    nextAction: r.nextAction,
  }));

  const owners = [...new Set(rows.map((r) => r.ownerName).filter((n): n is string => !!n))].sort();

  return (
    <div className="min-h-screen" style={{ background: "var(--surface)" }}>
      <SiteHeader active="data" user={user} />
      <SampleDataBanner />
      <DataGrid rows={grid} owners={owners} />
    </div>
  );
}
