/**
 * A match between two people, planned from the little the two of them know.
 *
 * The rest of this app is built for a tournament — a field, flights, a
 * sequence of rounds, a leaderboard. That is the right shape for the club
 * championship and the wrong shape for the commonest game in golf: two people
 * on the first tee who want to play each other.
 *
 * Walked end to end on 2026-09-07, setting one up meant six screens: pick a
 * "tournament shape" (none of which is a match), pick a "kind of tournament"
 * (none of which is a match), enter your opponent — WITH an email address and
 * a mobile number, both refused if blank — generate "flights" of two, change
 * the round's format from Stroke Play to Match Play, and then supply a full
 * scorecard with par and stroke index, because the stroke play you did not
 * ask for needs one and the match play you did would not have. Every one of
 * those is defensible for a club running a championship. Together they are why
 * somebody gave up and played without the app.
 *
 * So this module is the whole of the decision, in one place: given two names
 * and a couple of choices, what does the app create? It is pure, so the answer
 * is testable without a database, and the server action that writes the rows
 * makes no decisions of its own.
 *
 * What it deliberately does NOT do is relax anything for the tournament path.
 * A championship entrant still needs an address — that is how they sign in and
 * how they are messaged. A friend you are playing on Sunday needs neither,
 * because you are standing next to them and you are the one entering the card.
 */

/** The most a WHS Handicap Index can be, and the best a plus-handicap gets
 *  anywhere near. Stated as a range because a typo of 180 for 18.0 must not
 *  become a player receiving a stroke and a half a hole. */
export const HANDICAP_MIN = -10;
export const HANDICAP_MAX = 54;

export interface MatchPlayerInput {
  name: string;
  /** As typed. A blank, a stray "+2" or nonsense all mean "not stated". */
  handicap?: string | number | null;
  /** Optional, and optional on purpose — see the note at the top of the file. */
  email?: string | null;
}

/**
 * The formats a casual round may be set to.
 *
 * A deliberately short list, and short for the same reason the whole module
 * exists: this screen is for somebody standing on the first tee, not an
 * organizer choosing between eighteen formats. Every `name` here is a real
 * entry in `formats.ts` and every one is `playable` there — an engine, score
 * entry and a board — which the test asserts against the catalogue rather than
 * trusting this file to have been right about it.
 *
 * ONE list, not two questions. The obvious alternative was to ask "individual
 * or pairs?" and then "match play or stroke play?", which is a grid of cells
 * of which several are not games anybody plays. A named round type is a
 * complete answer, and `sideSize` is what the APP needs to know rather than
 * what the player has to be asked.
 *
 * The list stops where the apparatus starts. A scramble is missing because its
 * allowance is a weighted table over an ability order nobody has ranked on
 * this screen, and anything at three sides or more is missing because that is
 * a competition with a draw in it — which is what the tournament builder is
 * for, and what the link at the bottom of the screen offers.
 */
export interface QuickRoundFormatOption {
  /** Must name a `playable` format in `formats.ts` — it is written to
   *  `Stage.format` and read back by `lookupFormat`. */
  name: string;
  blurb: string;
  /**
   * Players per side. 1 is an individual round; 2 is a pairs round.
   *
   * The whole of "individual or pairs", answered where the round type is
   * chosen rather than asked as a second question. It decides how many names
   * the screen takes, whether `Team` rows are written, and which pair of
   * columns on `Match` holds the sides.
   */
  sideSize: number;
  /**
   * The SIDES play each other, rather than each returning a card.
   *
   * The one fact everything structural about the round follows from: the stage
   * type, the event's format, how many players are required, and whether a
   * fixture is drawn at all. Stated once, here, because the four of them
   * getting different answers is exactly
   * the failure `stage-types.ts` describes — a round robin set to stroke play,
   * with a full set of pairings for a round in which nobody plays anybody.
   */
  headToHead?: boolean;
}

