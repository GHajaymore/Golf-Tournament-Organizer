import { holesPlayed } from "./handicap";
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
  /**
   * The club member this row IS, when one was picked from the roster.
   *
   * Absent means a GUEST: somebody's mate, playing once, who is not in the
   * club and must not be put in it. That distinction is the whole of the
   * difference — see `PlannedMatchPlayer.memberId`.
   *
   * Never trusted. It arrives from a form, so the action re-reads it against
   * the organization's own roster before using it; an id from another club
   * would otherwise attach a stranger's handicap and history to this round.
   */
  memberId?: string | null;
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
 * The money games a casual round may be set up with.
 *
 * ONE game, chosen on the first tee, and the shortness is the design again.
 * Every one of these is an existing, settled game in this app — the same pots
 * and the same engines a club's league runs on — so this adds a door, not a
 * second money system.
 *
 * `kind` is what gets written. Skins is its own model (`SkinsPot`) and the
 * others are `SideGame` rows, which is why it carries a `pot` discriminator
 * rather than everything being one enum: the storage genuinely differs, and
 * pretending otherwise here would push the difference into the action as an
 * if-statement nobody maintains.
 *
 * Anything else — a second game, a different stake, gross instead of net — is
 * on the round's own money screen the moment it exists. This is the starting
 * point, not the whole menu.
 *
 * TourneyHQ works out who owes whom. It never moves the money.
 */
export interface QuickMoneyGame {
  key: string;
  label: string;
  blurb: string;
  /** Which store this game lives in — they are different models. */
  pot: "skins" | "side";
  /** The `SideGame.kind` written for a "side" game. Unused for skins. */
  kind?: string;
  /**
   * Only offered on a head-to-head.
   *
   * A Nassau is three bets on ONE match — the front nine, the back nine and
   * the whole thing — so it needs two sides to be between. Offering it on a
   * four-person medal names a wager with no opponent in it.
   */
  matchOnly?: boolean;
  /**
   * This game settles off STROKES, so the round has to return a full card.
   *
   * The distinction that stranded a real pot. Skins compares scores hole by
   * hole and a birdie pot counts scores against par, so both read
   * `Scorecard` rows. A Nassau reads who won each hole and needs no card at
   * all — it resolves through `resolveMatch` like the match itself.
   *
   * It matters because MATCH PLAY, the default round type, is "the one format
   * that genuinely produces no card": a player tracks who won the hole and
   * stops counting once it is lost, so `inputs[0]` is "hole-results". Set up
   * a £5 skins pot on the default round, score it the way the screen offers,
   * and the match goes Final at 5&4 while the pot reads "0 skins ·
   * provisional" for ever. Measured on 2026-09-08, exactly that.
   *
   * Nothing was paid wrongly — the pot refuses to settle rather than guessing
   * — but ten pounds sat in a game that could never be decided, and nothing
   * told anybody why.
   */
  needsCards?: boolean;
  /**
   * And this game cannot be settled without the COURSE's card either.
   *
   * A different question from `needsCards`, which is about whether the round
   * returns strokes. This is about whether those strokes mean anything on
   * their own. A birdie is a score measured against PAR, so a birdie pot on a
   * round with no course behind it has nothing to count against — four cards
   * come back and the pot still cannot say who won.
   *
   * Skins is the contrast, and the reason these are two flags rather than
   * one: gross skins is "lowest score on this hole", which is decided by
   * comparing the cards to each other and needs no par at all. Net skins does
   * need the stroke index, so it is asked with the shots question rather than
   * declared here.
   *
   * `needsCourseData` answers the same question for the round's FORMAT, and it
   * cannot see side games — it reads formats and nothing else. So a gross
   * match with a birdie pot passes that check, opens score entry, takes four
   * cards, and settles nothing.
   */
  needsPars?: boolean;
}

export const QUICK_MONEY_GAMES: readonly QuickMoneyGame[] = [
  {
    key: "skins",
    label: "Skins",
    blurb: "A pot on every hole. Win one outright and you take it; tie it and it carries over.",
    pot: "skins",
    needsCards: true,
  },
  {
    key: "birdies",
    label: "Birdie pot",
    blurb: "Everyone puts in the same, and every birdie made takes a share of it.",
    pot: "side",
    kind: "birdies",
    needsCards: true,
    // A birdie is one under PAR. Without a card there is no par to be under.
    needsPars: true,
  },
  {
    /**
     * THE COMMONEST BET IN GOLF, and the one this screen had nowhere to put.
     *
     * Everything else here is a POT — everybody pays in and the cards decide
     * who takes it out. "We're playing for a tenner" is not that: it is one
     * wager between the two sides, settled by the match result.
     *
     * A Nassau is three of these on one card, so offering only the Nassau
     * meant a fourball agreeing a single stake had to describe it as three
     * bets and divide by three.
     *
     * It needs NO CARD at all — it reads who won each hole, exactly as the
     * Nassau does — which is why it is the one money game that can ride on a
     * match scored the way match play is actually played.
     */
    key: "match",
    label: "The match",
    blurb: "One bet on the match itself. The winning side takes a stake from each opponent.",
    pot: "side",
    kind: "match",
    matchOnly: true,
  },
  {
    key: "nassau",
    label: "Nassau",
    blurb: "Three bets in one: the front nine, the back nine, and the match overall.",
    pot: "side",
    kind: "nassau",
    matchOnly: true,
  },
];

