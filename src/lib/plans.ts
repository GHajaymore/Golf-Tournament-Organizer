/**
 * Subscription plans.
 *
 * Definitions live in code rather than the database on purpose: what a tier
 * includes changes far more often than a schema should, and adjusting a limit
 * or a price shouldn't mean a migration and a backfill across live tenants.
 * Only the plan key is stored (Subscription.plan).
 *
 * A deliberate constraint runs through these limits: **a player never PAYS.**
 * The limits are the ORGANIZER's — seats, tournaments, and (from 2026-09-25,
 * Ajay's call) the SIZE of the field a tier may run. Capping the free tier's
 * field at ten is what keeps a hobbyist's fourball free while a club's
 * member-guest upgrades — the way Golf Genius prices its own bands, and without
 * a single golfer ever paying to enter their own scores. The paid tiers open
 * the field back up; the top tier removes the cap entirely. This reverses an
 * earlier "never cap the field" rule on purpose: the field size is the clearest
 * value metric a buyer understands, and it does the anti-abuse work that four
 * separate feature walls did before.
 *
 * Nothing enforces these yet. They exist so the shape is settled before
 * payments are wired up; `limitCheck` below is the intended single entry point
 * when enforcement does arrive.
 */

export type PlanKey = "free" | "society" | "club";

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
    /** Max players in one tournament's FIELD, or null for no cap. The free and
     *  entry tiers cap this; the top tier does not — see the file-level note. */
    playersPerEvent: number | null;
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

    /**
     * ON FOR EVERYBODY, AND HERE ON PURPOSE.
     *
     * Ajay, 2026-09-18: "while building please start gating the features we
     * need to provide per tiers. And make it dynamic." The tiers themselves are
     * not decided — three to five of them, priced, once the app is ready — so
     * switching anything OFF today would be choosing a ladder by accident.
     *
     * What the gate buys is that the choosing is later a DATA change: the day a
     * tier says no, one boolean in this file says it, with nothing to wire and
     * no screen still showing what the response withheld.
     *
     * ONE KEY PER PR, AND ONLY WHEN IT IS WIRED. Five were added here at once
     * and `no-dead-feature-keys.test.ts` refused four of them on the spot:
     * declared on every plan, read by nothing, indistinguishable from a working
     * gate when read from this file or from a pricing page generated off it.
     * That is the `seasonPlay` lesson — a flag in `org-profile.ts` that gated
     * nothing for as long as it existed and was found only because somebody
     * tried to advertise it. It was deleted on 2026-09-20; the record of what
     * it meant is kept in the prose on `ledger` there. The remaining four (the public board, flights, the roster,
     * the course library) come back one at a time, each with the sink that
     * refuses and the test that proves it.
     */

    /** The honours board — who won what, kept beyond the tournaments. */
    honours: boolean;

    /**
     * The public leaderboard link: `/live/<token>`, readable without signing in.
     *
     * Gated in `live-board.ts` where the board is BUILT, so a tier that does
     * not include it withholds the rows rather than the page — and the refusal
     * is the 404 that screen already gives for an unpublished board, which
     * tells a stranger nothing about whether the tournament exists.
     */
    publicBoard: boolean;
  };
}

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "Free",
    blurb: "For a golfer running a casual round or a one-off, up to ten players.",
    priceMonthly: 0,
    limits: {
      activeEvents: 1,
      staffSeats: 1,
      // A fourball, a small skins game — a hobbyist's field. A club's outing
      // outgrows this in its first event, which is the point.
      playersPerEvent: 10,
    },
    // Two days to export, then the results are gone. The single biggest reason
    // to upgrade, and the single most important thing to say before anyone
    // plays — one number, read by every surface that mentions it.
    retentionHours: 48,
    features: { whiteLabel: false, seasonStandings: false, sms: false, cardScan: false, aiAssist: false, honours: true, publicBoard: true },
  },
  society: {
    key: "society",
    name: "Season",
    blurb: "For a league or society running a full season — unlimited events, up to fifty a field.",
    // The growth-engine rung between Free and Club — see the monetization
    // proposal. Priced here as the default; the number is configurable through
    // `effectivePrice` without a code edit, which is why $12 is a starting
    // point rather than a commitment.
    priceMonthly: 49,
    limits: {
      // Unlimited tournaments and a season table are the point: a society runs
      // many events across a year, which is exactly the recurring customer a
      // subscription is for.
      activeEvents: null,
      // A society runs on a few organizers; ten committee seats and full
      // branding are what a CLUB (Eagle) pays the extra for.
      staffSeats: 3,
      // A society outing / league night. A full club championship field is
      // bigger, which is where Eagle comes in.
      playersPerEvent: 50,
    },
    retentionHours: null,
    // Season table ON (it costs nothing per use and is the league product).
    // White-label OFF — that is a Club line. The metered three stay dark here
    // as everywhere, switched off by cost until revenue covers them.
    features: { whiteLabel: false, seasonStandings: true, sms: false, cardScan: false, aiAssist: false, honours: true, publicBoard: true },
  },
  club: {
    key: "club",
    name: "Club",
    blurb: "For a golf club — every competition, your own branding, WHS posting, and any size of field.",
    priceMonthly: 149,
    limits: {
      activeEvents: null,
      staffSeats: 10,
      // The top tier, so no cap: a club championship, a big open, a corporate
      // day. Field size is the ladder below this; here it ends.
      playersPerEvent: null,
    },
    retentionHours: null,
    // The metered three are dark on BOTH tiers today. They are switched off by
    // cost, not by tier: until subscription revenue exists to cover the
    // carrier and model bills, nobody gets them — a paid club included.
    // Flipping them here is the whole of turning them on, and the upgrade
    // copy already lists them (see METERED_FEATURES below), so the promise and
    // the switch move together.
    features: { whiteLabel: true, seasonStandings: true, sms: false, cardScan: false, aiAssist: false, honours: true, publicBoard: true },
  },
};