export const QUICK_ROUND_FORMATS: readonly QuickRoundFormatOption[] = [
  {
    name: "Match Play",
    blurb: "Hole by hole, one against one. Most holes won takes it.",
    sideSize: 1,
    headToHead: true,
  },
  {
    name: "Stroke Play",
    blurb: "Everyone returns a card. Fewest shots wins.",
    sideSize: 1,
  },
  {
    name: "Modified Stableford",
    blurb: "Points per hole, so a blow-up hole costs you one bad score rather than the round.",
    sideSize: 1,
  },
  {
    name: "Four-Ball",
    blurb: "Two against two. Everyone plays their own ball, and the better score of each pair counts on every hole.",
    sideSize: 2,
    headToHead: true,
  },
  {
    name: "Foursomes",
    blurb: "Two against two, one ball per pair, alternating shots.",
    sideSize: 2,
    headToHead: true,
  },
];

/** A match is between two sides. Not a setting — the definition of the word. */
export const SIDES_IN_A_MATCH = 2;

/**
 * How many players this round type needs, when it needs an exact number.
 *
 * DERIVED rather than stored, which is the whole of the improvement. It was an
 * `exactPlayers: 2` written next to match play, and the moment a second
 * head-to-head entry needed a different number that hand-kept figure and the
 * rule it stands for come apart. A match has exactly two sides, so a singles
 * match is two people and a pairs match is four, and neither is a number
 * anybody has to remember to update.
 *
 * Null for a round that returns cards, which has a RANGE rather than a number.
 */
export function exactPlayersFor(f: QuickRoundFormatOption): number | null {
  return f.headToHead ? f.sideSize * SIDES_IN_A_MATCH : null;
}

/**
 * How a head-to-head at this side size is described out loud.
 *
 * Written out because the arithmetic version is not English. Composing the
 * sentence from the numbers gave "Match Play is played between two sides of 1
 * — that is 2 players", which is correct, unreadable, and the first thing on
 * the screen when it opens. Golf has words for both of these and they are the
 * words the players use on the tee.
 *
 * Falls back to the arithmetic for a size nobody has named, which is the safe
 * direction: clumsy beats wrong, and the list is five entries long.
 */
export function headToHeadPhrase(sideSize: number): string {
  if (sideSize === 1) return "one against one";
  if (sideSize === 2) return "two against two";
  return `${sideSize} a side`;
}

/**
 * The sides, in the order the names were entered.
 *
 * Entry order and nothing cleverer — no balancing by handicap, no draw. Four
 * people who have decided who they are playing with typed themselves in that
 * order, and a screen that then rearranged them would be answering a question
 * nobody asked. The form says which pairing it will make, above the names,
 * so the rule is visible before it is applied rather than discovered on the
 * first tee.
 */
export function sidesFrom<T>(players: T[], sideSize: number): T[][] {
  if (sideSize <= 1) return [];
  const out: T[][] = [];
  for (let i = 0; i + sideSize <= players.length; i += sideSize) {
    out.push(players.slice(i, i + sideSize));
  }
  return out;
}

/**
 * The format name as stored on the round.
 *
 * A plain string rather than a union of the three above, because it is written
 * to `Stage.format` and read back by `lookupFormat` — the catalogue in
 * `formats.ts` is the authority on what a format IS, and narrowing it here
 * would make this table a second one.
 */
export type QuickRoundFormat = string;

/**
 * How many can play a casual round.
 *
 * Two is the floor because a round nobody is playing against is a practice
 * round, and this screen is for a competitive one. Eight is the ceiling: two
 * fourballs is the most that goes out together, and past it somebody is
 * running a competition and wants the field, flights and tee sheet the
 * tournament builder has.
 */
export const QUICK_ROUND_MIN_PLAYERS = 2;
export const QUICK_ROUND_MAX_PLAYERS = 8;

export interface MatchSetupInput {
  players: MatchPlayerInput[];
  /** One of `QUICK_ROUND_FORMATS`. Anything else is refused by name. */
  format?: string | null;
  /** 18 or 9. Anything else is a caller mistake and becomes 18. */
  holes?: number | string | null;
  /** Which nine, when nine is played. */
  nine?: string | null;
  /** Whether strokes are given. Off means the match is played level. */
  useHandicaps?: boolean;
  courseId?: string | null;
  /** What to call it. Blank names the match after the two players. */
  name?: string | null;
}

