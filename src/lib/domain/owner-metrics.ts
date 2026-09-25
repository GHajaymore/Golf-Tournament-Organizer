/**
 * OWNER METRICS — the business, computed from raw aggregates.
 *
 * Pure on purpose: the page runs the `groupBy` queries and hands the counts to
 * this, so the arithmetic that turns "42 clubs on the club plan" into revenue
 * is tested without a database and cannot disagree between two screens.
 *
 * Revenue reuses the SAME price a customer is quoted — `effectivePrice` over
 * `planFor` — so an override to the club price (env today, the owner console
 * later) moves the projected MRR here in lockstep with the pricing page. Two
 * readers of one number, which is the whole point of `effectivePrice`.
 *
 * It counts and never names. The input is aggregate counts only — no player,
 * no member, no email — so nothing a member would recognise as theirs passes
 * through here. Naming a customer ORGANIZATION is the page's job, and even
 * there it is the club, not a person.
 */
import { planFor, effectivePrice, type PricingOverrides } from "../plans";

export interface PlanCount {
  plan: string;
  count: number;
}
export interface KindCount {
  kind: string;
  count: number;
}
export interface StatusCount {
  status: string;
  count: number;
}

export interface OwnerMetricsInput {
  /** Actual organization count — the truth, even for orgs with no subscription
   *  row (which are free, so they add nothing to revenue but are real clubs). */
  totalOrgs: number;
  /** Subscriptions grouped by plan key. May not sum to `totalOrgs`. */
  orgsByPlan: PlanCount[];
  orgsByKind: KindCount[];
  eventsByStatus: StatusCount[];
  totalPlayers: number;
  /** Organizations that have never created an event — onboarding drop-off. */
  orgsWithNoEvents: number;
}

export interface TierRow {
  plan: string;
  name: string;
  count: number;
  /** The monthly price a customer on this plan is quoted right now. */
  monthly: number;
  /** count × monthly. */
  mrr: number;
}

export interface OwnerMetrics {
  totalOrgs: number;
  paidOrgs: number;
  freeOrgs: number;
  orgsWithNoEvents: number;
  totalEvents: number;
  liveEvents: number;
  totalPlayers: number;
  /** Projected monthly recurring revenue at today's prices, whole currency units. */
  estMrrMonthly: number;
  /** estMrrMonthly × 12. */
  estArr: number;
  /** Per-plan breakdown, dearest first. */
  tierMix: TierRow[];
  kinds: KindCount[];
  statuses: StatusCount[];
}

export function ownerMetrics(input: OwnerMetricsInput, overrides?: PricingOverrides): OwnerMetrics {
  // PAID tiers come from the subscription rows — a plan whose price is above
  // zero. The free tier is derived from the org count instead of the
  // subscription groupBy, because an org with NO subscription row is a free
  // club too, and counting only the "free" subscriptions undercounts them
  // (measured on the seeded database: 9 orgs, 6 free subscriptions).
  const paidTiers: TierRow[] = input.orgsByPlan
    .map((r) => {
      const plan = planFor(r.plan);
      const monthly = effectivePrice(plan, overrides);
      return { plan: plan.key, name: plan.name, count: r.count, monthly, mrr: monthly * r.count };
    })
    .filter((t) => t.monthly > 0);

  const estMrrMonthly = paidTiers.reduce((sum, t) => sum + t.mrr, 0);
  const paidOrgs = paidTiers.reduce((sum, t) => sum + t.count, 0);
  // Never negative: paid should not exceed the org count, but a dashboard that
  // prints "-3 free clubs" is a louder bug than the oddity behind it.
  const freeOrgs = Math.max(0, input.totalOrgs - paidOrgs);

  const freePlan = planFor("free");
  const freeRow: TierRow = { plan: freePlan.key, name: freePlan.name, count: freeOrgs, monthly: 0, mrr: 0 };
  const tierMix = [...paidTiers, freeRow].sort((a, b) => b.monthly - a.monthly || b.count - a.count);

  const totalEvents = input.eventsByStatus.reduce((sum, r) => sum + r.count, 0);
  const liveEvents = input.eventsByStatus.find((r) => r.status === "live")?.count ?? 0;

  return {
    totalOrgs: input.totalOrgs,
    paidOrgs,
    freeOrgs,
    orgsWithNoEvents: input.orgsWithNoEvents,
    totalEvents,
    liveEvents,
    totalPlayers: input.totalPlayers,
    estMrrMonthly,
    estArr: estMrrMonthly * 12,
    tierMix,
    kinds: [...input.orgsByKind].sort((a, b) => b.count - a.count),
    statuses: [...input.eventsByStatus].sort((a, b) => b.count - a.count),
  };
}
