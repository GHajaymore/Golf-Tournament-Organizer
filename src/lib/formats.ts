// Golf format catalog for the Round builder. Extensible — add entries here and
// they appear everywhere the format picker is used.
//
// Each entry carries enough structure for the rest of the app to work out what
// a format actually *needs*, rather than special-casing names all over the
// codebase. Two properties do most of that work:
//
//   sideSize — 1 is an individual format; anything more needs teams.
//   ball     — "individual" means every player keeps their own card and the
//              side's score is derived per hole (best ball, four-ball).
//              "single" means the side plays one ball and there is exactly one
//              card for the whole side (foursomes, scramble).
//
// That second distinction is the one that decides the scorecard shape, so it
// is worth getting right before any UI is built on top of it.

export type ScoringFamily = "match" | "stroke" | "points" | "team";

/** Whether each player keeps a card, or the side shares one. */
export type BallFormat = "individual" | "single";

/** Which scoring engine resolves a round of this format. */
export type ScoringEngine =
  | "match"
  | "stroke"
  | "stableford"
  | "modified-stableford"
  | "skins"
  | "nassau"
  | "team-aggregate"
  | "team-single";

export interface GolfFormat {
  name: string;
  desc: string;
  /** Broad scoring family, for engines/UI hints. */
  family: ScoringFamily;
  /** Players per side. 1 is an individual format and needs no team. */
  sideSize: number;
  /** Upper bound where the format allows a range — a scramble is 2 to 4. */
  maxSideSize?: number;
  ball: BallFormat;
  engine: ScoringEngine;
  /**
   * Recommended handicap allowance as a percentage of course handicap.
   *
   * These follow the published WHS/USGA recommendations where they exist, and
   * they are recommendations — a committee may set its own, so every one of
   * these is a default the organizer can override, never a rule the app
   * enforces. Formats with no published allowance (the scramble family) carry
   * the common local convention and are marked below.
   */
  allowance: number;
  /** True where `allowance` is local convention rather than a published WHS
   *  recommendation — the UI says so rather than implying a standard. */
  allowanceIsConvention?: boolean;
  /**
   * A real scoring engine computes this format's result.
   *
   * Necessary but *not* sufficient for an organizer to run it — see `playable`.
   * The distinction matters because these two were once the same flag, and a
   * picker reading "an engine exists" as "you can run this tournament" hands
   * someone a format they can set up, brief their field on, and then discover
   * on the first tee has nowhere to enter a card.
   */
  scored: boolean;
  /**
   * Usable end to end: engine, score entry, and a leaderboard.
   *
   * This is what the round-format picker offers. Everything else is shown but
   * not selectable, so the catalog stays honest about where the app is rather
   * than quietly advertising a dead end.
   */
  playable: boolean;
  /** Why a scored format isn't playable yet. Shown in the picker. */
  pendingReason?: string;
}

/** What's missing for the formats whose engines exist but whose screens don't. */
const NEEDS_ENTRY = "score entry coming soon";
/**
 * Stableford is already playable — as a scoring *basis* on a Stroke Play
 * round, which is how the engine models it and how the leaderboard reads it.
 * Offering it as a format too would give an organizer two doors to the same
 * room, one of which doesn't open.
 */
const STABLEFORD_VIA_BASIS = "set Stroke Play and choose Stableford scoring";