export const DEFAULT_PLAN: PlanKey = "free";

/** The billing currency for subscription prices. This is what the PLATFORM
 *  charges for the software (US-first), NOT a club's own money currency, which
 *  is per club and lives in `currencySymbol`. Quoted on the schema.org offer. */
export const PLAN_CURRENCY = "USD";

/** Resolve a stored plan string, falling back to free for unknown values so a
 *  bad row can never lock someone out of their own tournaments. */
export function planFor(key: string | null | undefined): Plan {
  return PLANS[(key ?? "") as PlanKey] ?? PLANS[DEFAULT_PLAN];
}

/**
 * PRICES ARE CONFIGURABLE WITHOUT A CODE EDIT.
 *
 * The `priceMonthly` in `PLANS` is the DEFAULT — the number the app quotes when
 * nothing overrides it. A price changes more often than anything else about a
 * tier, and changing one should not mean editing this file and shipping a
 * build. So an override layer sits in front of it: today an operator sets the
 * `TOURNEYHQ_PRICING` environment value; when the owner console lands it writes
 * the SAME shape from stored settings, and `effectivePrice` reads it either way
 * — `overrides` is a parameter for exactly that reason.
 *
 * The shape is one JSON object, e.g. `{"plans":{"club":{"monthly":39}}}`.
 *
 * IT REFUSES TO THROW, precisely like `featureOverrides` below. A malformed
 * value, a string where a number belongs, a negative price, a plan key nothing
 * knows about — each is ignored and the price falls back to the plan's own
 * default. A typo in a config value must never make the app quote a wrong price
 * or fail to render one, because the price is on a page a stranger reads.
 */
export interface PricingOverrides {
  plans: Partial<Record<PlanKey, { monthly?: number }>>;
}

