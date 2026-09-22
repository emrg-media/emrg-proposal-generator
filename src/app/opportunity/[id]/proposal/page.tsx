import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOpportunity } from "@/lib/opportunities";
import { fromCents } from "@/lib/fee";
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
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await getOpportunity(id);
  if (!data) notFound();

  const o = data.opportunity;
  const contact = [o.firstName, o.lastName].filter(Boolean).join(" ");

  const seed: ProposalSeed = {
    client: {
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
    events: o.eventDate || o.eventTypes.length || o.guestCount
      ? [{ date: o.eventDate, eventTypes: o.eventTypes, guestCount: o.guestCount }]
      : [],
    version: (data.proposals[0]?.version ?? 0) + 1,
  };

  return (
    <ProposalBuilder
      opportunityId={o.id}
      opportunityCode={o.code}
      seed={seed}
      backHref={`/opportunity/${o.id}`}
    />
  );
}