export interface PlannedMatchPlayer {
  name: string;
  handicap: number;
  email: string;
  seed: number;
  /**
   * Which side this player is on, zero-based, or -1 in an individual round.
   *
   * -1 rather than 0 on purpose: 0 is a real side, and a bug that left every
   * player on side 0 in a pairs round would put four people on one team and
   * nobody on the other, which is a fixture that cannot be scored and looks
   * plausible in the database.
   */
  side: number;
}

/** One side of a pairs round: what to call it, and who is on it. */
export interface PlannedSide {
  /** "Alex & Sam" — how the two of them would refer to themselves. */
  name: string;
  /** Seeds of its members, in entry order. Order is not cosmetic: foursomes
   *  alternate who tees off, so a side is a sequence rather than a set. */
  seeds: number[];
}

export interface MatchPlan {
  name: string;
  players: PlannedMatchPlayer[];
  holes: 9 | 18;
  nine: "full" | "front" | "back";
  /**
   * The round's format.
   *
   * This was "Match Play, always", on the reasoning that offering a choice
   * would reintroduce the step that sent an organizer away with stroke play.
   * That was right when the screen made exactly one thing — a match between
   * two — and wrong as soon as it makes a ROUND: three friends who want a
   * Stableford are not helped by being given match play and a link to the
   * tournament builder.
   *
   * The choice is safe now because the list is three long and every entry is
   * playable end to end. What sent that organizer away was not being ASKED,
   * it was being asked to choose from eighteen and then being given a format
   * with nowhere to enter a card.
   */
  format: QuickRoundFormat;
  /**
   * The round's TYPE, which is not its format.
   *
   * A medal round is a "Stroke Play Round" and draws no pairings: the field
   * goes out and returns cards, and nobody is playing "against" anyone.
   * `stage-types.ts` records what happens when the two are confused — the
   * only way to run a medal used to be a Round Robin set to Stroke Play,
   * "which generated a full set of pairings for a round in which nobody plays
   * anybody".
   *
   * So match play gets the round robin it has always had, and everything else
   * gets the type that means cards.
   */
  stageType: "Round Robin" | "Stroke Play Round";
  /**
   * What the EVENT is scored as — `Event.format`, not the round's.
   *
   * It defaults to "match" in the schema, and `isStroke` is
   * `event.format === "stroke"` and nothing else: the stage's format does not
   * set it. A stroke round created without this has no ranked standings at
   * all, so the board is empty and the honours board reports "no ranked
   * results" for a round three people just played.
   */
  eventFormat: "match" | "stroke";
  /**
   * Whether the round is a head-to-head that needs a fixture drawn.
   *
   * True only for match play. A stroke round with a `Match` row in it is a
   * fixture nobody played, sitting in the schedule and countable as a result.
   */
  drawsMatch: boolean;
  /** Players per side: 1 for an individual round, 2 for pairs. */
  sideSize: number;
  /**
   * The sides, or empty for an individual round.
   *
   * Empty rather than "one side per player", which was the other candidate and
   * is worse in the way that matters: the action asks `sides.length > 0` to
   * decide whether to write `Team` rows at all, and a singles round carrying
   * eight one-person teams would fill the fixture's TEAM columns instead of
   * its player columns. The schema's own comment says what that costs — "a
   * column whose meaning depends on the round's format is the kind of thing
   * that silently mis-joins a year later".
   */
  sides: PlannedSide[];
  scoringBasis: "gross" | "net";
  courseId: string | null;
}

export type MatchPlanResult = { ok: true; plan: MatchPlan } | { ok: false; error: string };

/**
 * A handicap as a number, or 0 for anything that isn't one.
 *
 * Zero rather than a refusal: "I don't know my handicap" is the normal state
 * of half the people who play a Sunday match, and stopping the whole setup to
 * demand one would be the same species of obstacle this module exists to
 * remove. A match played off zeros is a match played level, which is what
 * happens on the tee anyway.
 *
 * Plus-handicaps arrive as "+2" from a player writing what is on their card,
 * and a plus-handicap is BETTER than scratch — it is negative in every
 * calculation. Reading "+2" as 2 would hand two shots to the best player in
 * the match.
 */