export function parsePricingOverrides(stored: string | null | undefined): PricingOverrides {
  const empty: PricingOverrides = { plans: {} };
  const text = (stored ?? "").trim();
  if (!text) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
  const plans = (parsed as Record<string, unknown>).plans;
  if (!plans || typeof plans !== "object" || Array.isArray(plans)) return empty;

  const out: PricingOverrides = { plans: {} };
  for (const [key, value] of Object.entries(plans as Record<string, unknown>)) {
    // A plan key nothing knows about is ignored rather than stored, exactly as
    // `featureOverrides` drops an unknown feature key.
    if (!(key in PLANS)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const monthly = (value as Record<string, unknown>).monthly;
    // A price is a finite, non-negative number. "39", NaN, -1 and true are not.
    if (typeof monthly === "number" && Number.isFinite(monthly) && monthly >= 0) {
      out.plans[key as PlanKey] = { monthly };
    }
  }
  return out;
}

/** Overrides from the environment. The owner console will later supply the same
 *  shape from stored settings; pass it to `effectivePrice` directly. */
export function pricingOverrides(): PricingOverrides {
  return parsePricingOverrides(process.env.TOURNEYHQ_PRICING);
}

/**
 * The monthly price to QUOTE for a plan: the override if there is a valid one,
 * else the plan's own default.
 *
 * ONE reader, so the marketing page, the settings panel and the schema.org
 * offer cannot show three different numbers — the drift this codebase keeps
 * finding, and the reason `retentionSummary` and `SEASON_LOCKED` are single
 * sources too. Every screen that shows a price goes through here.
 */
export function effectivePrice(plan: Plan, overrides: PricingOverrides = pricingOverrides()): number {
  const override = overrides.plans[plan.key]?.monthly;
  // Validated at the sink as well as in the parser: a caller other than
  // `parsePricingOverrides` (the owner console, later) could hand in NaN,
  // Infinity or a negative, and a price is a finite, non-negative number.
  return typeof override === "number" && Number.isFinite(override) && override >= 0
    ? override
    : plan.priceMonthly;
}

/**
 * Months CHARGED for an annual subscription — ten, so two are free.
 *
 * The standard SaaS annual discount, and the one the monetization proposal
 * assumes. DERIVED rather than stored per plan on purpose: the yearly price
 * follows the monthly one, so an override to `effectivePrice` (env today, the
 * owner console later) moves the annual figure with it and there is no second
 * number to keep in step. A tier that ever wanted a different discount would
 * earn its own field; none does yet.
 */
export const ANNUAL_MONTHS_CHARGED = 10;

/**
 * The ANNUAL price to quote for a plan: the effective monthly price times the
 * months charged. Free stays free. Same single-reader discipline as
 * `effectivePrice` — every surface that shows a yearly figure comes through
 * here, so the "$290/yr" on the pricing page and the one on the settings panel
 * are the same number.
 */
export function effectiveAnnualPrice(plan: Plan, overrides: PricingOverrides = pricingOverrides()): number {
  return effectivePrice(plan, overrides) * ANNUAL_MONTHS_CHARGED;
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
 * Every feature key, at RUNTIME — because a type is erased and an override is
 * a string somebody typed.
 *
 * Derived from a plan rather than written out again: `Object.keys` of the free
 * tier's features IS the set, so a key added to the interface appears here
 * without anybody remembering, and a list that drifts from the interface
 * cannot exist. `no-dead-feature-keys.test.ts` pins that it stays that way.
 */
export const FEATURE_KEYS: FeatureKey[] = Object.keys(PLANS.free.features) as FeatureKey[];

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
 * ONE CLUB'S EXCEPTIONS TO ITS TIER, parsed from what is stored.
 *
 * A pure function over a string, so the rule can be tested without a database
 * and so the one place that decides what an override MEANS is not inside a
 * query.
 *
 * REFUSES TO THROW, and that is the whole design. This value is hand-edited —
 * that is its purpose — and it is read on the way to answering "may this club
 * do the thing it is trying to do right now". Malformed JSON, a string where a
 * boolean belongs, a key from a feature that has since been renamed: every one
 * of them is ignored, and the club falls back to exactly what its tier says.
 * A typo in an operations column must never be able to lock a club out of its
 * own tournaments.
 */
export function featureOverrides(stored: string | null | undefined): Partial<Record<FeatureKey, boolean>> {
  const raw = (stored ?? "").trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const out: Partial<Record<FeatureKey, boolean>> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    // Both halves matter: a key nothing knows about is ignored rather than
    // stored, and a truthy string like "false" is NOT a boolean and is not
    // treated as one. JSON written by hand contains both mistakes.
    if (!FEATURE_KEYS.includes(key as FeatureKey)) continue;
    if (typeof value !== "boolean") continue;
    out[key as FeatureKey] = value;
  }
  return out;
}

/**
 * What this club may do, tier and exceptions together.
 *
 * The ONE answer. Callers ask this rather than reading `features` themselves,
 * so an override cannot be honoured on one screen and forgotten on another —
 * the shape `standingRows` uses when it returns `[]` on its first line.
 */
export function featureAllowed(
  planKey: string | null | undefined,
  overrides: string | null | undefined,
  feature: FeatureKey,
): boolean {
  const exception = featureOverrides(overrides)[feature];
  return exception ?? hasFeature(planKey, feature);
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
    out.push("Your own branding on every screen, with ours removed.");
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
 * Email is required where it is the only way IN — see `entryNeedsEmail`, which
 * is the rule this sentence used to state as "everywhere and always". That was
 * true of a tournament signing players in by email and false of one using
 * Round Codes, where `createPlaySession` identifies a player by `Player.id`
 * and never reads an address.
 *
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
