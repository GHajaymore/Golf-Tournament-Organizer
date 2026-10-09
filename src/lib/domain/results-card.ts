/**
 * What goes on the picture that unfurls when somebody shares a leaderboard.
 *
 * Paste a TourneyHQ link into WhatsApp, Slack, iMessage or a group chat and
 * the app fetches an image for it. Today that is nothing, so the club's link
 * looks like every other bare URL. It should be the standings — which is the
 * one piece of marketing that costs a club no effort at all, because sharing
 * the board is something they already do on a Sunday evening.
 *
 * TWO RULES, AND THE FIRST ONE OUTRANKS THE SECOND.
 *
 * 1. It must never show what the board itself would not. A share-link preview
 *    is fetched by servers the club never chose — Meta, Slack, Apple — and
 *    cached by them. So a card for a tournament whose board is not public
 *    carries no names, no scores, and not even the tournament's name, exactly
 *    as `generateMetadata` already refuses to. A blind event stays blind.
 *
 * 2. Within that, be worth looking at. A leader and the players around them,
 *    with real numbers.
 *
 * Pure, so the decision about what may be shown is tested on its own rather
 * than inferred from a rendered PNG.
 */

import { todaysThru } from "./scoreboard";
import { rankedScore, unitIsNet, type RankedRow } from "./ranked-score";
import { placesByValue } from "./flight-places";
import { valueOnBasis, type WeekBasis } from "./week-basis";

/** A standings row, narrowed to what a share card can use. */
export interface CardRow {
  rank: number;
  /** "1", "T3" — as the board prints the place. */
  place: string;
  name: string;
  /** Pre-formatted score for this format: "-4", "+2", "15 pts", "3-0-0". */
  score: string;
  /** "F", "14", or empty when the format has no through-count. */
  thru: string;
}

export type ResultsCard =
  | {
      /** The board is public: the standings may be shown. */
      kind: "standings";
      club: string;
      event: string;
      subtitle: string;
      rows: CardRow[];
      /** How many more are in the field below the rows shown. */
      more: number;
      live: boolean;
      /** Said instead of rows where the board draws matches or a bracket. */
      note: string;
    }
  | {
      /**
       * The board is not public. Branded, truthful, and empty of everything
       * the link itself would not disclose.
       */
      kind: "private";
      headline: string;
      subtitle: string;
    };

/**
 * How many players fit before the card stops being readable at a glance.
 *
 * A share preview is looked at for about a second, often as a thumbnail in a
 * chat list. Five rows is a leader, a chase and a cut-off; twenty is a table
 * nobody reads and a leader nobody can find.
 */
export const CARD_ROWS = 5;

const clean = (s: string): string => (typeof s === "string" ? s.trim() : "");

/**
 * Trim a name to fit without letting it become anonymous.
 *
 * Truncation happens at a word boundary where one is available, because
 * "Christopher A. Wetherby-…" is a person and "Christoph…" is a typo. A name
 * with no spaces long enough to overflow is cut with an ellipsis, which is
 * still better than pushing the score off the card.
 */
export function fitName(raw: string, max = 22): string {
  const name = clean(raw);
  if (name.length <= max) return name;
  const cut = name.slice(0, max);
  const space = cut.lastIndexOf(" ");
  if (space >= max - 8) return `${cut.slice(0, space)}…`;
  return `${cut.slice(0, max - 1)}…`;
}

export interface BoardForCard {
  name: string;
  dates: string;
  venue: string;
  roundLabel: string;
  rows: Array<{
    rank: number;
    name: string;
    ranked?: boolean;
    toPar?: string | number | null;
    points?: string | number | null;
    record?: string | null;
    thru?: string | number | null;
    /** Whether the row has a result yet — see `RankedRow`. */
    started?: boolean;
    /** The board's own fields for "how far round" — see `cardThru`. */
    holesOwed?: number;
    roundThru?: number;
    roundHoles?: number;
    missedCut?: string;
    missedRound?: string;
    withdrew?: boolean;
    disqualified?: boolean;
    absent?: boolean;
  }>;
  /** What the board ranks on, as `LiveBoardView` says it — see `scoreOf`. */
  isStroke?: boolean;
  isStableford?: boolean;
  unit?: string;
  /** The committee has made it official — see `LiveBoardView.official`. */
  official?: boolean;
  /** Every card expected is complete. */
  allIn?: boolean;
  /** See `rowsForBoardKind`: where the result is, when it is not rows. */
  note?: string;
}

/**
 * HOW FAR ROUND, READ THE WAY THE BOARD READS IT (2026-10-09).
 *
 * The live board's rows carry a NUMBER — `thru: 18, holesOwed: 18` — and the
 * board turns that into "F". This card read the number raw, so a finished
 * tournament's preview printed "18" where the page says F, "36 / 27" on a
 * board reading "F / thru 9", and — because "F" never appeared — called every
 * finished tournament Live. Its tests passed on rows carrying "F" strings,
 * which the real board never sends. So a numeric row goes through
 * `todaysThru`, the board's own reader; a string row is taken as written.
 */