export function parseHandicap(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return clampHandicap(raw);
  const text = (raw ?? "").trim();
  if (!text) return 0;
  const plus = /^\+/.test(text);
  const n = Number(text.replace(/^\+/, ""));
  if (!Number.isFinite(n)) return 0;
  return clampHandicap(plus ? -Math.abs(n) : n);
}

function clampHandicap(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // One decimal, which is the precision a Handicap Index is published to.
  const rounded = Math.round(n * 10) / 10;
  return Math.min(HANDICAP_MAX, Math.max(HANDICAP_MIN, rounded));
}

/** 18 unless nine was actually asked for. */
function planHoles(raw: number | string | null | undefined): 9 | 18 {
  return Number(raw) === 9 ? 9 : 18;
}

/**
 * Which nine, forced to "full" over eighteen holes.
 *
 * Enforced here rather than trusted from the form, because "the back nine" on
 * an eighteen-hole round is not a preference the app can honour — it is a
 * contradiction, and one that survives into the scorecard as holes scored
 * against the wrong stroke indexes. The setting only means anything when nine
 * holes are played.
 */
function planNine(raw: string | null | undefined, holes: 9 | 18): "full" | "front" | "back" {
  if (holes !== 9) return "full";
  return raw === "front" || raw === "back" ? raw : "full";
}

/** "Alex v Sam" — what the two of them would call it. */
export function matchTitle(a: string, b: string): string {
  return `${a} v ${b}`;
}

/**
 * "Alex & Sam" — what a pair would call themselves.
 *
 * An ampersand and not "v", which is the one substitution that would turn a
 * side's name into a fixture's. `Team.name` is rendered on the card, the
 * board and the entry screen, so a side called "Alex v Sam" reads as a match
 * inside a match everywhere it appears.
 */
export function sideName(names: string[]): string {
  return names.join(" & ");
}

