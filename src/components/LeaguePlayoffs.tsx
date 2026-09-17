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
        </div>
      ))}
      <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.55 }}>
        Seeded from the season table — points, then meetings won, then name. A level play-off
        meeting goes to the higher seed.
      </p>
    </div>
  );
}