/**
 * The most a casual round's stake may be, in minor units.
 *
 * £1,000 a head. Not a moral position — a Sunday game can be whatever the
 * players agree — but a typo of 50000 for 500 is a settle-up demanding a
 * hundred times what anybody said, and the app records that as fact. High
 * enough never to refuse a real game, low enough to catch a slipped decimal.
 */
export const MAX_QUICK_STAKE = 100_000;

/**
 * The longest a non-money stake may be described in.
 *
 * It is a stake, not a paragraph: "a pint", "loser buys lunch", "next green
 * fee". Long enough for the sentence anybody actually says on the tee, short
 * enough to sit on one line beside the game's name on a phone.
 */
export const STAKE_NOTE_MAX = 40;

/**
 * Why a `matchOnly` game cannot go on this round, in that game's own terms.
 *
 * It read `A ${game.label} is three bets on one match, so it needs two
 * sides` for every game that carried the flag — true of a Nassau and the
 * reason the sentence was written, and nonsense the day a second one was
 * added: "A The match is three bets on one match". One bet is not three, and
 * a refusal that misdescribes what was refused is how somebody concludes the
 * app does not know what they picked.
 */
export function matchOnlyRefusal(game: QuickMoneyGame): string {
  const what =
    game.key === "nassau"
      ? "three bets on one match"
      : "a bet between two sides";
  return `${game.label} is ${what}, so it needs an opponent. Pick another game, or play match play.`;
}

export interface QuickMoneyChoice {
  /** One of `QUICK_MONEY_GAMES`. */
  game: string;
  /** Stake per player, in minor units. */
  stakeCents: number;
  /**
   * What they are playing for INSTEAD of money.
   *
   * Set, and the stake must be zero: this is the game where the loser buys
   * lunch. The app keeps the score and declares the winner exactly as it would
   * for a tenner, and records no money at all, because there is none to
   * record. Whatever was agreed is settled between the players.
   *
   * Not the same as leaving the whole money question alone, which is what
   * `money: null` means and stays the default.
   */
  stakeNote?: string | null;
}

/** What the plan says to create, or null for a round played for nothing. */
export interface PlannedMoney {
  game: QuickMoneyGame;
  stakeCents: number;
  /** Empty for a money stake. See `QuickMoneyChoice.stakeNote`. */
  stakeNote: string;
}

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
  /**
   * WHERE IT IS PLAYED.
   *
   * REQUIRED BY THE SETUP SCREEN, and deliberately not by this function.
   * `/match/new` offered "Decide later", which is the wrong shape for an
   * impromptu round — whoever is arranging a Sunday fourball is standing
   * somewhere — and what the option actually bought was a round that could not
   * be scored: score entry refuses a round whose scoring needs a card and
   * renders "Set up this course" instead of the scorecard.
   *
   * The rule is a product decision about that SCREEN, not an invariant about
   * a plan. A gross singles match needs no card at all — `matchNeedsCard` says
   * so, and is the correctness rule. Refusing here would make this function
   * assert something that is not true of golf, and every caller and test would
   * have to carry a course to say otherwise.
   */
  courseId?: string | null;
  /** What to call it. Blank names the match after the two players. */
  name?: string | null;
  /**
   * Playing for something.
   *
   * Absent means the question was never asked — the default, and the round
   * carries no game at all. A zero stake with no note is the same thing.
   * A zero stake WITH a note is a real game played for something that is not
   * money; see `QuickMoneyChoice.stakeNote`.
   */
  money?: QuickMoneyChoice | null;
}

export interface PlannedMatchPlayer {
  name: string;
  handicap: number;
  email: string;
  seed: number;
  /**
   * The club member this player is, or "" for a guest.
   *
   * THE ONE FIELD THAT DECIDES WHETHER THE CLUB'S ROSTER IS WRITTEN TO.
   *
   * Every player in a casual round used to be pushed into the roster by
   * `upsertMember`, and that is wrong twice over. It fills a club's member
   * list with people who are not members — somebody's brother-in-law, playing
   * once — and, because a member without an email address is matched BY NAME,
   * a second different Dave entered months later lands on the first Dave's row
   * and overwrites his index.
   *
   * So a guest is now a `Player` on this event and nothing else. They can be
   * named, given a handicap, and scored; they leave no trace in the club when
   * the round is gone. A member picked from the roster keeps their id, which
   * is what makes their handicap the club's real one rather than a copy that
   * drifts.
   */
  memberId: string;
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
  /**
   * The money game to create alongside the round, or null for none.
   *
   * Null for a round played for nothing, which is the default and stays the
   * default: a screen that asks "how much?" before it asks anything else has
   * made a bet the condition of playing.
   */
  money: PlannedMoney | null;
  /**
   * What the round must ask a scorer for, or "" to let the format decide.
   *
   * Written to `Stage.scoreInput`, which `defaultEntryMode` already honours
   * above everything else — "the committee's decision beats every default
   * below it… a club that wants full cards from its match-play day gets
   * them". A money game that settles off strokes is exactly such a decision,
   * made by the players rather than a committee.
   *
   * Without it, the commonest possible setup — the default round type with a
   * fiver on the skins — creates a pot that can never settle: the entry
   * screen offers hole results, hole results write no `Scorecard`, and skins
   * has nothing to read. Measured on 2026-09-08: a match Final at 5&4 beside
   * a pot reading "0 skins · provisional".
   *
   * Empty for everything else, so a round with no money on it is scored the
   * way its format says, and a Nassau — which settles off who won each hole —
   * changes nothing.
   */
  scoreInput: string;
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
  return holesPlayed(Number(raw));
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
      memberId: (p.memberId ?? "").trim(),
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

