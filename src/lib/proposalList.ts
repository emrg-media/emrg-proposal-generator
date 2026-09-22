import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { opportunities, proposals, users } from "@/db/schema";

// Every proposal ever generated, newest first — the permanent record the brief
// insists on (§6), regardless of what happened to the deal afterwards.

export interface ProposalListRow {
  id: string;
  opportunityId: string;
  code: string;
  company: string;
  eventName: string;
  stage: string;
  version: number;
  feeRaw: string;
  feeCents: number | null;
  generatedAt: Date;
  generatedBy: string | null;
  sentAt: Date | null;
  sentTo: string;
}

export async function listProposals(): Promise<ProposalListRow[]> {
  const rows = await getDb()
    .select({
      id: proposals.id,
      opportunityId: proposals.opportunityId,
      version: proposals.version,
      feeRaw: proposals.feeRaw,
      feeCents: proposals.feeCents,
      generatedAt: proposals.generatedAt,
      sentAt: proposals.sentAt,
      sentTo: proposals.sentTo,
      generatedBy: users.name,
      code: opportunities.code,
      company: opportunities.company,
      eventName: opportunities.eventName,
      stage: opportunities.stage,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .leftJoin(users, eq(users.id, proposals.generatedById))
    .orderBy(desc(proposals.generatedAt));

  return rows;
}
