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
  /**
   * How long a finished tournament's data is kept, in hours. Null keeps it.
   *
   * This is the free tier's real cost, and it is the kind of term that has to
   * be stated before someone runs an event rather than discovered afterwards:
   * a club that loses its member-guest results the next morning was not warned
   * enough. Every surface that offers the free plan says this in plain words.
   */
  retentionHours: number | null;
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

    /**
     * Everything below costs real money *per use* rather than per tenant.
     *
     * The rest of this product is priced on capacity — seats, tournaments,
     * how long data is kept — where one more club costs essentially nothing
     * to serve. These three do not work that way: each is a per-message or
     * per-call charge from a carrier or a model provider that scales with how
     * much a club actually uses it. A free tier that included them would lose
     * money in proportion to how much people liked them, which is the worst
     * possible shape for a free tier.
     *
     * They are built, tested, and switched off — not stubbed. When there is
     * revenue to cover them, these flip to `true` on the paid plan and nothing
     * else has to change.
     */

    /** Sending an organizer broadcast as a text as well as in the app. */
    sms: boolean;

    /** Reading a photographed scorecard into proposed scores. */
    cardScan: boolean;

    /** Drafted commentary, invitations, and setup suggestions. */
    aiAssist: boolean;
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
    // Two days to export, then the results are gone. The single biggest reason
    // to upgrade, and the single most important thing to say before anyone
    // plays — one number, read by every surface that mentions it.
    retentionHours: 48,
    features: { whiteLabel: false, sms: false, cardScan: false, aiAssist: false },
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
    retentionHours: null,
    // The metered three are dark on BOTH tiers today. They are switched off by
    // cost, not by tier: until subscription revenue exists to cover the
    // carrier and model bills, nobody gets them — a paid club included.
    // Flipping them here is the whole of turning them on, and the upgrade
    // copy already lists them (see METERED_FEATURES below), so the promise and
    // the switch move together.
    features: { whiteLabel: true, sms: false, cardScan: false, aiAssist: false },
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

/**
 * The retention term in plain words, for wherever a plan is offered.
 *
 * Deliberately one sentence and deliberately blunt. A club losing its
 * member-guest results the morning after is a disaster that a euphemism would
 * have caused, so this says "deleted" rather than "not retained".
 */
export function retentionNotice(planKey: string): string | null {
  const plan = planFor(planKey);
  if (plan.retentionHours === null) return null;
  const h = plan.retentionHours;
  return `Scores, players and results are permanently deleted ${h} hours after a tournament finishes. Export anything you want to keep, or upgrade to hold on to it.`;
}

/** Whether this plan keeps data indefinitely. */
export function keepsDataForever(planKey: string): boolean {
  return planFor(planKey).retentionHours === null;
}

/** Feature flags that can be checked by name. */
export type FeatureKey = keyof Plan["features"];

/**
 * Is this feature switched on for this plan?
 *
 * One entry point, so a feature is never gated by an inline plan comparison
 * that somebody later forgets to update. Unknown plan keys fall back to free,
 * which fails closed for everything metered.
 */
export function hasFeature(planKey: string | null | undefined, feature: FeatureKey): boolean {
  return planFor(planKey).features[feature] === true;
}

/**
 * The features that cost money every time they are used, with the words shown
 * to an organizer who reaches one.
 *
 * Kept as data rather than scattered through the screens that gate them so the
 * promise on the upgrade page and the message at the locked door cannot drift
 * apart — they are generated from the same rows.
 */
export const METERED_FEATURES: {
  key: FeatureKey;
  /** Short label, for the benefits list. */
  label: string;
  /** What the club gets, one line. */
  benefit: string;
  /** Shown where the feature is reached and unavailable. */
  locked: string;
}[] = [
  {
    key: "sms",
    label: "Text alerts",
    benefit:
      "Send a frost delay or a tee change as a text as well as in the app, to the players who asked for them.",
    locked:
      "Text alerts aren't switched on yet. Your message still reaches everyone in the app — texting is coming with the paid plan, because every text costs the club money at the carrier.",
  },
  {
    key: "cardScan",
    label: "Photograph a scorecard",
    benefit:
      "Photograph a completed card and have the scores read off it for you to check, instead of typing eighteen numbers.",
    locked:
      "Reading a photographed card isn't switched on yet. Enter the scores by hand for now — this is coming with the paid plan, because each card read costs money.",
  },
  {
    key: "aiAssist",
    label: "Drafted commentary and invitations",
    benefit:
      "A first draft of your leaderboard commentary, invitation, and round setup, ready to edit.",
    locked:
      "Drafting isn't switched on yet. Write it yourself for now — this is coming with the paid plan, because each draft costs money.",
  },
];

/**
 * Why a club on this plan would upgrade, in the order they'd care.
 *
 * Generated rather than written out per screen so a new paid feature appears
 * everywhere upgrades are offered by being added once. Anything the plan
 * already has is left out — a benefits list that includes what you already
 * bought reads as a mistake.
 */
export function upgradeBenefits(planKey: string | null | undefined): string[] {
  const plan = planFor(planKey);
  const out: string[] = [];

  if (plan.retentionHours !== null) {
    out.push("Keep your results permanently, instead of losing them 48 hours after the event.");
  }
  if (plan.limits.activeEvents !== null) {
    out.push("Run as many tournaments at once as your season needs.");
  }
  if (plan.limits.staffSeats !== null && plan.limits.staffSeats < 10) {
    out.push("Bring your committee in — up to ten organizers and assistants.");
  }
  if (!plan.features.whiteLabel) {
    out.push("Your club's branding on every screen, with ours removed.");
  }

  // The metered ones last and flagged as coming: they are the reason the paid
  // tier exists, but promising them as available today would be a lie until
  // the flags above are on.
  for (const f of METERED_FEATURES) {
    if (!plan.features[f.key]) out.push(`${f.benefit} (coming with the paid plan.)`);
  }

  return out;
}
