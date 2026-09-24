// Deciding who owns a lead (Mario's checklist item 3).
//
// Ownership already works when a planner creates the record: they own it. The
// reason this exists is the case where nobody does, which is where email intake
// is heading. It is built now so that path has somewhere to land, and so the
// one rule that is valuable today (an existing client stays with the planner
// who knows them) works immediately.
//
// Pure and stateless. Everything it needs is passed in, so it can be tested
// exhaustively and reasoned about without a database.

export type RuleKind = "event_type" | "lead_source" | "value_over" | "always";

export interface RoutingRule {
  id: string;
  kind: RuleKind;
  /** Event type or lead source to match, for those kinds. */
  match?: string;
  /** Minimum resolved value, for "value_over". */
  minValueCents?: number;
  userId: string;
  enabled: boolean;
}

export interface RoutingSettings {
  /** An existing client stays with the planner who already knows them. */
  relationshipWins: boolean;
  rules: RoutingRule[];
  /** Used when nothing else matches. Null means balance by open workload. */
  fallbackUserId: string | null;
}

export const DEFAULT_ROUTING: RoutingSettings = {
  relationshipWins: true,
  rules: [],
  fallbackUserId: null,
};

export interface RoutingCandidate {
  company: string;
  email: string;
  eventTypes: string[];
  leadSource: string;
  valueCents: number | null;
}

export interface RoutingContext {
  settings: RoutingSettings;
  /** Owner of the most recent prior deal with this company or contact. */
  relationshipOwnerId: string | null;
  /** Active planners, and how many open opportunities each is carrying. */
  workload: Array<{ userId: string; openCount: number }>;
  /** Who is doing this right now, if anyone. Null for automated intake. */
  actorId: string | null;
}

export interface RoutingDecision {
  userId: string | null;
  /** Plain-language explanation, written to the timeline. */
  reason: string;
  /** Anyone who should ride along, e.g. the planner who typed it up. */
  collaboratorIds: string[];
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

export function routeOpportunity(
  candidate: RoutingCandidate,
  ctx: RoutingContext,
): RoutingDecision {
  const { settings, relationshipOwnerId, workload, actorId } = ctx;

  // 1. An existing client stays with whoever already has the relationship.
  //    When somebody else typed this one up they are kept on as a collaborator
  //    rather than dropped, so nobody loses sight of work they started.
  if (settings.relationshipWins && relationshipOwnerId) {
    const stolenFrom = actorId && actorId !== relationshipOwnerId ? [actorId] : [];
    return {
      userId: relationshipOwnerId,
      reason: "Existing client, kept with the planner who already owns the relationship",
      collaboratorIds: stolenFrom,
    };
  }

  // 2. Explicit rules, in the order the team arranged them. First match wins,
  //    so a specific rule can sit above a catch-all.
  for (const rule of settings.rules) {
    if (!rule.enabled || !rule.userId) continue;

    const hit =
      rule.kind === "always" ? true
      : rule.kind === "event_type"
        ? candidate.eventTypes.some((t) => norm(t) === norm(rule.match ?? ""))
      : rule.kind === "lead_source"
        ? norm(candidate.leadSource) === norm(rule.match ?? "")
      : rule.kind === "value_over"
        ? candidate.valueCents !== null
          && rule.minValueCents !== undefined
          && candidate.valueCents >= rule.minValueCents
      : false;

    if (hit) {
      return {
        userId: rule.userId,
        reason: describeRule(rule),
        collaboratorIds: [],
      };
    }
  }

  // 3. Whoever is doing it owns it. A planner filling in a proposal is not
  //    looking to hand it to somebody else.
  if (actorId) {
    return { userId: actorId, reason: "Created by this planner", collaboratorIds: [] };
  }

  // 4. Nobody is driving, so fall back: a named person if the team chose one,
  //    otherwise whoever is carrying the least. Ties break on user id so the
  //    result is deterministic rather than dependent on row order.
  if (settings.fallbackUserId) {
    return {
      userId: settings.fallbackUserId,
      reason: "Default owner for unrouted leads",
      collaboratorIds: [],
    };
  }

  const lightest = [...workload].sort(
    (a, b) => a.openCount - b.openCount || a.userId.localeCompare(b.userId),
  )[0];

  if (!lightest) {
    return { userId: null, reason: "No active planner to assign to", collaboratorIds: [] };
  }
  return {
    userId: lightest.userId,
    reason: `Assigned by workload, carrying the fewest open opportunities (${lightest.openCount})`,
    collaboratorIds: [],
  };
}

export function describeRule(rule: RoutingRule): string {
  switch (rule.kind) {
    case "event_type": return `Rule: ${rule.match} events`;
    case "lead_source": return `Rule: leads from ${rule.match}`;
    case "value_over":
      return `Rule: worth over $${Math.round((rule.minValueCents ?? 0) / 100).toLocaleString("en-US")}`;
    case "always": return "Rule: catch-all";
  }
}

export function newRuleId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Guard settings read back from storage, which may be older or hand-edited. */
export function parseRoutingSettings(value: unknown): RoutingSettings {
  if (!value || typeof value !== "object") return DEFAULT_ROUTING;
  const v = value as Partial<RoutingSettings>;
  return {
    relationshipWins: typeof v.relationshipWins === "boolean" ? v.relationshipWins : true,
    rules: Array.isArray(v.rules)
      ? v.rules.filter((r): r is RoutingRule =>
          !!r && typeof r.id === "string" && typeof r.userId === "string")
      : [],
    fallbackUserId: typeof v.fallbackUserId === "string" && v.fallbackUserId
      ? v.fallbackUserId
      : null,
  };
}
