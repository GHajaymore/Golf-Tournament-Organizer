/**
 * A PLAYER WITH NO HANDICAP INDEX, IN A ROUND SCORED NET — the one rule, and the words every screen says
 * about it (lane N, PR A; design `design-no-index-net.md`, 14 Nov 2026).
 *
 * The finding: nothing in the app asked. A member whose roster says "no index" (`handicapSource: "none"`)
 * is stored with a handicap of 0, the pricing chain reads that 0, and the player is scored as a scratch
 * golfer in every net, Stableford and match round — with no notice to anybody.
 *
 * What the Rules say. A Course Handicap is worked from a Handicap Index (Rules of Handicapping 6.1); with
 * none there is nothing to work from, and nought is not "none" — it is a scratch golfer's index. In a
 * handicap competition it is the Committee that works out the player's strokes (Rules of Golf 3.3b(4),
 * as worded since 2023). So the strokes are the committee's to give, and the app asks the committee and
 * nobody else. What it gives is a Course Handicap for that round in whole strokes
 * (`RoundHandicap.override`), never an index typed onto the player: the roster keeps saying "no index",
 * which is true.
 *
 * ONE FUNCTION decides who needs strokes (`needsCommitteeFigure`), and every screen that mentions it asks
 * it: the band on Rounds & formats, the launch warning, What's next, the setup rail, the notes on the
 * doors players come in by, and Replace on the tee sheet. `no-index-is-asked-in-one-place.test.ts`
 * refuses a second copy.
 *
 * TWO SETS OF WORDS, ONE SWITCH (`SINK_LIVE`, the panel's amendment 12.1). Until the pricing chain stops
 * scoring a player with no figure (PR B), such a player IS scored off 0, and the words say exactly that:
 * "scored as scratch, off 0". PR B flips `SINK_LIVE` in the commit that makes the other set true ("their
 * cards wait, with no net score"). Every builder takes `sinkLive` as a REQUIRED argument, so no screen
 * can print one set while the app does the other.
 *
 * On a screen, the committee is "you" to staff and "the organizer" to everybody else (the panel, 12.1).
 *
 * Pure: no clock, no database.
 */

import { hasIndex, parseStrokesInput } from "./handicap-label";
import { isNetBasis } from "./match-entry";

/**
 * WHETHER THE PRICING CHAIN STOPS AT A PLAYER WITH NO FIGURE. False in PR A: the chain still reads the
 * stored 0. PR B sets it true in the same commit as the sink (`committee-figure.test.ts` pins it).
 */
export const SINK_LIVE: boolean = false;

/** The band's anchor on Rounds & formats; every link to it lands here with the first box focused. */
export const NEEDS_STROKES_ANCHOR = "needs-strokes";

/**
 * THE RULE. True when this player, in this round, has nothing a net score can be worked from and the
 * committee has not given them strokes:
 *
 *   - the round is scored net (`isNetBasis`: net, both, Stableford, a match with strokes) — a gross
 *     round asks nothing of anybody;
 *   - the player has no handicap index (`hasIndex`);
 *   - and the round holds no figure for them: no committee figure (`override`) and nothing frozen. A
 *     round already played keeps what it was played off, as every frozen round does.
 *
 * Every argument is required, so the compiler lists every caller the day the rule grows.
 */
export function needsCommitteeFigure(
  round: { scoringBasis: string },
  player: { handicapSource: string | null },
  row: { override: number | null; frozen: number | null } | null,
): boolean {
  return isNetBasis(round.scoringBasis) && !hasIndex(player) && row?.override == null && row?.frozen == null;
}

/**
 * THE LIST AS ONE FACT — how many players, and in which rounds — for the launch warning and the setup
 * rail. Built from `playersNeedingFigure`'s rounds (services/committee-figure.ts) by `needsStrokesFact`.
 * Null when nobody needs strokes, and always for a gross-only tournament.
 */
