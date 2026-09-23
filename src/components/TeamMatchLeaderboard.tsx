import type { TeamMatchRow } from "@/lib/services/teams";
import { LEAGUE_POINTS_LABEL, type LeaguePointsSystem } from "@/lib/domain/league-meeting";

/**
 * THE BOARD A ROUND ROBIN OF TEAM MATCHES BELONGS ON.
 *
 * Its sibling `TeamLeaderboard` prints H/cap · Holes · Gross · Net · To par,
 * which is a MEDAL board and is what a four-ball round robin was getting — so
 * the side that won 10&8 appeared second, behind the side with the lower
 * stroke total, under a caption reading "lowest net wins".
 *
 * These are the columns the singles match board already uses, with a SIDE in
 * place of a player: played, won, halved, lost, the holes the matches
 * produced, and the points. Deliberately the same shape, because a club
 * running both should not have to learn two boards.
 */
export function TeamMatchLeaderboard({
  format,
  rows,
  system,
}: {
  format: string;
  rows: TeamMatchRow[];
  system: LeaguePointsSystem;
}) {
  return (
    <>
      <p className="text-muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
        {/* The board says what it is ordered on, in its own words — the rule
            `verify-public-boards.mjs` reads a board by. */}
        {format} · {rows.length} {rows.length === 1 ? "side" : "sides"} ·{" "}
        {LEAGUE_POINTS_LABEL[system]}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Side</th>
              <th>P</th>
              <th>W</th>
              <th>½</th>
              <th>L</th>
              <th>Holes ±</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId}>
                <td>{r.played > 0 ? r.rank : "—"}</td>
                <td style={{ minWidth: 0 }}>
                  <strong>{r.name}</strong>
                  {r.members.length > 0 && (
                    <div className="text-muted" style={{ fontSize: 11.5 }}>
                      {r.members.join(" · ")}
                    </div>
                  )}
                </td>
                <td>{r.played}</td>
                <td>{r.wins}</td>
                <td>{r.halved}</td>
                <td>{r.losses}</td>
                {/* A lead of nought is level, not nothing, so it prints as a
                    signed zero rather than an em dash. */}
                <td>{r.played > 0 ? (r.holesDiff > 0 ? `+${r.holesDiff}` : String(r.holesDiff)) : "—"}</td>
                <td>
                  <strong>{r.points}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
        Columns: P played, W won, ½ halved, L lost. A pairing nobody has started
        yet counts for neither side.
      </p>
    </>
  );
}