export function cardThru(row: BoardForCard["rows"][number]): string {
  if (typeof row.thru === "number" && typeof row.holesOwed === "number") {
    const t = todaysThru({ ...row, thru: row.thru, holesOwed: row.holesOwed }, row.holesOwed);
    if (t.thru <= 0) return "";
    return t.thru >= t.owed ? "F" : String(t.thru);
  }
  return thruOf(row.thru);
}

/**
 * A TEAM ROUND'S SIDES, AS CARD ROWS (2026-10-09, T72).
 *
 * A team round files its result per SIDE, so the board's individual rows are
 * empty for it — and the card, reading only those, told a chat "No scores in
 * yet" over a foursomes with a side nine holes in. These are the rows the
 * page's own team table draws: placed by `placesByValue` on the round's basis
 * (so a shared place is shared), with the side's to-par, which the engine has
 * already put on that basis.
 */
export function sideRowsForCard(
  sides: readonly { name: string; gross: number; net: number; points: number; played: number; toPar: number }[],
  basis: WeekBasis,
  holes: number,
): BoardForCard["rows"] {
  const places = placesByValue(sides, (s) => valueOnBasis(basis, s), (s) => s.played > 0);
  return sides.map((s, i) => ({
    rank: places[i] ?? 0,
    name: s.name,
    ranked: places[i] != null,
    started: s.played > 0,
    thru: s.played,
    holesOwed: holes,
    toPar: s.toPar,
    parKnown: true,
    points: s.points,
    gross: s.gross,
    net: s.net,
    pts: "",
    record: "",
  })) as BoardForCard["rows"];
}

/**
 * THE CARD FOLLOWS THE BOARD'S KIND (2026-10-09). `/live` draws one of nine
 * tables — a cup, a draw, a manual notice, team matches, sides, skins, a
 * Nassau, Modified Stableford, or the stroke board — and this card read the
 * stroke rows for all nine: a skins night previewed a to-par the page never
 * prints, and a Nassau "No scores in yet" over three settled bets.
 *
 * Where the page ranks rows, so does the card, off the page's own table.
 * Where it draws matches or a bracket, the card says where the result is
 * rather than inventing a ranking — rule 1: never show what the board would
 * not.
 */
export interface BoardKindView {
  kind: string;
  teamRound: boolean;
  teamRows: Parameters<typeof sideRowsForCard>[0];
  teamBasis: WeekBasis;
  holeCount: number;
  skins: { outcome: { standings: readonly { playerId: string; skins: number }[] }; nameById: Record<string, string> } | null;
  modStableford: readonly { name: string; points: number; played: number }[] | null;
  nassau: readonly unknown[] | null;
  manualFormat: boolean;
  straightKnockout: boolean;
}

export function rowsForBoardKind(
  view: BoardKindView,
  cup: boolean,
): { rows?: BoardForCard["rows"]; note?: string; ranksOnStrokes?: { isStableford: boolean; unit: string } } {
  if (cup) return { rows: [], note: "Open the board for the match scores." };
  if (view.straightKnockout) return { rows: [], note: "Open the board for the draw." };
  if (view.manualFormat) return { rows: [], note: "Results are posted by the organizer." };
  if (view.kind === "team-match") return { rows: [], note: "Open the board for the matches." };
  if (view.teamRound) {
    return {
      rows: sideRowsForCard(view.teamRows, view.teamBasis, view.holeCount),
      ranksOnStrokes: {
        isStableford: view.teamBasis === "stableford",
        unit: view.teamBasis === "net" ? "net strokes" : "gross strokes",
      },
    };
  }
  if (view.kind === "skins" && view.skins) {
    const st = view.skins.outcome.standings;
    const places = placesByValue(st, (s) => s.skins, (s) => s.skins > 0);
    return {
      rows: st.map((s, i) => ({
        rank: places[i] ?? 0,
        name: view.skins!.nameById[s.playerId] ?? "",
        ranked: places[i] != null,
        // Preformatted, as a match record is: the figure skins are won in.
        record: `${s.skins} ${s.skins === 1 ? "skin" : "skins"}`,
        thru: "",
      })),
    };
  }
  if (view.kind === "nassau" && view.nassau) return { rows: [], note: "Open the board for the Nassau." };
  if (view.kind === "modified-stableford" && view.modStableford) {
    const ms = view.modStableford;
    const places = placesByValue(ms, (r) => r.points, (r) => r.played > 0);
    return {
      rows: ms.map((r, i) => ({
        rank: places[i] ?? 0,
        name: r.name,
        ranked: places[i] != null,
        record: `${r.points} pts`,
        thru: r.played,
        holesOwed: view.holeCount,
      })),
    };
  }
  return {};
}

/** A row the cut, a withdrawal, a DQ or the week's attendance took off the course. */
const offTheCourse = (r: BoardForCard["rows"][number]) => !!(r.missedCut || r.withdrew || r.disqualified || r.absent);

