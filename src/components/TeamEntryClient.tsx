"use client";
import { useState, useTransition } from "react";
import { saveTeamScorecard } from "@/app/actions/tournament";

export interface TeamCardRow {
  /** Empty where the side shares one ball. */
  playerId: string;
  playerName: string;
  handicap: number;
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

export function TeamEntryClient({
  round,
  teams,
  pars,
  strokeIndex,
  sharesOneCard,
  holes,
}: {
  round: string;
  teams: TeamEntryRow[];
  pars: number[];
  strokeIndex: number[];
  sharesOneCard: boolean;
  holes: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Record<string, (number | null)[]>>(() => {
    const seed: Record<string, (number | null)[]> = {};
    for (const t of teams) {
      for (const c of t.cards) {
        seed[`${t.teamId}:${c.playerId}`] = [...c.strokes];
      }
    }
    return seed;
  });

  const keyFor = (teamId: string, playerId: string) => `${teamId}:${playerId}`;

  const setHole = (key: string, hole: number, value: string) => {
    const n = value === "" ? null : parseInt(value, 10);
    setDraft((d) => {
      const next = [...(d[key] ?? new Array(holes).fill(null))];
      next[hole] = Number.isFinite(n as number) && (n as number) > 0 ? (n as number) : null;
      return { ...d, [key]: next };
    });
  };

  const save = (teamId: string, playerId: string, matchId: string) => {
    const key = keyFor(teamId, playerId);
    const strokes = draft[key] ?? new Array(holes).fill(null);
    setError("");
    startTransition(async () => {
      const res = await saveTeamScorecard(teamId, playerId, matchId, strokes);
      if (!res.ok && res.error) setError(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {round} —{" "}
        {sharesOneCard
          ? "one card per side; the partners play a single ball."
          : "one card each; the side's score is taken from the better ball on every hole."}
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
        <div key={t.teamId} className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="card-title" style={{ fontSize: 15 }}>{t.teamName}</span>
            {t.opponentName && (
              <span className="text-muted" style={{ fontSize: 13 }}>v {t.opponentName}</span>
            )}
            <span className="tag tag-neutral" title="The side's playing handicap">
              Plays off {t.playingHandicap}
            </span>
            <span className="text-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
              {t.played > 0 ? `${t.grossTotal} gross · ${t.netTotal} net · ${t.played} holes` : "No score yet"}
            </span>
          </div>

          {t.cards.map((c) => {
            const key = keyFor(t.teamId, c.playerId);
            const values = draft[key] ?? new Array(holes).fill(null);
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
                    onClick={() => save(t.teamId, c.playerId, t.matchId)}
                  >
                    {pending ? "Saving…" : "Save card"}
                  </button>
                </div>
                <div className="table-scroll">
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Hole</th>
                        {Array.from({ length: holes }, (_, i) => (
                          <th key={i} style={{ textAlign: "center" }}>{i + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pars.length > 0 && (
                        <tr>
                          <td className="text-muted">Par</td>
                          {Array.from({ length: holes }, (_, i) => (
                            <td key={i} className="text-muted" style={{ textAlign: "center" }}>
                              {pars[i] ?? "—"}
                            </td>
                          ))}
                        </tr>
                      )}
                      {strokeIndex.length > 0 && (
                        <tr>
                          <td className="text-muted">S.I.</td>
                          {Array.from({ length: holes }, (_, i) => (
                            <td key={i} className="text-muted" style={{ textAlign: "center" }}>
                              {strokeIndex[i] ?? "—"}
                            </td>
                          ))}
                        </tr>
                      )}
                      <tr>
                        <td style={{ fontWeight: 500 }}>Score</td>
                        {Array.from({ length: holes }, (_, i) => (
                          <td key={i} style={{ textAlign: "center", padding: 2 }}>
                            <input
                              className="input"
                              inputMode="numeric"
                              style={{ width: 40, textAlign: "center", padding: "4px 2px" }}
                              value={values[i] ?? ""}
                              onChange={(e) => setHole(key, i, e.target.value)}
                              aria-label={`${c.playerId ? c.playerName : t.teamName} hole ${i + 1}`}
                            />
                          </td>
                        ))}
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
