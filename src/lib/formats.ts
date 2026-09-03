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

import { SCRAMBLE_WEIGHTS_2, SCRAMBLE_WEIGHTS_4 } from "./domain/team";
import type { MatchEntryMode } from "./domain/match-entry";

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
   * Per-player allowance shares, best player first, keyed by how many are
   * actually on the side.
   *
   * Some shared-ball formats don't take a flat percentage of the combined
   * handicaps: greensomes is 60% of the lower plus 40% of the higher, and a
   * scramble uses a descending table. Both are the *shape* of the allowance,
   * not a number, so `allowance` alone cannot express them.
   *
   * Keyed by side size because a scramble is playable 2 to 4 and the table
   * differs. Absent means the flat `allowance` against the combined
   * handicaps, which is how foursomes' 50% is meant to work.
   */
  weightsBySideSize?: Record<number, number[]>;
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
  /**
   * What a round of this format asks to be RECORDED, best answer first.
   *
   * **The default is a real card.** Every player writes down hole-by-hole gross
   * strokes and the app derives the result from how the tournament is set up —
   * net or gross, pairs, teams, tiebreakers. A gross card is the raw fact and
   * everything else is a reading of it, so the app should never ask for a
   * number it can compute. Absent therefore means `["gross-cards"]`, and most
   * formats say nothing here.
   *
   * A format may OPT OUT, not opt in. Reduced input is a named capability of
   * the formats that genuinely produce no card — match play, where a player
   * writes down who won the hole and nobody records a 6 on a hole they have
   * already lost — and never something an organizer assembles by accident.
   *
   * The FIRST entry is the format's natural input and the one a round gets
   * without anybody choosing; the rest are what the organizer may switch it to.
   * `gross-cards` is always available (`inputChoices` puts it back if a format
   * ever leaves it out), because a club is entitled to ask its field for cards
   * whatever the format — under WHS a match-play score counts for handicapping
   * when a full card is returned, which is the difference between a round
   * counting and not.
   *
   * Declared here beside `sideSize` and `allowance` rather than being a free
   * per-round setting, so the default is right more often and setup asks fewer
   * questions.
   */
  inputs?: MatchEntryMode[];
  /**
   * The app holds this round but does not score it.
   *
   * The one honest way to support the formats clubs invent. Everything
   * organisational still works — field, tee sheet, announcements, prizes —
   * and every screen that would otherwise rank the round says who is working
   * out the result instead of showing a number it made up.
   *
   * Checked BEFORE `engine` everywhere it matters, so a manual round can
   * never fall through to a scoring engine.
   */
  manual?: boolean;
}

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
    // The one format that genuinely produces no card. A player tracks who won
    // the hole and stops counting once it is lost, so hole results are what
    // actually exists at the end of the round; the full card is available for
    // the club that wants one for the handicap record, and the bare result for
    // the match phoned in from the green.
    inputs: ["hole-results", "gross-cards", "match-result"],
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
    playable: true,
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
    playable: true,
  },
  {
    name: "Nassau",
    family: "match",
    desc: "Three matches on one card: front nine, back nine, and the full eighteen.",
    sideSize: 1,
    ball: "individual",
    engine: "nassau",
    allowance: 100,
    // Three bets sliced from one match, and `playNassau` slices the HOLE
    // RESULTS — so hole-by-hole is its natural input and a full card works
    // because the holes derive from it. A bare final result deliberately does
    // not: "3&2" says nothing about who took the front nine, and two of the
    // three bets would be invented.
    inputs: ["hole-results", "gross-cards"],
    scored: true,
    playable: true,
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
    name: "Greensomes",
    family: "team",
    desc: "Both partners drive, the side plays on with the better drive, then alternates shots to the hole.",
    sideSize: 2,
    ball: "single",
    engine: "team-single",
    // 60% of the lower handicap plus 40% of the higher — the standard
    // greensomes split, and deliberately *not* foursomes' flat 50% of the
    // combined: picking the better of two drives is an advantage, so the
    // side gets fewer shots than an alternate-shot pair of the same pair.
    allowance: 100,
    weightsBySideSize: { 2: [60, 40] },
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
    // The descending table the scoring ACTUALLY applies.
    //
    // It was only reachable through a regex on the format's NAME inside
    // `sidePlayingHandicap`, so the Rounds screen read `weightsBySideSize`,
    // found nothing, and showed the organizer a flat 25% of the combined
    // handicaps while the scorer used 25/20/15/10 of each. For a side off
    // 6/14/22/31 that is 18 shots against 11 — one round, priced two ways on
    // two screens, and neither says the other exists.
    //
    // Declared here so both readers see the same thing, and so a club adding
    // a scramble variant declares its shares rather than hoping its name
    // contains the word.
    weightsBySideSize: {
      2: SCRAMBLE_WEIGHTS_2,
      3: [25, 20, 15],
      4: SCRAMBLE_WEIGHTS_4,
    },
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
    // Same table as a plain scramble — see the note on that entry. It survived
    // the first pass of this fix because its allowance carried no comment and
    // the edit matched on one; the sweep in `shares-agree.test.ts` is what
    // found it, which is the argument for the sweep.
    weightsBySideSize: {
      2: SCRAMBLE_WEIGHTS_2,
      3: [25, 20, 15],
      4: SCRAMBLE_WEIGHTS_4,
    },
    scored: true,
    playable: true,
  },

  /* ── The escape hatch ──────────────────────────────────────────────── */
  {
    // Clubs invent formats. Somebody runs a Flag day, a Bingo Bango Bongo, a
    // six-six-six, or a local thing with a name only their members use, and
    // the honest answer is that this app cannot score it.
    //
    // The dishonest answers are worse. Making them pick Stroke Play produces
    // a leaderboard that is confidently wrong, and offering a "custom scoring"
    // builder promises an engine that would have to be written for every
    // invention anybody has. So this format says plainly: the app will hold
    // your round, your field, your tee sheet and your announcements, and the
    // committee works out the result.
    name: "Other (scored by hand)",
    family: "stroke",
    desc: "A format this app doesn't score — a club invention, a Flag day, anything unusual. The round, the field and the tee sheet are kept here; the committee works out the result and posts it.",
    sideSize: 1,
    ball: "individual",
    // Never consulted: isManualFormat is checked before any engine runs. A
    // value is required by the type, and "stroke" is the least surprising
    // thing for anything that reads it without checking.
    engine: "stroke",
    allowance: 100,
    // False, and it means it: no engine computes this. That is the point.
    scored: false,
    // Selectable all the same — an organizer genuinely needs this round to
    // exist. `playable` means "the app can run the round", and it can: it
    // just cannot rank it.
    playable: true,
    manual: true,
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

/** How scores are captured for a format. */
export type EntryMode = "match" | "stroke" | "team";

/**
 * Which entry screen a round needs.
 *
 * Several formats differ only in how their results are *read*, not how they
 * are recorded: skins and modified Stableford are both entered as an ordinary
 * stroke card, and a Nassau is entered as an ordinary match card — it is three
 * bets sliced from one result, not three sets of holes. Routing off the engine
 * rather than the event's match/stroke flag is what lets those formats reuse
 * screens that already exist instead of growing near-duplicates.
 */
export function entryModeFor(formatName: string): EntryMode {
  const f = lookupFormat(formatName);
  if (!f) return "match";
  if (f.sideSize > 1) return "team";
  switch (f.engine) {
    case "stroke":
    case "stableford":
    case "modified-stableford":
    case "skins":
      return "stroke";
    default:
      return "match";
  }
}

/**
 * The shape every round starts from: a real card.
 *
 * Named rather than repeated, because "the default is a card" is the whole
 * principle and it should be stated in one place.
 */
export const DEFAULT_INPUT: MatchEntryMode = "gross-cards";

/**
 * What this format may be recorded in, natural input first.
 *
 * A full card is always in the list, wherever it appears in the format's own
 * declaration. That is the "opt out, not opt in" rule made structural: a
 * format can say a reduced shape is its natural one, and cannot say that a
 * club may not return cards.
 */
export function inputChoices(formatName: string): MatchEntryMode[] {
  const declared = lookupFormat(formatName)?.inputs ?? [DEFAULT_INPUT];
  return declared.includes(DEFAULT_INPUT) ? declared : [...declared, DEFAULT_INPUT];
}

/** The input a round of this format gets when nobody has chosen one. */
export function declaredInput(formatName: string): MatchEntryMode {
  return inputChoices(formatName)[0];
}

/**
 * The input a round is actually recorded in: the format's, unless the
 * organizer has overruled it.
 *
 * An override the format does not offer is ignored rather than honoured. A
 * stored string is caller-supplied — a `"use server"` export is a public HTTP
 * endpoint, and TypeScript types are erased at runtime — so "final result
 * only" on a Stableford round has to resolve to something the engine can read
 * rather than to a shape it cannot. Making the wrong thing unrepresentable
 * beats documenting that callers must check.
 *
 * Empty means "no opinion", the same reading `handicapAllowance: 0` and
 * `allowanceWeights: []` already have on a round.
 */
export function resolveScoreInput(
  formatName: string,
  override?: string | null,
): MatchEntryMode {
  const choices = inputChoices(formatName);
  const wanted = (override ?? "").trim() as MatchEntryMode;
  return choices.includes(wanted) ? wanted : choices[0];
}

/** True when the organizer has asked for something the format does not offer. */
export function inputOverrideApplies(formatName: string, override?: string | null): boolean {
  const wanted = (override ?? "").trim();
  return wanted !== "" && inputChoices(formatName).includes(wanted as MatchEntryMode);
}

/** Formats played by teams rather than individuals. */
export const TEAM_FORMAT_NAMES = GOLF_FORMATS.filter((f) => f.sideSize > 1).map((f) => f.name);

/**
 * True when the app holds this round but does not rank it.
 *
 * Call this before reading `engine` on any path that produces a result. A
 * manual round reaching a scoring engine would produce a confident, wrong
 * leaderboard — the exact outcome this format exists to avoid.
 */
export function isManualFormat(formatName: string): boolean {
  return findFormat(formatName).manual === true;
}

/** True when this format needs teams to exist before a round can be scheduled. */
export function needsTeams(formatName: string): boolean {
  return findFormat(formatName).sideSize > 1;
}

/**
 * Which board a round belongs on.
 *
 * Every screen that shows results has to make this decision, and for a while
 * each of them made it separately — so they disagreed. The leaderboard had all
 * four branches; Reports had none of them and called `standingRows`
 * unconditionally, and `/live` branched only on teams. A team round therefore
 * appeared on Reports as the whole field at gross 0 through 0, and a *manual*
 * round printed a branded "Final standings snapshot" with an Advancing column
 * for a format the leaderboard explicitly refuses to score. Two screens in the
 * same product, contradicting each other, both looking authoritative.
 *
 * So the decision lives here once and every screen asks. The order matters and
 * is the leaderboard's: manual is checked FIRST, because a round the app does
 * not score must never reach a scoring path at all.
 */
export type BoardKind = "manual" | "team" | "skins" | "nassau" | "modified-stableford" | "standard";

export function boardKind(formatName: string | null | undefined): BoardKind {
  if (!formatName) return "standard";
  if (isManualFormat(formatName)) return "manual";
  if (needsTeams(formatName)) return "team";
  const engine = findFormat(formatName).engine;
  if (engine === "skins") return "skins";
  if (engine === "nassau") return "nassau";
  if (engine === "modified-stableford") return "modified-stableford";
  return "standard";
}

/**
 * True when `standingRows` is the right thing to render for this round.
 *
 * The one-line form of the check above, for screens that only need to know
 * whether the ordinary board applies.
 */
export function usesStandardBoard(formatName: string | null | undefined): boolean {
  return boardKind(formatName) === "standard";
}

/**
 * Whether this round gives a player an individual POSITION at all.
 *
 * Wider than `usesStandardBoard`, and deliberately: a Modified Stableford round
 * is ranked, it is simply ranked on a different points table, so a player in
 * one has a position and should be told it.
 *
 * The rounds that have none are the four that no board in the product will
 * rank. A skins round pays holes, not places; a Nassau is three bets, not a
 * finishing order; a team round places SIDES; and a manual one the app does not
 * score at all. Every board already refuses these — and `/me` did not, so it
 * handed a skins player a stroke-play "Position T1" in forty-point type,
 * beside a leaderboard that would not print one. A number that large is not a
 * detail; it is what the player believes they finished.
 */
export function ranksIndividuals(formatName: string | null | undefined): boolean {
  const kind = boardKind(formatName);
  return kind === "standard" || kind === "modified-stableford";
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

/**
 * The Stableford table a given ROUND is scored on.
 *
 * Modified Stableford is a different table, not a different presentation of
 * the same one: it has no floor at zero and pays a birdie double what a par is
 * worth relative to bogey. So the two order a field differently — six birdies
 * and three doubles beats one birdie and seventeen pars on the modified table
 * and loses to it on the standard one.
 *
 * `strokeStandings` accumulated points with the STANDARD table for every
 * round, then ranked on them whenever the unit said "modified Stableford
 * points". The leaderboard used the right table, so the board and the honours
 * board, the cut, the season table and the play-off seeding named different
 * winners for the same round.
 *
 * Takes a lookup by stage rather than a single flag because points accumulate
 * ACROSS rounds, and which table applies is a property of each round.
 */
export function stablefordTableFor(
  formatOfStage: (stageId: string) => string | null | undefined,
  standard: (strokes: number, par: number, holeStrokes: number) => number,
  modified: (strokes: number, par: number, holeStrokes: number) => number,
): (strokes: number, par: number, holeStrokes: number, stageId: string) => number {
  return (strokes, par, holeStrokes, stageId) =>
    boardKind(formatOfStage(stageId)) === "modified-stableford"
      ? modified(strokes, par, holeStrokes)
      : standard(strokes, par, holeStrokes);
}