/**
 * The score a share card shows, which is whatever this format's board shows.
 *
 * Deliberately reads the SAME fields the board reads rather than recomputing
 * anything: a picture that disagreed with the page it links to would be worse
 * than no picture. Empty when the row has nothing to say yet — a player who
 * has not started has no score, and "0" or "E" would both be a claim.
 */
export function scoreOf(
  row: BoardForCard["rows"][number],
  board?: Pick<BoardForCard, "isStroke" | "isStableford" | "unit">,
): string {
  const record = clean(String(row.record ?? ""));
  if (record) return record;

  /**
   * THE FIGURE THE BOARD RANKS ON, through the board's own reader (2026-10-09,
   * T69). A standings row ALWAYS carries a Stableford `points` figure, so the
   * branch below printed "37 pts / 36 pts" on a gross medal the page ranks as
   * -1 / E — a different statistic on the picture than on the page it opens.
   * Where the board says what it ranks on, `rankedScore` answers, exactly as
   * it does on /live.
   */
  if (board?.isStroke && typeof row.toPar === "number") {
    if (row.started === false) return "";
    const text = rankedScore(row as unknown as RankedRow, {
      isStroke: true,
      isStableford: !!board.isStableford,
      isNet: unitIsNet(board.unit),
    }).text;
    if (text === "–") return "";
    return board.isStableford ? `${text} pts` : text;
  }

  const points = row.points;
  if (points !== null && points !== undefined && clean(String(points)) !== "") {
    return `${points} pts`;
  }

  const toPar = row.toPar;
  if (toPar !== null && toPar !== undefined && clean(String(toPar)) !== "") {
    return clean(String(toPar));
  }
  return "";
}

/**
 * Build the card.
 *
 * `visibility` is the event's own `leaderboardVisibility`, passed in rather
 * than looked up, so the one thing that must never be got wrong is visible at
 * every call site.
 */
/**
 * How far round a player is, or nothing.
 *
 * ZERO IS NOT A THROUGH-COUNT. A match-play board carries `thru: 0` on every
 * row because the format has no such number, and rendering it put a meaningless
 * "0" beside every completed match on the first card built from this. Nought
 * holes played and "this format does not count holes" are both absences, and
 * neither is a fact worth printing next to somebody's name.
 */
export function thruOf(raw: unknown): string {
  const s = clean(String(raw ?? ""));
  if (!s) return "";
  if (s.toUpperCase() === "F") return "F";
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : "";
}

/**
 * Keep the header from eating the card.
 *
 * `roundLabel` can be a whole sentence — a round-robin describes itself as
 * "Every player meets every other in their group over 3 rounds." — and with a
 * venue and dates after it the subtitle wrapped and pushed the footer -- which
 * carries the wordmark, and is the only reason this image is worth building --
 * off the bottom of a fixed 630px canvas. Held to ONE line at 24px, cut at a
 * word: a subtitle severed mid-word reads as a rendering fault.
 */
export function fitSubtitle(raw: string, max = 58): string {
  const s = clean(raw);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max - 24 ? cut.slice(0, space) : cut).replace(/[·\s]+$/, "")}…`;
}

export function resultsCard(
  board: BoardForCard | null,
  visibility: string,
  club: string,
): ResultsCard {
  const isPublic = visibility === "public";

  if (!isPublic || !board) {
    /**
     * Nothing identifying. Not the club, not the tournament, not "3 players
     * have finished" — a count is a disclosure too, and this image is fetched
     * and cached by servers nobody in the club has heard of.
     */
    return {
      kind: "private",
      headline: "TourneyHQ",
      subtitle: "Live golf leaderboards, scoring and settle-up",
    };
  }

  // A place two players hold is "T1" on the board, so it is here — counted
  // over every ranked row, not the five shown.
  const ranked = board.rows.filter((r) => r.ranked !== false);
  const shared = (rank: number) => ranked.filter((r) => r.rank === rank).length > 1;
  const rows: CardRow[] = ranked
    .slice(0, CARD_ROWS)
    .map((r) => ({
      rank: r.rank,
      place: shared(r.rank) ? `T${r.rank}` : String(r.rank),
      name: fitName(r.name),
      score: scoreOf(r, board),
      thru: cardThru(r),
    }));

  const counted = board.rows.filter((r) => r.ranked !== false).length;

  // Venue and dates, whichever of them the tournament actually has. Joined
  // here rather than in the renderer so an empty one cannot leave a stray
  // separator on the image.
  const subtitle = fitSubtitle(
    [clean(board.roundLabel), clean(board.venue), clean(board.dates)].filter(Boolean).join(" · "),
  );

  return {
    kind: "standings",
    club: clean(club),
    event: clean(board.name),
    subtitle,
    rows,
    more: Math.max(0, counted - rows.length),
    note: clean(board.note ?? ""),
    // "Live" only while somebody is still out there. A finished tournament
    // labelled live is the kind of small lie that makes the rest look unsafe.
    live: !board.official && !board.allIn && board.rows.some((r) => {
      if (offTheCourse(r)) return false;
      const t = cardThru(r);
      return t !== "" && t !== "F";
    }),
  };
}
