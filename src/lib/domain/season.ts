/**
 * Where the teams stand after N weeks of one league.
 *
 * `teamStandings` answers one ROUND. `seriesStandings` answers a run of
 * separate EVENTS. A league is neither: it is one event with many rounds, so
 * until now nothing could answer "where do we stand after six weeks" — which
 * is the only table a league actually cares about. Six unrelated evenings is
 * not a league.
 *
 * Pure on purpose. It takes the rounds already computed rather than reaching
 * for the database, so every combination below can be swept without one.
 */

/** The per-round shape this aggregates. Matches `TeamStanding` structurally. */
export interface RoundStanding {
  teamId: string;
  name: string;
  members: string[];
  gross: number;
  net: number;
  points: number;
  /** Holes actually played. Zero means the side has no card for that round. */
  played: number;
  toPar: number;
}

export interface SeasonRow {
  teamId: string;
  name: string;
  members: string[];
  /** Rounds the side actually returned a card for. */
  roundsPlayed: number;
  points: number;
  gross: number;
  net: number;
  toPar: number;
  /** Competition rank: ties share the lower number and the next one skips. */
  rank: number;
  /** True when at least one other side holds the same rank. */
  tied: boolean;
}

/**
 * Aggregate rounds into a season table.
 *
 * IDENTITY IS THE TEAM ID, NEVER THE NAME. Two sides can share a name, and a
 * club that renames one mid-season has not created a second team. Keying on
 * the name is the same mistake that had a tournament scoring against another
 * course's stroke index — it looked right until two rows collided.
 *
 * A ROUND NOBODY PLAYED IS NOT A ZERO. A side that missed week three has not
 * gone round in nothing; counting the absence as a gross of 0 would put the
 * absentee top of a net table, and counting it as 0 points would rank it
 * below a side that played worse but turned up. Only rounds with a card are
 * summed, and `roundsPlayed` says how many that was, so a reader can see that
 * two totals are not over the same number of weeks.
 */
export function seasonStandings(
  rounds: readonly (readonly RoundStanding[])[],
  basis: string,
): SeasonRow[] {
  const byTeam = new Map<string, SeasonRow>();

  for (const round of rounds) {
    for (const r of round) {
      const row = byTeam.get(r.teamId) ?? {
        teamId: r.teamId,
        name: r.name,
        members: r.members,
        roundsPlayed: 0,
        points: 0,
        gross: 0,
        net: 0,
        toPar: 0,
        rank: 0,
        tied: false,
      };
      // The latest round's name and membership win: a side that changed its
      // name or a player mid-season is still that side, and the board should
      // read as it stands now rather than as it was in week one.
      row.name = r.name;
      row.members = r.members;
      if (r.played > 0) {
        row.roundsPlayed += 1;
        row.points += r.points;
        row.gross += r.gross;
        row.net += r.net;
        row.toPar += r.toPar;
      }
      byTeam.set(r.teamId, row);
    }
  }

  const stableford = basis === "stableford";
  const rows = [...byTeam.values()].sort((a, b) => {
    // A side that has not played a single round has nothing to rank. Without
    // this it sorts to the top of a net table on a total of zero.
    if ((a.roundsPlayed === 0) !== (b.roundsPlayed === 0)) {
      return a.roundsPlayed === 0 ? 1 : -1;
    }
    if (stableford) return b.points - a.points || a.name.localeCompare(b.name);
    return a.net - b.net || a.gross - b.gross || a.name.localeCompare(b.name);
  });

  /**
   * Competition ranking, so a tie reads as a tie.
   *
   * Two sides level on twelve are BOTH twelfth and the next is fourteenth.
   * Handing out 12 and 13 by sort order invents a placing nobody earned, and
   * on a league board that placing is often what the money is paid against.
   */
  const key = (r: SeasonRow) =>
    r.roundsPlayed === 0 ? "unplayed" : stableford ? `${r.points}` : `${r.net}:${r.gross}`;

  rows.forEach((row, i) => {
    if (i > 0 && key(row) === key(rows[i - 1])) {
      row.rank = rows[i - 1].rank;
    } else {
      row.rank = i + 1;
    }
  });
  for (const row of rows) {
    row.tied = rows.some((o) => o !== row && o.rank === row.rank);
  }

  return rows;
}

/**
 * What the board should state under itself.
 *
 * A total that does not reconcile is how an organiser stops trusting the
 * whole table, so the number is computed from the same rows it is printed
 * beneath rather than tracked separately.
 */
export function seasonTotals(rows: readonly SeasonRow[]): {
  teams: number;
  roundsPlayed: number;
  points: number;
} {
  return {
    teams: rows.length,
    roundsPlayed: rows.reduce((s, r) => Math.max(s, r.roundsPlayed), 0),
    points: rows.reduce((s, r) => s + r.points, 0),
  };
}
