import "server-only";
import { and, desc, eq, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { opportunities, users } from "@/db/schema";
import { OPEN_STAGES } from "./constants";
import { getRoutingSettings } from "./settings";
import { routeOpportunity, type RoutingCandidate, type RoutingDecision } from "./routing";

// Gathers what the pure router needs from the database. Kept separate so the
// decision logic itself stays testable without one.

/**
 * The planner who last handled this client.
 *
 * Matched on contact email first, since that identifies a person exactly, then
 * on company name, which catches a new contact at a company already worked.
 * Only ever looks at records that actually have an owner.
 */
async function findRelationshipOwner(
  candidate: RoutingCandidate,
  excludeId?: string,
): Promise<string | null> {
  const email = candidate.email.trim().toLowerCase();
  const company = candidate.company.trim().toLowerCase();
  if (!email && !company) return null;

  const identity: SQL[] = [];
  if (email) identity.push(sql`lower(${opportunities.email}) = ${email}`);
  if (company) identity.push(sql`lower(${opportunities.company}) = ${company}`);

  const [row] = await getDb()
    .select({ ownerId: opportunities.ownerId, email: opportunities.email })
    .from(opportunities)
    .where(and(
      or(...identity),
      isNotNull(opportunities.ownerId),
      excludeId ? ne(opportunities.id, excludeId) : undefined,
    ))
    // An exact email match beats a company match, then most recent wins.
    .orderBy(
      sql`case when lower(${opportunities.email}) = ${email} then 0 else 1 end`,
      desc(opportunities.lastActivityAt),
    )
    .limit(1);

  return row?.ownerId ?? null;
}

/** Open opportunities per active planner, so the fallback can balance load. */
async function currentWorkload(): Promise<Array<{ userId: string; openCount: number }>> {
  const db = getDb();
  const active = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.active, true), inArray(users.role, ["planner", "manager"])))
    .orderBy(users.createdAt, users.id);

  if (active.length === 0) return [];

  const counts = await db
    .select({ ownerId: opportunities.ownerId, n: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(inArray(opportunities.stage, OPEN_STAGES))
    .groupBy(opportunities.ownerId);

  const byUser = new Map(counts.map((c) => [c.ownerId, c.n]));
  return active.map((u) => ({ userId: u.id, openCount: byUser.get(u.id) ?? 0 }));
}

/** Decide who should own this lead, and why. */
export async function decideOwner(
  candidate: RoutingCandidate,
  actorId: string | null,
): Promise<RoutingDecision> {
  const [settings, relationshipOwnerId, workload] = await Promise.all([
    getRoutingSettings(),
    findRelationshipOwner(candidate),
    currentWorkload(),
  ]);

  return routeOpportunity(candidate, { settings, relationshipOwnerId, workload, actorId });
}
