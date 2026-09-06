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
     * The season table: where the teams stand after N weeks of one league.
     *
     * Priced on the paid tier because it is what makes a LEAGUE a league
     * rather than six unrelated evenings, and a league is a recurring
     * customer by definition. A club running a Thursday night season is
     * exactly who a subscription is for.
     *
     * Unlike the three below it costs nothing per use — it is arithmetic over
     * rounds already computed, with no carrier or model bill behind it. So it
     * is ON for the paid tier today rather than dark pending revenue.
     */
    seasonStandings: boolean;

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

    /** AjAi: drafted commentary, invitations, and setup suggestions. The flag
     *  keeps the neutral name; the label people read is the brand. */
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
    features: { whiteLabel: false, seasonStandings: false, sms: false, cardScan: false, aiAssist: false },
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
    features: { whiteLabel: true, seasonStandings: true, sms: false, cardScan: false, aiAssist: false },
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
 * THIS USED TO PROMISE A DELETION THAT NEVER HAPPENED. The sentence read
 * "Scores, players and results are permanently deleted 48 hours after a
 * tournament finishes", in bold on the public pricing page and again before a
 * club's first tournament. Nothing deleted anything. `dueForPurge` in
 * retention.ts decides what is overdue, is fully unit tested, and has never had
 * a caller outside its own tests — no cron in any workflow, none in
 * vercel.json, no route, no script. Every free-plan tournament ever run is
 * still there, players and scores included.
 *
 * A promise to destroy somebody's data is not one to make and not keep, and it
 * is wrong in both directions at once: a club that believed it did not export
 * what it should have, and a player told their name and score would be gone in
 * two days was told something untrue on a page anyone can read.
 *
 * So this says what is TRUE — the plan does not guarantee a finished
 * tournament is kept — and deliberately does not promise to keep one either.
 * That second half matters: "we keep it for good" would be a fresh promise
 * that turns building the purge into a breach of it, which is how a stopgap
 * becomes permanent. `plan-copy.test.ts` holds this wording to whichever of
 * the two is actually implemented, and will allow the blunt version back the
 * day something calls `dueForPurge`.
 */
export function retentionNotice(planKey: string): string | null {
  const plan = planFor(planKey);
  if (plan.retentionHours === null) return null;
  return "This plan doesn't guarantee that a finished tournament is kept. Export anything you want to hold on to, or upgrade and we'll keep it for you.";
}

/**
 * The same term in a few words, for a bullet or a one-line plan summary.
 *
 * Here rather than composed at each screen, because it was composed at each
 * screen: the pricing page and the plan panel each built their own sentence out
 * of `retentionHours`, so both went on advertising a 48-hour deletion after the
 * shared notice above had stopped. One reader, like `retentionNotice`.
 */
export function retentionSummary(plan: Plan): string {
  return plan.retentionHours === null ? "results kept for good" : "results not guaranteed to be kept";
}

/**
 * Shown where the season table is reached on a plan that does not include it.
 *
 * A constant rather than a string at the call site, so a second surface for
 * this feature cannot describe the same lock in different words. There was
 * briefly a second — a per-event table in services/season.ts — which turned
 * out to be unreachable and was deleted rather than gated twice.
 *
 * The feature was sold and given away: `upgradeBenefits` has pitched "the
 * season table" as a reason to pay since it was written, the nav has carried a
 * "Season standings" item with no plan check, and the only thing that ever
 * gated on `seasonStandings` was a service nothing called.
 */
export const SEASON_LOCKED =
  "The season table comes with the paid plan. Every tournament still has its own " +
  "board — this is the one that adds them up across the season.";

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
    label: "AjAi drafting",
    benefit:
      "AjAi writes a first draft of your leaderboard commentary, invitation, and round setup, ready for you to edit.",
    locked:
      "AjAi drafting isn't switched on yet. Write it yourself for now — this is coming with the paid plan, because each draft costs money.",
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
    // Was "instead of losing them 48 hours after the event" — the same
    // unimplemented deletion, hard-coded here rather than read from the plan.
    out.push("Every finished tournament kept for good, guaranteed.");
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
  if (!plan.features.seasonStandings) {
    out.push(
      "The season table — where your teams stand after six weeks, not just after last night. It is what makes a league a league rather than six unrelated evenings.",
    );
  }
  if (plan.key === "free") {
    out.push(
      "Decide for yourself whether each tournament asks entrants for a mobile number — free events always require one, and every extra required field costs you entries.",
    );
  }

  // The metered ones last and flagged as coming: they are the reason the paid
  // tier exists, but promising them as available today would be a lie until
  // the flags above are on.
  for (const f of METERED_FEATURES) {
    if (!plan.features[f.key]) out.push(`${f.benefit} (coming with the paid plan.)`);
  }

  return out;
}

/**
 * Whether this tournament must collect a phone number as well as an email.
 *
 * Email is required everywhere and always — it is how a player signs in, so an
 * entry without one produces somebody who cannot reach their own tournament.
 * Phone is a different question, and the answer depends on the plan.
 *
 * On the free plan it is required, with no way to turn it off. On a paid plan
 * the organizer decides per tournament, which is the setting `requirePhone`
 * has always been. That asymmetry is deliberate and it is a real difference:
 * asking every entrant for a mobile costs entries — the members it turns away
 * are disproportionately the older ones who genuinely do not have one — so
 * being able to stop asking is worth something, and it is the club that knows
 * whether its membership can bear it.
 *
 * Kept here rather than inline at the four places that create an entrant,
 * because those four disagreeing is precisely how a rule like this rots.
 */
export function phoneRequiredFor(
  planKey: string | null | undefined,
  eventRequirePhone: boolean,
): boolean {
  const plan = planFor(planKey);
  // Anything that isn't a known paid plan falls back to free, and free is the
  // stricter side — an unknown plan key asks for more, never less.
  if (plan.key === "free") return true;
  return eventRequirePhone;
}

/** Why the phone field cannot be switched off, for the setting's own screen. */
export const PHONE_REQUIRED_FREE =
  "On the free plan every entrant gives a mobile number. Upgrade to decide this per tournament — useful when a good part of your membership has no mobile at all.";