export const GOLF_FORMATS: GolfFormat[] = [
  /* ── Individual ────────────────────────────────────────────────────── */
  {
    name: "Match Play",
    family: "match",
    desc: "Head-to-head, hole-by-hole; the player who wins the most holes wins the match.",
    sideSize: 1,
    ball: "individual",
    engine: "match",
    allowance: 100,
    scored: true,
    playable: true,
  },
  {
    name: "Stroke Play",
    family: "stroke",
    desc: "Count total strokes; lowest score wins. Gross or net.",
    sideSize: 1,
    ball: "individual",
    engine: "stroke",
    allowance: 95,
    scored: true,
    playable: true,
  },
  {
    name: "Stableford",
    family: "points",
    desc: "Points per hole against a fixed target; highest points wins. A blow-up hole costs you that hole, not your round.",
    sideSize: 1,
    ball: "individual",
    engine: "stableford",
    allowance: 95,
    scored: true,
    playable: false,
    pendingReason: STABLEFORD_VIA_BASIS,
  },
  {
    name: "Modified Stableford",
    family: "points",
    desc: "Stableford with the rewards pushed out: eagles and birdies worth more, bogeys and worse actively penalised.",
    sideSize: 1,
    ball: "individual",
    engine: "modified-stableford",
    allowance: 95,
    scored: true,
    playable: false,
    pendingReason: NEEDS_ENTRY,
  },
  {
    name: "Skins",
    family: "points",
    desc: "Each hole is a skin. Win it outright to claim it; tie and it carries into the next hole.",
    sideSize: 1,
    ball: "individual",
    engine: "skins",
    allowance: 100,
    scored: true,
    playable: false,
    pendingReason: NEEDS_ENTRY,
  },
  {
    name: "Nassau",
    family: "match",
    desc: "Three matches on one card: front nine, back nine, and the full eighteen.",
    sideSize: 1,
    ball: "individual",
    engine: "nassau",
    allowance: 100,
    scored: true,
    playable: false,
    pendingReason: NEEDS_ENTRY,
  },

  /* ── Pairs, each playing their own ball ────────────────────────────── */
  {
    name: "Four-Ball",
    family: "team",
    desc: "Two against two, everyone plays their own ball; the better score of each pair counts on every hole.",
    sideSize: 2,
    ball: "individual",
    engine: "team-aggregate",
    allowance: 90,
    scored: true,
    playable: true,
  },
  {
    name: "Best Ball",
    family: "team",
    desc: "A team plays as partners; the best score on each hole becomes the team's score for that hole.",
    sideSize: 2,
    maxSideSize: 4,
    ball: "individual",
    engine: "team-aggregate",
    allowance: 85,
    scored: true,
    playable: true,
  },
  {
    name: "Shamble",
    family: "team",
    desc: "Everyone drives, the team takes the best tee shot, then each plays their own ball in from there.",
    sideSize: 2,
    maxSideSize: 4,
    ball: "individual",
    engine: "team-aggregate",
    allowance: 85,
    allowanceIsConvention: true,
    scored: true,
    playable: true,
  },

  /* ── Sides sharing one ball ────────────────────────────────────────── */
  {
    name: "Foursomes",
    family: "team",
    desc: "Partners play one ball, alternating shots, and alternating who tees off.",
    sideSize: 2,
    ball: "single",
    engine: "team-single",
    // 50% of the pair's combined course handicaps.
    allowance: 50,
    scored: true,
    playable: true,
  },
  {
    name: "Alternate Shot",
    family: "team",
    desc: "Partners take turns hitting the same ball. Foursomes by another name, without the tee-order rule.",
    sideSize: 2,
    ball: "single",
    engine: "team-single",
    allowance: 50,
    scored: true,
    playable: true,
  },
  {
    name: "Chapman / Pinehurst",
    family: "team",
    desc: "Both drive, swap balls for the second shot, pick one, then alternate to the hole.",
    sideSize: 2,
    ball: "single",
    engine: "team-single",
    allowance: 50,
    allowanceIsConvention: true,
    scored: true,
    playable: true,
  },
  {
    name: "Scramble",
    family: "team",
    desc: "Everyone plays, the team picks the best shot, and everyone plays again from there. The kindest format for mixed ability.",
    sideSize: 4,
    maxSideSize: 4,
    ball: "single",
    engine: "team-single",
    // No published WHS allowance; this is the widely used club convention.
    allowance: 25,
    allowanceIsConvention: true,
    scored: true,
    playable: true,
  },
  {
    name: "Texas Scramble",
    family: "team",
    desc: "A scramble with a minimum number of drives that must be used from each player, so nobody is a passenger.",
    sideSize: 4,
    maxSideSize: 4,
    ball: "single",
    engine: "team-single",
    allowance: 25,
    allowanceIsConvention: true,
    scored: true,
    playable: true,
  },
];

export const FORMAT_NAMES = GOLF_FORMATS.map((f) => f.name);

