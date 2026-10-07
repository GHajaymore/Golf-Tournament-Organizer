import Link from "next/link";
import { cupPoints, yourMatchLine, type CupSide } from "@/lib/domain/cup";
import type { CupBoard } from "@/lib/services/cup";
import { cupVerdictLine } from "@/components/CupScoreboard";
import { Icon } from "@/components/Icon";

/**
 * A TEAM CUP, ON THE PLAYER'S OWN SCREEN — the score, and every match they are
 * lined up in, told from their side.
 *
 * Today used to treat a cup session like any team round: "Your side · not
 * started" with no opponent, a request to pick who to play with (the captains
 * pick), and for a player not in the current session, "your score is recorded
 * against your opponent" and nothing about the match they were in. Found
 * 2026-10-05 walking a cup as its players.
 *
 * Each match leads with what it is — the session, who with, who against — and
 * where it stands, and offers the one thing to do next: score it.
 */
export function MyCup({ board, meId, canScore }: { board: CupBoard; meId: string; canScore: boolean }) {
  const [ta, tb] = board.teams;
  const mine = board.sessions.flatMap((s) =>
    s.matches
      .filter((m) => m.aIds.includes(meId) || m.bIds.includes(meId))
      .map((m) => ({ session: s, match: m, side: (m.aIds.includes(meId) ? "A" : "B") as CupSide })),
  );
  // My team: from a match if I have one, else not shown.
  const myTeam = mine[0]?.side ?? null;
  const names = (ids: string[], list: string[]) => list.map((n, i) => (ids[i] === meId ? "You" : n));

  return (
    <section aria-label="Your cup" className="card elev-sm" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="card-kicker">The cup</span>
      {/* keep-grid: a score side by side on a phone, not stacked. */}
      <div
        className="keep-grid"
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: 10, textAlign: "center" }}
      >
        <TeamScore name={ta.name} points={board.tally.a} yours={myTeam === "A"} />
        <span className="text-muted" style={{ fontSize: 14 }}>v</span>
        <TeamScore name={tb.name} points={board.tally.b} yours={myTeam === "B"} />
      </div>
      <p style={{ margin: 0, textAlign: "center", fontSize: 14 }}>{cupVerdictLine(board)}</p>

      <h2 style={{ fontSize: 15, margin: "4px 0 0" }}>{mine.length === 1 ? "Your match" : "Your matches"}</h2>
      {mine.length === 0 ? (
        <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          You aren&rsquo;t in an announced lineup yet. Your match appears here as soon as its session is announced.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {mine.map(({ session, match, side }) => {
            const us = side === "A" ? names(match.aIds, match.a) : names(match.bIds, match.b);
            const them = side === "A" ? match.b : match.a;
            const line = yourMatchLine(match.state, side);
            const ahead = match.state.leader === side;
            const open = match.state.status !== "final";
            return (
              <li
                key={match.id}
                aria-label={`${session.name} match`}
                style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 10, borderTop: "1px solid var(--color-divider)" }}
              >
                <span className="text-muted" style={{ fontSize: 13, fontWeight: 600 }}>
                  {session.name} · {session.kind}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>
                  {us.join(" & ")} <span className="text-muted" style={{ fontWeight: 400 }}>v</span> {them.join(" & ")}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 20,
                    lineHeight: 1.25,
                    color: ahead ? "var(--color-accent-2-200)" : "var(--color-text)",
                  }}
                >
                  {line}
                </span>
                {canScore && open && (
                  <Link className="btn btn-primary" href={`/entry?round=${encodeURIComponent(session.id)}`} style={{ alignSelf: "flex-start", marginTop: 4 }}>
                    <Icon name="pencil-simple" /> {match.state.status === "not-started" ? "Score this match" : "Carry on scoring"}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* What is still to come, so a player with no match yet knows why: the
          captains pick each session's pairs, and the organizer announces them
          one session at a time. */}
      {board.sessions.some((s) => !s.published) && (
        <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          Still to be announced:{" "}
          {board.sessions
            .filter((s) => !s.published)
            .map((s) => s.name)
            .join(", ")}
          .
        </p>
      )}
    </section>
  );
}

function TeamScore({ name, points, yours }: { name: string; points: number; yours: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {cupPoints(points)}
      </div>
      <div style={{ fontWeight: 600, marginTop: 4, overflowWrap: "anywhere" }}>{name}</div>
      {yours && (
        <div className="text-muted" style={{ fontSize: 13 }}>
          Your team
        </div>
      )}
    </div>
  );
}