export function planMatch(input: MatchSetupInput): MatchPlanResult {
  const named = (input.players ?? [])
    .map((p) => ({
      name: (p.name ?? "").trim(),
      handicap: parseHandicap(p.handicap),
      email: (p.email ?? "").trim().toLowerCase(),
    }))
    .filter((p) => p.name.length > 0);

  if (named.length < QUICK_ROUND_MIN_PLAYERS) {
    return { ok: false, error: "A round needs at least two players — add another name." };
  }
  if (named.length > QUICK_ROUND_MAX_PLAYERS) {
    return {
      ok: false,
      error: `That is more than ${QUICK_ROUND_MAX_PLAYERS} players. For a bigger field, create a tournament.`,
    };
  }

  const format = QUICK_ROUND_FORMATS.find((f) => f.name === (input.format ?? "").trim());
  if (input.format && !format) {
    return { ok: false, error: "Pick one of the round types offered." };
  }
  const chosen = format ?? QUICK_ROUND_FORMATS[0];

  /**
   * A match is between two sides, so the number of players is not a choice.
   *
   * Asked of the round type rather than decided here, so a new head-to-head
   * entry in the table above needs no branch in this function: singles wants
   * two people and pairs wants four, and both fall out of `sideSize`.
   */
  const exact = exactPlayersFor(chosen);
  if (exact !== null && named.length !== exact) {
    return {
      ok: false,
      error: `${chosen.name} is played ${headToHeadPhrase(chosen.sideSize)}, so it needs exactly ${exact} players — there ${named.length === 1 ? "is" : "are"} ${named.length}.`,
    };
  }

  /**
   * A pairs round with somebody left over is a pairs round nobody can play.
   *
   * Only reachable for a round type that returns cards; a head-to-head has
   * already been pinned to an exact number above. Refused rather than
   * silently dropping the odd player, which is the version that puts somebody
   * on the tee holding a card the app has no side for.
   */
  if (chosen.sideSize > 1 && named.length % chosen.sideSize !== 0) {
    return {
      ok: false,
      error: `${chosen.name} is played in ${chosen.sideSize}s, so it needs an even number of players — there are ${named.length}.`,
    };
  }

  /**
   * Everybody told apart by name.
   *
   * Not fussiness: a card is read back as a name per player, so two
   * identically named entries produce a round on which neither the organizer
   * nor the engine can say whose hole was whose. It was a two-player check
   * and is now a check across the whole list, because a fourball with two
   * Daves has exactly the same problem — the one #202 was about.
   *
   * Compared case-insensitively, because "sam" and "Sam" are the same person
   * typing quickly rather than two people.
   */
  const seen = new Map<string, string>();
  for (const p of named) {
    const key = p.name.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      /**
       * Named as FIRST entered, not as the duplicate was typed.
       *
       * The two spellings differ by definition — that is what made this a
       * case-insensitive check — and "both called dave" is the version the
       * person did not type, which reads like the app misheard them. The row
       * they are looking for on the screen says "Dave".
       */
      return {
        ok: false,
        error: `Two players are both called ${first} — give them something to tell them apart.`,
      };
    }
    seen.set(key, p.name);
  }

  const holes = planHoles(input.holes);
  /**
   * Three structural answers, all from the one fact in the table.
   *
   * Derived together, in one place, so they cannot disagree. Written out as
   * separate branches this is four lines; as three separate `=== "Match Play"`
   * checks scattered through the action it is the bug in `stage-types.ts`
   * waiting to be reintroduced.
   */
  const headToHead = chosen.headToHead === true;

  /**
   * The sides, and every player's place in one.
   *
   * Built from the same `sidesFrom` the screen shows above the name fields, so
   * the pairing an organizer was told about is the pairing that gets written.
   * Empty for an individual round — see the note on `MatchPlan.sides` for why
   * that is not "one side each".
   */
  const grouped = sidesFrom(named, chosen.sideSize);
  const sideOf = new Map<string, number>();
  grouped.forEach((side, i) => side.forEach((p) => sideOf.set(p.name.toLowerCase(), i)));
  const sides: PlannedSide[] = grouped.map((side) => ({
    name: sideName(side.map((p) => p.name)),
    seeds: side.map((p) => named.indexOf(p) + 1),
  }));

  /**
   * What to call it, in the words the players would use.
   *
   * A pairs match is "Alex & Sam v Pat & Jo" — the sides, not the four names
   * in a row, because "Alex v Sam v Pat v Jo" describes a game that does not
   * exist. A medal is named after whoever entered it first, because there is
   * no opposition to name it against.
   */
  const title =
    (input.name ?? "").trim() ||
    (sides.length === SIDES_IN_A_MATCH
      ? matchTitle(sides[0].name, sides[1].name)
      : named.length === SIDES_IN_A_MATCH
        ? matchTitle(named[0].name, named[1].name)
        : `${named[0].name} and ${named.length - 1} others`);

  return {
    ok: true,
    plan: {
      name: title,
      players: named.map((p, i) => ({
        ...p,
        seed: i + 1,
        side: sideOf.get(p.name.toLowerCase()) ?? -1,
      })),
      sideSize: chosen.sideSize,
      sides,
      holes,
      nine: planNine(input.nine, holes),
      format: chosen.name,
      stageType: headToHead ? "Round Robin" : "Stroke Play Round",
      eventFormat: headToHead ? "match" : "stroke",
      drawsMatch: headToHead,
      // Gross when nobody asked for strokes. A level match is the default
      // because it is the one that needs no handicap to be correct — a net
      // match with two zeros is a level match that claims to be something
      // else.
      scoringBasis: input.useHandicaps ? "net" : "gross",
      courseId: (input.courseId ?? "").trim() || null,
    },
  };
}

/**
 * Does this match need the course's card before it can be scored?
 *
 * Only a net match does. Strokes are given by stroke index, so a net match
 * without a card cannot allocate them and would quietly score as gross. A
 * level match needs nothing: who won the hole is not a question par can help
 * with, which is exactly why the setup screen asks for a course last and never
 * insists on it.
 */
export function matchNeedsCard(plan: Pick<MatchPlan, "scoringBasis">): boolean {
  return plan.scoringBasis === "net";
}
