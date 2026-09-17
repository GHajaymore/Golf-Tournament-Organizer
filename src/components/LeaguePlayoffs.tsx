import type { LeaguePlayoffs as Playoffs } from "@/lib/services/league";

/**
 * THE PLAY-OFF BRACKET, round by round.
 *
 * A list rather than a drawn bracket: two to four rounds of at most four
 * meetings reads better as rows on a phone than as lines on a tree, and each
 * row says the one thing a member wants — who plays whom, with their seeds.
 * A meeting nobody knows yet says what it is waiting for.
 */
export function LeaguePlayoffs({ playoffs }: { playoffs: Playoffs }) {
  const name = (id: string) => playoffs.names[id] ?? "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {playoffs.champion && (
        <div className="card elev-sm" style={{ borderLeft: "3px solid var(--color-accent)" }}>
          <span className="card-title">Champions: {name(playoffs.champion)}</span>
        </div>
      )}
      {playoffs.rounds.map((round, r) => (
        <div key={round.stageId} className="card elev-sm">
          <span className="card-title" style={{ fontSize: 14 }}>
            {round.name}
          </span>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
            {round.meetings.map((m, i) => (
              <li key={i} style={{ fontSize: 13 }}>
                {m ? (
                  <>
                    <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                      ({m.seedA})
                    </span>{" "}
                    {name(m.clubA)} v {name(m.clubB)}{" "}
                    <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                      ({m.seedB})
                    </span>
                  </>
                ) : (
                  <span className="text-muted">
                    Waits for the {playoffs.rounds[r - 1]?.name.toLowerCase() ?? "season"}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* WHAT WAS DECIDED OFF THE COURSE, said where the result is.
              A play-off hole and a committee override are both decisions the
              app cannot see happen, and a bracket that quietly disagrees with
              the points reads as the app getting it wrong. Named, reasoned
              and attributed — to members as well as staff. */}
          {round.decisions.length > 0 && (
            <ul
              style={{
                listStyle: "none",
                margin: "8px 0 0",
                padding: 0,
                display: "grid",
                gap: 4,
                fontSize: 12,
              }}
            >
              {round.decisions.map((d, i) => (
                <li key={i} className="text-muted">
                  {d.overrode ? (
                    <b style={{ color: "var(--color-accent)" }}>
                      {name(d.winner)} through — the committee overturned the result
                    </b>
                  ) : (
                    <>{name(d.winner)} won the play-off hole</>
                  )}
                  {d.note ? `: ${d.note}` : ""}
                  {d.decidedBy ? ` (recorded by ${d.decidedBy})` : ""}
                </li>
              ))}
            </ul>
          )}

          {/* Level, finished, and nobody through until somebody says who won
              the hole. Stated rather than left as a blank next round. */}
          {round.awaitingHole.length > 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
              {round.awaitingHole.map(([a, b]) => `${name(a)} v ${name(b)}`).join(", ")}{" "}
              {round.awaitingHole.length === 1 ? "finished" : "finished"} level — a play-off hole
              decides it, and the organizer records who won.
            </p>
          )}
        </div>
      ))}
      <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.55 }}>
        Seeded from the season table, in the order it is printed. A level play-off meeting is
        settled on a play-off hole, and the organizer records who won it.
      </p>
    </div>
  );
}