  /**
   * NO DEFAULT ROUND TYPE. It has to be chosen.
   *
   * This fell back to the first entry, so a caller that said nothing got Match
   * Play — and the screen preselected it, so the commonest path through the
   * whole feature never asked what people were playing. That is a format and a
   * stage type decided by the app.
   *
   * It matters more here than it looks, because the round type decides three
   * things nobody sees: the stage type, the event's format, and whether a
   * fixture is drawn at all. A defaulted format is a defaulted `Round Robin`
   * with a defaulted match in it, arrived at without a question being asked.
   *
   * Refused rather than guessed, and refused with the same sentence whether
   * the choice is missing or unrecognised — "pick one of these" is the answer
   * to both, and the screen shows the list right above it.
   */
  const chosen = QUICK_ROUND_FORMATS.find((f) => f.name === (input.format ?? "").trim());
  if (!chosen) {
    return { ok: false, error: "Pick what you're playing." };
  }

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
  /**
   * The money, judged before anything is created.
   *
   * Refused rather than silently dropped at every step. A round that quietly
   * came out with no bet on it, or with a stake nobody typed, is money — and
   * this app's rule about money is that it records what people agreed, so a
   * disagreement has to be visible at the point somebody can still fix it.
   */
  const money = ((): PlannedMoney | null | { error: string } => {
    const wanted = input.money;
    if (!wanted) return null;

    const stake = Math.round(Number(wanted.stakeCents));
    const game = QUICK_MONEY_GAMES.find((g) => g.key === (wanted.game ?? "").trim());
    /**
     * PLAYING FOR SOMETHING THAT IS NOT MONEY, which most Sunday golf is.
     *
     * A pint, lunch, the next green fee, pride. The game is real, the winner
     * is real, and there is nothing for this app to count — so it is recorded
     * as a game with a zero stake and a note saying what it was for, and every
     * settler already returns nothing at zero without being told.
     */
    const note = (wanted.stakeNote ?? "").trim().slice(0, STAKE_NOTE_MAX);

    // No game and nothing staked is "playing for nothing", which is not an error.
    if (!game && !stake && !note) return null;
    if (!game) return { error: "Pick one of the money games offered." };
    /**
     * BOTH is the one thing that cannot be honoured.
     *
     * The screen makes them mutually exclusive, so this is the boundary
     * check — a `"use server"` export is a public endpoint and will be called
     * with whatever the caller likes. Refused rather than resolved, because
     * either resolution invents an agreement: dropping the stake loses money
     * somebody typed, and dropping the note records money nobody agreed to.
     */
    if (note && stake > 0) {
      return { error: "Playing for money or playing for something else — not both. Pick one." };
    }
    if (note) {
      if (game.matchOnly && !headToHead) return { error: matchOnlyRefusal(game) };
      return { game, stakeCents: 0, stakeNote: note };
    }
    // A game chosen with no stake is a bet for nothing, which is the one
    // combination that looks deliberate and settles to zero for everybody.
    if (!Number.isFinite(stake) || stake <= 0) {
      return {
        error: `How much is the ${game.label.toLowerCase()} for? Put a stake in, or say what you're playing for instead.`,
      };
    }
    if (stake > MAX_QUICK_STAKE) {
      return { error: "That stake looks like a slipped decimal. Check it before starting the round." };
    }
    if (game.matchOnly && !headToHead) return { error: matchOnlyRefusal(game) };
    return { game, stakeCents: stake, stakeNote: "" };
  })();

  if (money && "error" in money) return { ok: false, error: money.error };

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
      money,
      /**
       * A card, when the money needs one — and nothing otherwise.
       *
       * `"gross-cards"` is a `MatchEntryMode` and one of match play's own
       * declared inputs, so this asks the format for something it already
       * offers rather than overriding it with a shape it cannot score.
       * `resolveScoreInput` ignores anything a format does not list, which is
       * what makes this safe to set on a round type that produces a card
       * anyway: stroke play's only input IS the card, so the value is a no-op
       * there rather than a second opinion.
       */
      scoreInput: money?.game.needsCards ? "gross-cards" : "",
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
