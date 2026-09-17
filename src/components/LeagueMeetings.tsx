import { resolveMatch } from "@/lib/domain/match";
import { pairingPoints, type LeaguePointsSystem } from "@/lib/domain/league-meeting";
import type { LeagueMeeting } from "@/lib/services/league";

/**
 * ONE WEEK'S MEETINGS: six clubs against six, six four-balls apiece.
 *
 * The screen a captain opens on Thursday night. Each meeting is a heading with
 * the two clubs and the score between them; underneath it, every pairing with
 * who played whom, how the match stands, and what it is worth.
 *
 * THE MATCH LINE COMES FROM `resolveMatch`, which is what the scorecard, the
 * bracket and the money all read. "3&2" on this screen and "3&2" on the card
 * cannot disagree, because there is one function that decides it.
 *
 * A PAIRING STILL OUT ON THE COURSE SAYS SO. Match play pays nothing until a
 * match is decided, so a meeting mid-round shows fewer points than are at
 * stake — and that is the honest reading rather than a provisional total that
 * moves under somebody watching it.
 */
export function LeagueMeetings({
  meetings,
  system,
  matchBonus,
}: {
  meetings: LeagueMeeting[];
  system: LeaguePointsSystem;
  matchBonus: number;
}) {
  if (meetings.length === 0) {
    return (
      <div className="card elev-sm">
        <span className="card-title">No meetings this round</span>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          A meeting is two clubs whose nominated pairs are drawn against each
          other. Nominate this week&rsquo;s pairs and draw them, and the
          meetings appear here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {meetings.map((m) => (
        <div key={`${m.clubAId}:${m.clubBId}`} className="card elev-sm">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span className="card-title">
              {m.clubAName} v {m.clubBName}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              {m.pointsA.toFixed(2)} &ndash; {m.pointsB.toFixed(2)}
            </span>
          </div>

          {/* SHORT OF PAIRS, named on the night rather than found on the first
              tee. How many a meeting should have is the league's own setting
              — six is one club's choice, not a rule — so this says nothing at
              all until somebody has declared a number. */}
          {m.short && (
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              {m.pairings.length} of {m.expectedPairings} pairs nominated
            </div>
          )}

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>{m.clubAName}</th>
                  <th style={{ textAlign: "center", width: 96 }}>Match</th>
                  <th style={{ textAlign: "left" }}>{m.clubBName}</th>
                  <th style={{ textAlign: "right", width: 96 }}>Points</th>
                </tr>
              </thead>
              <tbody>
                {m.pairings.map((p, i) => {
                  const resolved = resolveMatch(p.holes);
                  const [a, b] = pairingPoints(p.holes, system, matchBonus);
                  /**
                   * The two sides may be stored either way round — `parentA`
                   * is whichever side the fixture named first, not whichever
                   * club heads this table. Reading the points straight off
                   * would credit the wrong club on half the pairings.
                   */
                  const homeFirst = p.clubA === m.clubAId;
                  const homeName = homeFirst ? p.aName : p.bName;
                  const awayName = homeFirst ? p.bName : p.aName;
                  const homePts = homeFirst ? a : b;
                  const awayPts = homeFirst ? b : a;

                  return (
                    <tr key={i}>
                      <td>{homeName}</td>
                      <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                        {/* Unplayed reads as a dash rather than "all square",
                            which is a claim about a match nobody has started. */}
                        {resolved.complete
                          ? resolved.resultText
                          : p.holes.some((h) => h !== null)
                            ? resolved.resultText || "T"
                            : "—"}
                      </td>
                      <td>{awayName}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {homePts.toFixed(2)} &ndash; {awayPts.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
