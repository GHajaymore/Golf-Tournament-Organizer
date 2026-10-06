import { cupPoints, type CupVerdict } from "@/lib/domain/cup";
import type { CupBoard } from "@/lib/services/cup";

/** One sentence under the score: who has the cup, or what each team needs. */
export function cupVerdictLine(board: CupBoard): string {
  const [a, b] = board.teams;
  const name = (side: "A" | "B") => (side === "A" ? a.name : b.name);
  const v: CupVerdict = board.verdict;
  if (v.kind === "won") return `${name(v.by)} win the cup.`;
  if (v.kind === "retained") {
    // Level only when every match is in; before that the holder has simply
    // got out of reach, which is how a cup is usually kept.
    const level = board.tally.decided === board.tally.total && board.tally.a === board.tally.b;
    return level ? `Level — ${name(v.by)} retain the cup.` : `${name(v.by)} retain the cup.`;
  }
  if (v.kind === "tied") return "Level — the cup is shared.";
  if (board.tally.total === 0) return "No matches in the lineup yet.";
  if (v.needA === null || v.needB === null) return "The points to win are set once every session is lined up.";
  return `${cupPoints(board.target)} to win · ${a.name} need ${cupPoints(v.needA)}, ${b.name} need ${cupPoints(v.needB)}.`;
}

/**
 * THE CUP SCORE — the one number everybody on the trip is watching — and every
 * session's matches beneath it. Shared by the console, the player board and
 * the public board, so all three say the same thing.
 *
 * Decided matches only in the big figures, never a projection: a match two up
 * with three to play is in the list as "2 UP thru 15", and not yet a point.
 */
export function CupScoreboard({ board }: { board: CupBoard }) {
  const [a, b] = board.teams;
  const { tally } = board;
  return (
    <section className="card elev-sm" aria-labelledby="cup-score" style={{ marginBottom: 16 }}>
      <h2 id="cup-score" className="card-kicker" style={{ margin: 0 }}>
        The cup
      </h2>
      {/* `keep-grid`: phones stack inline grids (globals.css), and a cup score
          stacked into one column is a list, not a scoreboard. */}
      <div
        className="keep-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          alignItems: "center",
          gap: 12,
          marginTop: 8,
          textAlign: "center",
        }}
      >
        <TeamScore name={a.name} captain={a.captain} points={tally.a} />
        <span className="text-muted" style={{ fontSize: 14 }}>
          v
        </span>
        <TeamScore name={b.name} captain={b.captain} points={tally.b} />
      </div>
      <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: 14 }}>{cupVerdictLine(board)}</p>
      <p className="text-muted" style={{ margin: "2px 0 0", textAlign: "center", fontSize: 13 }}>
        {tally.decided} of {tally.total} {tally.total === 1 ? "match" : "matches"} decided
        {tally.inPlay > 0 ? ` · ${tally.inPlay} on the course` : ""}
      </p>

      {board.sessions.map((s) => (
        <div key={s.id} style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 6px", color: "var(--color-neutral-500)" }}>
            {s.name} · {s.kind}
          </h3>
          {s.matches.length === 0 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              Lineup not set yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {s.matches.map((m) => (
                <li
                  key={m.id}
                  className="keep-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 13.5,
                    padding: "6px 0",
                    borderTop: "1px solid var(--color-divider)",
                  }}
                >
                  <span style={{ fontWeight: m.state.leader === "A" ? 600 : 400, minWidth: 0 }}>{m.a.join(" & ")}</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                      textAlign: "center",
                      color: m.state.status === "final" ? "var(--color-text)" : "var(--color-neutral-500)",
                    }}
                  >
                    {m.state.status === "not-started"
                      ? "—"
                      : m.state.leader
                        ? `${m.state.leader === "A" ? "◀" : ""} ${m.state.label} ${m.state.leader === "B" ? "▶" : ""}`.trim()
                        : m.state.label}
                  </span>
                  <span style={{ textAlign: "right", fontWeight: m.state.leader === "B" ? 600 : 400, minWidth: 0 }}>
                    {m.b.join(" & ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function TeamScore({ name, captain, points }: { name: string; captain: string; points: number }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 44, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {cupPoints(points)}
      </div>
      <div style={{ fontWeight: 600, marginTop: 4, overflowWrap: "anywhere" }}>{name}</div>
      {captain && (
        <div className="text-muted" style={{ fontSize: 13 }}>
          Captain {captain}
        </div>
      )}
    </div>
  );
}