export interface NeedsStrokes {
  /** Distinct players across the rounds. */
  players: number;
  /** The rounds' labels, in play order. */
  rounds: string[];
}

export function needsStrokesFact(rounds: readonly { label: string; players: readonly { id: string }[] }[]): NeedsStrokes | null {
  const asking = rounds.filter((r) => r.players.length > 0);
  if (asking.length === 0) return null;
  const who = new Set(asking.flatMap((r) => r.players.map((p) => p.id)));
  return { players: who.size, rounds: asking.map((r) => r.label) };
}

/** "3 players", "1 player". */
const players = (n: number) => `${n} ${n === 1 ? "player" : "players"}`;
/** "Round 1", "Round 1 and Round 2", "Round 1, Round 2 and Round 3". */
export function roundsSaid(labels: readonly string[]): string {
  const names = labels.map((l) => l || "A round");
  if (names.length <= 1) return names[0] ?? "this round";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * WHAT HAPPENS TO THEM UNTIL STROKES ARE GIVEN — the one clause both sets differ in. `who` is "you"
 * (staff) or "the organizer".
 */
function untilSaid(sinkLive: boolean, who: "you" | "the organizer"): string {
  const give = who === "you" ? "you give them strokes" : "the organizer gives them strokes";
  return sinkLive
    ? `Their cards wait, with no net score, until ${give}.`
    : `Until ${give} they are scored as scratch, off 0.`;
}

/**
 * THE NOTE A DOOR SHOWS after its own write (Entries, a late entry, a CSV import, the roster pick), and
 * the launch row's sentence. Never a refusal: a handicap often arrives on the morning.
 *
 * `canGive` is whether this viewer may give strokes (staff of the tournament, which is what
 * `setRoundHandicapOverride` asks). With it, the sentence talks to "you" and the screen draws the link
 * (`link`); without it the sentence names who gives strokes and carries no link (the panel, 12.5).
 */
export function needsFigureSaid(args: {
  count: number;
  rounds: readonly string[];
  canGive: boolean;
  sinkLive: boolean;
}): { text: string; link: boolean } {
  const { count, rounds, canGive, sinkLive } = args;
  const have = count === 1 ? "has" : "have";
  const is = rounds.length === 1 ? "is" : "are";
  const text =
    `${players(count)} ${have} no handicap index and ${roundsSaid(rounds)} ${is} scored net. ` +
    untilSaid(sinkLive, canGive ? "you" : "the organizer");
  return { text, link: canGive };
}

/** The link's words, wherever `needsFigureSaid` draws one. */
export const GIVE_STROKES = "Give strokes";

/** What stands where a number would be, for a player who needs strokes and has none (PR B prints it). */
export const NO_FIGURE_YET = "no handicap yet";

/**
 * THE SECRETARY'S HOME (What's next): "3 players need strokes from you for Round 1 (Sat 21 Nov)". `day`
 * is the round's day already written in the club's words, or "" when it has none.
 */
export function strokesJobSaid(count: number, round: string, day: string): string {
  const need = count === 1 ? "1 player needs" : `${count} players need`;
  return `${need} strokes from you for ${round || "a round"}${day ? ` (${day})` : ""}`;
}

/**
 * THE SETUP RAIL'S TO-DO for the same fact (as `unratedTeesTodo` is for tees): one line, never a hold.
 */
export function needsFigureTodo(count: number, rounds: readonly string[], sinkLive: boolean): string {
  const lead = `Give strokes to the ${count === 1 ? "player" : `${count} players`} with no handicap index in ${roundsSaid(rounds)}.`;
  return sinkLive ? `${lead} Their cards wait until you do.` : `${lead} Until you do they are scored as scratch, off 0.`;
}

/** The band's heading: "3 players need strokes for Round 1." */
export function bandHeadingSaid(count: number, round: string): string {
  return `${count === 1 ? "1 player needs" : `${count} players need`} strokes for ${round}.`;
}

/**
 * The band's lead sentence. `basis` is the round's own words for how it is scored (the tile's words, so
 * the band and the round card cannot name it differently — the panel's S4).
 */
export function bandLeadSaid(basis: string, sinkLive: boolean): string {
  return `They have no handicap index, and this round is scored ${basis}. You decide how many strokes. ${untilSaid(sinkLive, "you")}`;
}

/** When the band has nobody left: said, then the band goes. */
export const bandEmptySaid = (round: string) => `Everyone in ${round} has a handicap.`;

/** The band's box: what it holds, in the words the panel chose (12.3). */
export const bandBoxLabel = (round: string) => `Strokes for ${round} (whole number, 0 to 54)`;

/** The band's limit. Wider figures (a plus figure) are given in the full list under Handicaps for this round. */
export const BAND_MIN = 0;
export const BAND_MAX = 54;
export const BAND_REFUSAL = "Whole strokes from 0 to 54. 12, not 12.4.";

/**
 * WHAT THE BAND'S BOX HOLDS, read before the press: whole strokes from 0 to 54, through the one reader
 * of a round's strokes (`parseStrokesInput`) and then the band's own narrower range. Null for an empty
 * box (nothing to say yet).
 */
export function bandStrokes(raw: string): { ok: true; value: number } | { ok: false; error: string } | null {
  if (raw.trim() === "") return null;
  if (raw.trim().startsWith("+")) return { ok: false, error: BAND_REFUSAL };
  const read = parseStrokesInput(raw);
  if (!read.ok) return { ok: false, error: BAND_REFUSAL };
  if (read.value < BAND_MIN || read.value > BAND_MAX) return { ok: false, error: BAND_REFUSAL };
  return read;
}

/**
 * AFTER GIVE: "18 strokes, given by you. At 95% plays off 17 in Round 1." `playing` comes from the
 * board's own calculation (`playingHandicapPartsInRound`), never from arithmetic on the screen.
 */
export function figureGivenSaid(args: { name: string; strokes: number; playing: number; allowance: number; round: string }): string {
  const { name, strokes, playing, allowance, round } = args;
  const given = `${name}: ${strokes} ${strokes === 1 ? "stroke" : "strokes"}, given by you.`;
  const off = playing === 0 ? "scratch" : playing < 0 ? `+${Math.abs(playing)}` : String(playing);
  return allowance === 100 ? `${given} Plays off ${off} in ${round}.` : `${given} At ${allowance}% plays off ${off} in ${round}.`;
}

/** Before the press, under a typed figure: the same consequence, so "18" can be checked either way. */
export function figurePreviewSaid(args: { strokes: number; playing: number; allowance: number; round: string }): string {
  const { strokes, playing, allowance, round } = args;
  const off = playing === 0 ? "scratch" : playing < 0 ? `+${Math.abs(playing)}` : String(playing);
  const s = `${strokes} ${strokes === 1 ? "stroke" : "strokes"}`;
  return allowance === 100 ? `${s}: plays off ${off} in ${round}.` : `${s}. At this round's ${allowance}% plays off ${off} in ${round}.`;
}

/** A figure typed and not given yet, and a Give that failed (the panel, 12.2). */
export const NOT_SAVED_YET = "Not saved yet";
export const NOT_SAVED_TRY_AGAIN = "Not saved. Try again.";

/**
 * A ROW WHOSE ROUND ALREADY HAS A CARD IN. True in PR A, where a round's handicaps are fixed at its first
 * card (`setRoundHandicapOverride` refuses): the band says so instead of offering a box the server will
 * refuse. PR B lets the strokes be given late and changes this sentence in the same commit.
 */
export const cardsInSaid = (name: string, round: string) =>
  `A card is in for ${round}, so its handicaps are fixed: ${name} is scored as scratch, off 0, there.`;
