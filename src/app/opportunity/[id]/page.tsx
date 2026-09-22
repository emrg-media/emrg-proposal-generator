import { notFound } from "next/navigation";
import { requireUser, canApprove } from "@/lib/auth";
import { getOpportunity, listUsers } from "@/lib/opportunities";
import { getSettings } from "@/lib/settings";
import SiteHeader from "@/components/SiteHeader";
import OpportunityDetail from "./OpportunityDetail";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  // A malformed id would otherwise surface as a Postgres uuid syntax error.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [data, team, appSettings] = await Promise.all([
    getOpportunity(id), listUsers(), getSettings(),
  ]);
  if (!data) notFound();

  return (
    <div className="min-h-screen" style={{ background: "#f5f4f2" }}>
      <SiteHeader active="pipeline" user={user} />
      <OpportunityDetail
        opportunity={data.opportunity}
        timeline={data.timeline.map((t) => ({
          id: t.activity.id,
          type: t.activity.type,
          body: t.activity.body,
          occurredAt: t.activity.occurredAt.toISOString(),
          actorName: t.actorName,
        }))}
        collaborators={data.collaborators}
        proposals={data.proposals.map((p) => ({
          id: p.id, version: p.version, feeRaw: p.feeRaw, feeCents: p.feeCents,
          generatedAt: p.generatedAt.toISOString(),
          sentAt: p.sentAt ? p.sentAt.toISOString() : null,
          sentTo: p.sentTo,
        }))}
        team={team.map((u) => ({ id: u.id, name: u.name, role: u.role }))}
        currentUserCanApprove={canApprove(user)}
        responseTargetMinutes={appSettings.responseTargetMinutes}
      />
    </div>
  );
}
