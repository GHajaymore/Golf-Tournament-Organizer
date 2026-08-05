/**
 * Subscription plans.
 *
 * Definitions live in code rather than the database on purpose: what a tier
 * includes changes far more often than a schema should, and adjusting a limit
 * or a price shouldn't mean a migration and a backfill across live tenants.
 * Only the plan key is stored (Subscription.plan).
 *
 * A deliberate constraint runs through these limits: **players are never
 * counted or charged for.** Limits apply to organizers, staff seats and
 * tournaments — never to the size of a field. A tool that made 32 golfers pay
 * to enter their own scores would not get used, and the players are the
 * distribution: they see it in a member-guest, then run their own event.
 *
 * Nothing enforces these yet. They exist so the shape is settled before
 * payments are wired up; `limitCheck` below is the intended single entry point
 * when enforcement does arrive.
 */

export type PlanKey = "free" | "club";

export interface Plan {
  key: PlanKey;
  name: string;
  /** Short line for pricing/upgrade surfaces. */
  blurb: string;
  /** Monthly price in whole currency units. 0 = free. Display only for now. */
  priceMonthly: number;
  limits: {
    /** Tournaments that may be active (not completed) at once. null = unlimited. */
    activeEvents: number | null;
    /** Organization staff seats — organizers and assistants. null = unlimited. */
    staffSeats: number | null;
    /** Players per tournament. Always unlimited; present so the intent is
     *  explicit and stays that way if someone adds a tier later. */
    playersPerEvent: null;
  };
  features: {
    /**
     * Whether the club's branding fully replaces TourneyHQ's.
     *
     * Off, a club logo still shows everywhere, with a small "Powered by
     * TourneyHQ" line kept alongside it. That attribution is the distribution
     * channel: players see it in a member-guest and go on to run their own
     * event. Removing it is the kind of thing clubs pay for, which is why it
     * sits on the paid tier rather than being given away.
     */
    whiteLabel: boolean;
  };
}

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "Free",
    blurb: "For an organizer running a single event.",
    priceMonthly: 0,
    limits: {
      activeEvents: 1,
      staffSeats: 1,
      playersPerEvent: null,
    },
    features: { whiteLabel: false },
  },
  club: {
    key: "club",
    name: "Club",
    blurb: "For clubs and societies running a season of events.",
    priceMonthly: 29,
    limits: {
      activeEvents: null,
      staffSeats: 10,
      playersPerEvent: null,
    },
    features: { whiteLabel: true },
  },
};

export const DEFAULT_PLAN: PlanKey = "free";

/** Resolve a stored plan string, falling back to free for unknown values so a
 *  bad row can never lock someone out of their own tournaments. */
export function planFor(key: string | null | undefined): Plan {
  return PLANS[(key ?? "") as PlanKey] ?? PLANS[DEFAULT_PLAN];
}

export type LimitKey = "activeEvents" | "staffSeats";

export interface LimitResult {
  allowed: boolean;
  limit: number | null;
  current: number;
  /** Set when `allowed` is false — safe to show to the user. */
  reason?: string;
}

/**
 * Single entry point for "may this organization add one more?".
 *
 * Not called anywhere yet. When enforcement is switched on, call this rather
 * than comparing counts inline, so every limit reads from one place.
 */
export function limitCheck(planKey: string, limit: LimitKey, current: number): LimitResult {
  const plan = planFor(planKey);
  const max = plan.limits[limit];
  if (max === null) return { allowed: true, limit: null, current };
  if (current < max) return { allowed: true, limit: max, current };

  const what = limit === "activeEvents" ? "active tournaments" : "staff seats";
  return {
    allowed: false,
    limit: max,
    current,
    reason: `The ${plan.name} plan includes ${max} ${what}. Upgrade to add more.`,
  };
}
