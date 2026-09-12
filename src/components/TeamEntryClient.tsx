"use client";
import { useState, useTransition } from "react";
import { saveTeamScorecard } from "@/app/actions/tournament";

export interface TeamCardRow {
  /** Empty where the side shares one ball. */
  playerId: string;
  playerName: string;
  handicap: number;
  /**
   * Handicap strokes this card receives, hole by hole.
   *
   * Allocated on the SERVER by the same `allocatedStrokes` the side's score
   * is aggregated with, so the dots and the net beneath them cannot disagree.
   * Optional so a caller that has not been taught to send them renders exactly
   * as it did — with no Shots row rather than a wrong one.
   */
  shots?: number[];
  strokes: (number | null)[];
}

export interface TeamEntryRow {
  teamId: string;
  teamName: string;
  /** Empty for a team stroke-play round with no opponent. */
  matchId: string;
  opponentName?: string;
  playingHandicap: number;
  cards: TeamCardRow[];
  /** Running side score, computed server-side from the saved cards. */
  grossTotal: number;
  netTotal: number;
  played: number;
}

/**
 * Out, In and Tot — the columns you check against the paper card.
 *
 * Every other scorecard in the app carries them; this one did not, so a side
 * reading their own card had to add nine numbers in their head to compare it
 * with the one in their pocket. On a nine-hole round there is no front and
 * back to split, so only the total is shown — the same rule `ScorecardTable`
 * follows.
 */
function totalOf(values: Array<number | null | undefined>, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i += 1) n += values[i] ?? 0;
  return n;
}

