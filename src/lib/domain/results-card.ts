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

/** A standings row, narrowed to what a share card can use. */
export interface CardRow {
  rank: number;
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
  }>;
}

/**
 * The score a share card shows, which is whatever this format's board shows.
 *
 * Deliberately reads the SAME fields the board reads rather than recomputing
 * anything: a picture that disagreed with the page it links to would be worse
 * than no picture. Empty when the row has nothing to say yet — a player who
 * has not started has no score, and "0" or "E" would both be a claim.
 */
export function scoreOf(row: BoardForCard["rows"][number]): string {
  const record = clean(String(row.record ?? ""));
  if (record) return record;

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

  const rows: CardRow[] = board.rows
    .filter((r) => r.ranked !== false)
    .slice(0, CARD_ROWS)
    .map((r) => ({
      rank: r.rank,
      name: fitName(r.name),
      score: scoreOf(r),
      thru: thruOf(r.thru),
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
    // "Live" only while somebody is still out there. A finished tournament
    // labelled live is the kind of small lie that makes the rest look unsafe.
    live: board.rows.some((r) => {
      const t = thruOf(r.thru);
      return t !== "" && t !== "F";
    }),
  };
}