/**
 * Names the catalog used to carry, mapped to what they are now.
 *
 * "Individual Match Play" and "Individual Stroke Play" were duplicates of the
 * plain entries — every format here is individual unless sideSize says
 * otherwise, so the qualifier said nothing. Rounds created under the old names
 * still resolve to the identical format rather than silently falling back to
 * whatever happens to be first in the list.
 */
const FORMAT_ALIASES: Record<string, string> = {
  "Individual Match Play": "Match Play",
  "Individual Stroke Play": "Stroke Play",
};

/**
 * Look up a format, or undefined if the name isn't one we know.
 *
 * Callers that must distinguish "unknown" from "the first entry" use this;
 * `findFormat` is the forgiving version for display. Matching is
 * case-insensitive because format names reach here from stored rows and
 * imports, not only from the picker.
 */
export function lookupFormat(name: string): GolfFormat | undefined {
  const canonical = FORMAT_ALIASES[name] ?? name;
  const key = canonical.trim().toLowerCase();
  return GOLF_FORMATS.find((f) => f.name.toLowerCase() === key);
}

/** True when this name resolves to a real format rather than the fallback. */
export function isKnownFormat(name: string): boolean {
  return lookupFormat(name) !== undefined;
}

/**
 * Resolve a format for display, falling back rather than throwing.
 *
 * The fallback is a convenience for rendering, and callers deciding anything
 * consequential must not lean on it — an unknown name resolving to Match Play
 * once made needsCourseData answer "no course required" for a format it had
 * never heard of, which is the unsafe direction. Use `lookupFormat` there.
 */
export function findFormat(name: string): GolfFormat {
  return lookupFormat(name) ?? GOLF_FORMATS[0];
}

/**
 * Formats with a real scoring engine behind them.
 *
 * This used to be a hand-maintained list of two, because the catalog was a
 * wish-list of names with nothing behind most of them. It is now derived, so a
 * format cannot advertise itself in the picker without an engine that scores
 * it — the failure mode that list existed to prevent.
 */
export const SCORED_FORMAT_NAMES = GOLF_FORMATS.filter((f) => f.scored).map((f) => f.name);

/**
 * Formats an organizer can actually run today — the ones the picker offers.
 *
 * Deliberately narrower than SCORED_FORMAT_NAMES. An engine that computes a
 * result is not a tournament someone can run: the round also needs a way to
 * enter scores and somewhere to read them. Conflating the two is how a picker
 * ends up offering a format that can be chosen, briefed to a field, and then
 * found to have nowhere to record a card.
 */
export const PLAYABLE_FORMAT_NAMES = GOLF_FORMATS.filter((f) => f.playable).map((f) => f.name);

/** True when a round set to this format can be run end to end today. */
export function isPlayable(name: string): boolean {
  return lookupFormat(name)?.playable ?? false;
}

/** Formats played by teams rather than individuals. */
export const TEAM_FORMAT_NAMES = GOLF_FORMATS.filter((f) => f.sideSize > 1).map((f) => f.name);

/** True when this format needs teams to exist before a round can be scheduled. */
export function needsTeams(formatName: string): boolean {
  return findFormat(formatName).sideSize > 1;
}

/** True when the side shares a single scorecard rather than one card each. */
export function sharesOneCard(formatName: string): boolean {
  return findFormat(formatName).ball === "single";
}

/**
 * How many players a side may hold, as an inclusive range.
 *
 * Individual formats return 1..1, which is what lets the team builder be
 * driven entirely from the format rather than from a separate setting.
 */
export function sideSizeRange(formatName: string): { min: number; max: number } {
  const f = findFormat(formatName);
  return { min: f.sideSize, max: f.maxSideSize ?? f.sideSize };
}

/**
 * Playing handicap for one player, from their course handicap and the
 * format's allowance. Rounded to the nearest whole stroke, which is how
 * allowances are applied in practice.
 */
export function playingHandicap(courseHandicap: number, formatName: string, allowanceOverride?: number): number {
  const pct = allowanceOverride ?? findFormat(formatName).allowance;
  return Math.round((courseHandicap * pct) / 100);
}