export function TeamEntryClient({
  round,
  teams,
  pars,
  strokeIndex,
  note,
  holes,
}: {
  round: string;
  teams: TeamEntryRow[];
  pars: number[];
  strokeIndex: number[];
  /**
   * What this round is written down as, from `teamEntryNote`.
   *
   * Passed in rather than worked out here, because the answer depends on the
   * committee's setting as well as the format, and this screen deciding it
   * separately is exactly how it came to ignore that setting.
   */
  note: string;
  holes: number;
}) {
  const [pending, startTransition] = useTransition();
  /**
   * The two nines, and whether there are two.
   *
   * A nine-hole round has no front and back to split, so it carries only a
   * total — the same rule `ScorecardTable` follows, and the reason these are
   * derived once rather than at each row.
   */
  const isEighteen = holes > 9;
  const front = Array.from({ length: Math.min(9, holes) }, (_, i) => i);
  const back = Array.from({ length: Math.max(0, holes - 9) }, (_, i) => i + 9);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Record<string, (number | null)[]>>(() => {
    const seed: Record<string, (number | null)[]> = {};
    for (const t of teams) {
      for (const c of t.cards) {
        seed[`${t.teamId}:${t.matchId}:${c.playerId}`] = [...c.strokes];
      }
    }
    return seed;
  });

  /**
   * Identity of one card on this screen.
   *
   * The match id is part of it, and has to be: in a team round robin a side
   * plays several matches, so the same team appears more than once. Keying on
   * team and player alone made those rows share draft state — a score typed
   * against one opponent appeared against the other — and gave React duplicate
   * keys into the bargain.
   */
  const keyFor = (teamId: string, matchId: string, playerId: string) =>
    `${teamId}:${matchId}:${playerId}`;

  const setHole = (key: string, hole: number, value: string) => {
    const n = value === "" ? null : parseInt(value, 10);
    setDraft((d) => {
      const next = [...(d[key] ?? new Array(holes).fill(null))];
      next[hole] = Number.isFinite(n as number) && (n as number) > 0 ? (n as number) : null;
      return { ...d, [key]: next };
    });
  };

  const save = (teamId: string, playerId: string, matchId: string, saved: (number | null)[]) => {
    const key = keyFor(teamId, matchId, playerId);
    // Falls back to what the server already holds, never to an empty card —
    // an untouched draft must not blank a score somebody already returned.
    const strokes = draft[key] ?? saved;
    setError("");
    startTransition(async () => {
      const res = await saveTeamScorecard(teamId, playerId, matchId, strokes);
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {round} —{" "}
        {note}
      </p>

      {error && <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>{error}</p>}

      {teams.length === 0 && (
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 15 }}>No sides drawn yet</span>
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
            This round is played by teams, so the sides have to exist before anyone can return a
            card. Draw them on <a href="/teams">Teams</a>.
          </p>
        </div>
      )}

      {teams.map((t) => (
        <div key={`${t.teamId}:${t.matchId}`} className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="card-title" style={{ fontSize: 15 }}>{t.teamName}</span>
            {t.opponentName && (
              <span className="text-muted" style={{ fontSize: 13 }}>v {t.opponentName}</span>
            )}
            {/* No tooltip: "Plays off 12" IS the playing handicap, said in
                the words a side would use. */}
            <span className="tag tag-neutral">
              Plays off {t.playingHandicap}
            </span>
            <span className="text-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
              {t.played > 0 ? `${t.grossTotal} gross · ${t.netTotal} net · ${t.played} holes` : "No score yet"}
            </span>
          </div>

          {t.cards.map((c) => {
            const key = keyFor(t.teamId, t.matchId, c.playerId);
            const values = draft[key] ?? c.strokes;
            const scoreCell = (i: number) => {
              const v = values[i];
              const par = pars[i];
              const d = v != null && par ? v - par : null;
              const mark =
                d === null ? "" : d <= -2 ? " is-eagle" : d === -1 ? " is-under" : d === 1 ? " is-over" : d >= 2 ? " is-double" : "";
              return (
                <td key={i} style={{ padding: 2 }}>
                  <input
                    className={`input sc-score${mark}`}
                    inputMode="numeric"
                    value={values[i] ?? ""}
                    onChange={(e) => setHole(key, i, e.target.value)}
                    aria-label={`${c.playerId ? c.playerName : t.teamName}, hole ${i + 1}${par ? `, par ${par}` : ""}`}
                  />
                </td>
              );
            };
            return (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {c.playerId ? c.playerName : "Team card"}
                  </span>
                  {c.playerId !== "" && (
                    <span className="text-muted" style={{ fontSize: 12 }}>h/cap {c.handicap}</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginLeft: "auto" }}
                    disabled={pending}
                    onClick={() => save(t.teamId, c.playerId, t.matchId, c.strokes)}
                  >
                    {pending ? "Saving…" : "Save card"}
                  </button>
                </div>
                <div className="sc-wrap">
                  <table className="sc" style={{ minWidth: holes > 9 ? 960 : 560 }}>
                    <thead>
                      <tr>
                        <th>Hole</th>
                        {front.map((i) => (<th key={i}>{i + 1}</th>))}
                        {isEighteen && <th className="sc-tot">Out</th>}
                        {back.map((i) => (<th key={i}>{i + 1}</th>))}
                        {isEighteen && <th className="sc-tot">In</th>}
                        <th className="sc-tot">Tot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pars.length > 0 && (
                        <tr className="sc-ref sc-par">
                          <td>Par</td>
                          {front.map((i) => (<td key={i}>{pars[i] ?? "—"}</td>))}
                          {isEighteen && <td className="sc-tot">{totalOf(pars, 0, 9)}</td>}
                          {back.map((i) => (<td key={i}>{pars[i] ?? "—"}</td>))}
                          {isEighteen && <td className="sc-tot">{totalOf(pars, 9, holes)}</td>}
                          <td className="sc-tot">{totalOf(pars, 0, holes)}</td>
                        </tr>
                      )}
                      {strokeIndex.length > 0 && (
                        <tr className="sc-ref">
                          <td>S.I.</td>
                          {front.map((i) => (<td key={i}>{strokeIndex[i] ?? "—"}</td>))}
                          {isEighteen && <td className="sc-tot" />}
                          {back.map((i) => (<td key={i}>{strokeIndex[i] ?? "—"}</td>))}
                          {isEighteen && <td className="sc-tot" />}
                          <td className="sc-tot" />
                        </tr>
                      )}
                      {/* WHERE THE SHOTS FALL. The working behind the net, on
                          the holes it actually happens — and the row this card
                          never had, so a four-ball played off handicap showed
                          a scorer no pops at all. */}
                      {(c.shots ?? []).some((n) => (n ?? 0) > 0) && (
                        <tr className="sc-ref">
                          <td>Shots</td>
                          {front.map((i) => (
                            <td key={i} style={{ color: "var(--color-accent-400)", fontWeight: 700 }}>
                              {c.shots?.[i] ? "•".repeat(c.shots[i]) : ""}
                            </td>
                          ))}
                          {isEighteen && <td className="sc-tot">{totalOf(c.shots ?? [], 0, 9)}</td>}
                          {back.map((i) => (
                            <td key={i} style={{ color: "var(--color-accent-400)", fontWeight: 700 }}>
                              {c.shots?.[i] ? "•".repeat(c.shots[i]) : ""}
                            </td>
                          ))}
                          {isEighteen && <td className="sc-tot">{totalOf(c.shots ?? [], 9, holes)}</td>}
                          <td className="sc-tot">{totalOf(c.shots ?? [], 0, holes)}</td>
                        </tr>
                      )}
                      <tr>
                        <td>Score</td>
                        {/* Front and back emitted separately with the totals
                            between them. Mapping all eighteen in one pass and
                            pushing the totals to the end is the trap the match
                            card's own comments record: every back-nine cell
                            lands under the wrong hole number. */}
                        {front.map((i) => scoreCell(i))}
                        {isEighteen && (
                          <td className="sc-tot">{totalOf(values, 0, 9) || "—"}</td>
                        )}
                        {back.map((i) => scoreCell(i))}
                        {isEighteen && (
                          <td className="sc-tot">{totalOf(values, 9, holes) || "—"}</td>
                        )}
                        <td className="sc-tot">{totalOf(values, 0, holes) || "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
