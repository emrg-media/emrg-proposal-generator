import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOpportunity } from "@/lib/opportunities";
import { fromCents } from "@/lib/fee";
import { LEAD_SOURCES } from "@/lib/constants";
import ProposalBuilder, { type ProposalSeed } from "./ProposalBuilder";

// The existing proposal generator, pre-filled from the opportunity. The form,
// the live preview and the PDF itself are untouched — what changed is where
// the data comes from and that the result is recorded against the record.

export const dynamic = "force-dynamic";

function money(cents: number | null): string {
  const v = fromCents(cents);
  return v === null ? "" : "$" + v.toLocaleString("en-US");
}

export default async function OpportunityProposalPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { version: wanted } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await getOpportunity(id);
  if (!data) notFound();

  const o = data.opportunity;
  const contact = [o.firstName, o.lastName].filter(Boolean).join(" ");

  // ?version=N opens THAT version rather than the current state of the record,
  // so a quote can be read back as it was sent and used as the starting point
  // for the next one. Without it the versions were listed but unreachable.
  const asked = wanted ? Number(wanted) : null;
  const source = asked !== null && Number.isFinite(asked)
    ? data.proposals.find((p) => p.version === asked)
    : data.proposals[0];

  // The snapshot is the exact payload that version's PDF was built from.
  const snapshot = source?.snapshot as Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const previousServices = Array.isArray(snapshot?.selectedServices)
    ? snapshot.selectedServices.filter((v): v is string => typeof v === "string")
    : undefined;

  const restoring = asked !== null && !!source;

  const snapEvents = Array.isArray(snapshot?.events) ? snapshot.events : null;

  const seed: ProposalSeed = {
    client: restoring
      ? {
          client_name: str(snapshot?.client_name) || o.company,
          signer_name: str(snapshot?.signer_name) || contact,
          signer_title: str(snapshot?.signer_title) || o.title,
          client_email: str(snapshot?.client_email) || o.email,
          venue: str(snapshot?.venue) || o.venue,
          prepared_by: user.name,
          budget_low: str(snapshot?.budget_low) || money(o.budgetLowCents),
          budget_high: str(snapshot?.budget_high) || money(o.budgetHighCents),
          service_fee: str(snapshot?.service_fee) || o.feeRaw,
        }
      : {
          client_name: o.company,
          signer_name: contact,
          signer_title: o.title,
          client_email: o.email,
          venue: o.venue,
          prepared_by: user.name,
          budget_low: money(o.budgetLowCents),
          budget_high: money(o.budgetHighCents),
          service_fee: o.feeRaw,
        },
    events: restoring && snapEvents?.length
      ? (snapEvents as Array<{ date?: string; eventTypes?: string[]; guestCount?: string }>).map((e) => ({
          date: str(e.date),
          eventTypes: Array.isArray(e.eventTypes) ? e.eventTypes.filter((t): t is string => typeof t === "string") : [],
          guestCount: str(e.guestCount),
        }))
      : o.eventDate || o.eventTypes.length || o.guestCount
      ? [{ date: o.eventDate, eventTypes: o.eventTypes, guestCount: o.guestCount }]
      : [],
    version: (data.proposals[0]?.version ?? 0) + 1,
    // Carry the previous version's services forward. Erica hit this on the
    // demo call: a new version opened with nothing ticked, so every service
    // had to be re-selected from scratch.
    selectedServices: previousServices,
  };

  return (
    <ProposalBuilder
      opportunityId={o.id}
      opportunityCode={o.code}
      restoredFrom={restoring ? source!.version : undefined}
      seed={seed}
      backHref={`/opportunity/${o.id}`}
      leadSources={LEAD_SOURCES}
    />
  );
}
