import { requireUser } from "@/lib/auth";
import { LEAD_SOURCES } from "@/lib/constants";
import ProposalBuilder, { type ProposalSeed } from "../opportunity/[id]/proposal/ProposalBuilder";

// The team's front door. A client calls, a planner fills this in, the proposal
// goes out — and that act creates the opportunity behind it. Nobody has to
// register a lead first; the work they were already doing does it.
//
// Regenerating for the same contact email attaches a new version to the
// existing open opportunity rather than forking a duplicate.

export const dynamic = "force-dynamic";

export default async function NewProposalPage() {
  const user = await requireUser();

  const seed: ProposalSeed = {
    client: { prepared_by: user.name },
    events: [],
    version: 1,
  };

  return (
    <ProposalBuilder
      seed={seed}
      backHref="/pipeline"
      leadSources={LEAD_SOURCES}
    />
  );
}
