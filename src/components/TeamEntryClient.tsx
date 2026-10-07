"use client";
import { indexLabel } from "@/lib/domain/handicap-label";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveTeamScorecard } from "@/app/actions/tournament";
import { ScoreCell } from "@/components/ScorecardTable";
import { HoleByHoleCard } from "@/components/HoleByHoleCard";
import { Icon } from "@/components/Icon";
import { holeNumber } from "@/lib/domain/hole-number";

/**
 * The cards scored together on the hole view: everybody in one MATCH (both
 * sides of a four-ball), or one side where a round has no opponent.
 *
 * Each match arrives twice — once per side, each listing its own cards — so
 * grouping by match id puts all four players of a four-ball on one hole.
 */
export function holeGroups(teams: TeamEntryRow[]): Array<{
  key: string;
  label: string;
  rows: Array<{ team: TeamEntryRow; card: TeamCardRow }>;
}> {
  const byKey = new Map<string, { key: string; label: string; rows: Array<{ team: TeamEntryRow; card: TeamCardRow }> }>();
  for (const team of teams) {
    const key = team.matchId || `team:${team.teamId}`;
    const group =
      byKey.get(key) ??
      { key, label: team.opponentName ? `${team.teamName} v ${team.opponentName}` : team.teamName, rows: [] };
    for (const card of team.cards) group.rows.push({ team, card });
    byKey.set(key, group);
  }
  return [...byKey.values()];
}

export interface TeamCardRow {
  /** Empty where the side shares one ball. */
  playerId: string;
  playerName: string;
  handicap: number;
  /** ghin | manual | none. 'none' is no claimed figure — see indexLabel. */
  handicapSource?: string | null;
  handicapType?: string | null;
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
  /** Per hole, this ball picked up — match play only. See `TeamScorecard.pickedUp`. */
  pickedUp?: boolean[];
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
  firstHole = 1,
  pickUp = false,
  casual = false,
  meId,
}: {
  /**
   * A CASUAL ROUND'S SIDES (2026-10-06), on its one screen: opens on the hole
   * at every width, saves itself a moment after each tap — only the cards this
   * phone changed — and offers the full card from its foot. The round screen's
   * own heading says what the format is, so the note under it goes too.
   */
  casual?: boolean;
  /** The person holding the phone, for the mic's "me". See `HoleByHoleCard`. */
  meId?: string;
  /**
   * Match play: a ball can be PICKED UP, and a side with every ball picked up
   * has conceded the hole (Rule 3.2b(1)). Offered only here — a medal is holed
   * out — so the "Picked up" control appears on no stroke card.
   */
  pickUp?: boolean;
  /** The course's number for the first hole on the round's card — 10 on a back nine. */
  firstHole?: number;
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

  /** Which holes each card picked up on, as the server has them and as edited. */
  const [picks, setPicks] = useState<Record<string, boolean[]>>(() => {
    const seed: Record<string, boolean[]> = {};
    for (const t of teams) {
      for (const c of t.cards) {
        seed[`${t.teamId}:${t.matchId}:${c.playerId}`] = Array.from({ length: holes }, (_, h) => c.pickedUp?.[h] === true);
      }
    }
    return seed;
  });
  const picksFor = (key: string): boolean[] => picks[key] ?? new Array(holes).fill(false);
  const setPick = (key: string, hole: number, on: boolean) => {
    setPicks((p) => {
      const next = [...(p[key] ?? new Array(holes).fill(false))];
      next[hole] = on;
      return { ...p, [key]: next };
    });
    // Out of the hole has no score on it.
    if (on) {
      setDraft((d) => {
        const next = [...(d[key] ?? new Array(holes).fill(null))];
        next[hole] = null;
        return { ...d, [key]: next };
      });
    }
  };

  /** Already parsed — `ScoreCell` does that, through `parseStroke`. */
  const setHole = (key: string, hole: number, value: number | null) => {
    setDraft((d) => {
      const next = [...(d[key] ?? new Array(holes).fill(null))];
      next[hole] = value;
      return { ...d, [key]: next };
    });
    // A score typed onto a hole takes back a pick-up recorded there.
    if (value != null && picks[key]?.[hole]) {
      setPicks((p) => {
        const next = [...(p[key] ?? [])];
        next[hole] = false;
        return { ...p, [key]: next };
      });
    }
  };

  /**
   * ONE HOLE AT A TIME, ON A PHONE (2026-10-04). A four-ball at 393px was four
   * eighteen-column grids, each scrolled sideways to the hole being played and
   * each with its own Save button. The hole view puts every card in the match
   * on the hole — both sides, with each player's shots — and saves them
   * together. Grid on a desk, as before; switched on mount for the hydration
   * reason StrokePlayEntry gives.
   */
  const [view, setView] = useState<"hole" | "card">(casual ? "hole" : "card");
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setView("hole");
  }, []);

  /**
   * A CASUAL ROUND'S CARDS SAVE THEMSELVES — the cards this phone changed, and
   * no others, for the reason `StrokePlayEntry` gives: a friend keeping their
   * own card by the round's code must not have it overwritten by this phone's
   * stale copy. A refusal is named and not retried until the card changes or
   * Try again is pressed.
   */
  const allCards = useMemo(
    () => teams.flatMap((t) => t.cards.map((c) => ({ t, c, key: keyFor(t.teamId, t.matchId, c.playerId) }))),
    [teams],
  );
  const sigOf = (key: string, stored: (number | null)[]) =>
    JSON.stringify([draft[key] ?? stored, pickUp ? picksFor(key) : []]);
  const lastSent = useRef<Record<string, string>>(
    Object.fromEntries(
      allCards.map(({ c, key }) => [
        key,
        JSON.stringify([[...c.strokes], pickUp ? Array.from({ length: holes }, (_, h) => c.pickedUp?.[h] === true) : []]),
      ]),
    ),
  );
  const refused = useRef("");
  const [retry, setRetry] = useState(0);
  const [autoNote, setAutoNote] = useState<{ text: string; at: string } | null>(null);
  const everything = JSON.stringify([draft, picks]);
  useEffect(() => {
    if (!casual || pending || refused.current === everything) return;
    const changed = allCards.filter(({ c, key }) => {
      if (sigOf(key, c.strokes) === lastSent.current[key]) return false;
      return (draft[key] ?? c.strokes).some((v) => v != null) || (pickUp && picksFor(key).some(Boolean));
    });
    if (changed.length === 0) return;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const failed: string[] = [];
        for (const { t, c, key } of changed) {
          const sent = sigOf(key, c.strokes);
          const who = c.playerId ? c.playerName : t.teamName;
          try {
            const res = await saveTeamScorecard(t.teamId, c.playerId, t.matchId, draft[key] ?? c.strokes, pickUp ? picksFor(key) : undefined);
            if (res.ok) lastSent.current[key] = sent;
            else failed.push(`${who}: ${res.error ?? "not saved"}`);
          } catch {
            failed.push(`${who}: not saved`);
          }
        }
        refused.current = failed.length ? everything : "";
        setAutoNote({ text: failed.length ? `Not saved — ${failed.join("; ")}` : "Saved.", at: everything });
      });
    }, 600);
    return () => window.clearTimeout(timer);
    // `retry` re-arms it after a refusal; the rest is what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casual, everything, pending, retry]);
  // Only while it is still true of what is on screen.
  const autoShown = autoNote && autoNote.at === everything ? autoNote : null;
  const autoFailed = !!autoShown && autoShown.text !== "Saved.";

  /** A casual card's foot: whether it has saved, and the other window. */
  const casualFoot = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid var(--color-divider)" }}>
      <span role="status" aria-live="polite" style={{ fontSize: 14, minWidth: 0, color: autoFailed ? "var(--color-danger)" : "var(--color-neutral-400)" }}>
        {pending ? "Saving…" : autoShown?.text ?? ""}
      </span>
      <span style={{ display: "flex", gap: 8 }}>
        {autoFailed && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: 44 }}
            onClick={() => {
              refused.current = "";
              setRetry((n) => n + 1);
            }}
          >
            Try again
          </button>
        )}
        <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => setView(view === "hole" ? "card" : "hole")}>
          <Icon name={view === "hole" ? "ph ph-table" : "ph ph-flag"} /> {view === "hole" ? "See the full card" : "Back to the hole"}
        </button>
      </span>
    </div>
  );
  const groups = useMemo(() => holeGroups(teams), [teams]);
  const [groupKey, setGroupKey] = useState(groups[0]?.key ?? "");
  const group = groups.find((g) => g.key === groupKey) ?? groups[0];
  /** What the hole view last saved, so "Saved." is only said while true. */
  const [savedDraft, setSavedDraft] = useState("");
  const groupDraft = group
    ? JSON.stringify(
        group.rows.map(({ team, card }) => {
          const key = keyFor(team.teamId, team.matchId, card.playerId);
          return [draft[key] ?? card.strokes, pickUp ? picksFor(key) : []];
        }),
      )
    : "";

  /**
   * Every card in the group that has a score on it — and, as on the stroke
   * round, ONE BAD CARD MUST NOT TAKE THE REST WITH IT: each is saved on its
   * own, and any that fail are named rather than lost under a "Saved".
   */
  const saveGroup = () => {
    if (!group) return;
    setError("");
    startTransition(async () => {
      const failed: string[] = [];
      for (const { team, card } of group.rows) {
        const key = keyFor(team.teamId, team.matchId, card.playerId);
        const strokes = draft[key] ?? card.strokes;
        const cardPicks = picksFor(key);
        // Nothing on it — no score and no pick-up — is a card left alone.
        if (!strokes.some((s) => s != null) && !(pickUp && cardPicks.some(Boolean))) continue;
        const who = card.playerId ? card.playerName : team.teamName;
        try {
          const res = await saveTeamScorecard(team.teamId, card.playerId, team.matchId, strokes, pickUp ? cardPicks : undefined);
          if (!res.ok) failed.push(`${who}: ${res.error ?? "not saved"}`);
        } catch {
          failed.push(`${who}: not saved`);
        }
      }
      if (failed.length) setError(`Not saved — ${failed.join("; ")}`);
      else setSavedDraft(groupDraft);
    });
  };

  const save = (teamId: string, playerId: string, matchId: string, saved: (number | null)[]) => {
    const key = keyFor(teamId, matchId, playerId);
    // Falls back to what the server already holds, never to an empty card —
    // an untouched draft must not blank a score somebody already returned.
    const strokes = draft[key] ?? saved;
    setError("");
    startTransition(async () => {
      const res = await saveTeamScorecard(teamId, playerId, matchId, strokes, pickUp ? picksFor(key) : undefined);
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: casual ? 12 : 16 }}>
      {!casual && (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {round} —{" "}
          {note}
        </p>
      )}

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

      {teams.length > 0 && !casual && (
        <div style={{ display: "flex", gap: 6 }}>
          {(["hole", "card"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="btn btn-secondary"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              style={
                view === v
                  ? { color: "var(--color-accent-200)", borderColor: "var(--color-accent)", fontSize: 13 }
                  : { fontSize: 13 }
              }
            >
              <Icon name={v === "hole" ? "ph ph-flag" : "ph ph-table"} /> {v === "hole" ? "Hole by hole" : "Full card"}
            </button>
          ))}
        </div>
      )}

      {view === "hole" && group && (
        // A casual round's hole card is not framed twice.
        <div className={casual ? undefined : "card elev-sm"} style={{ gap: 12, ...(casual ? { display: "flex", flexDirection: "column" } : {}) }}>
          {groups.length > 1 && (
            <div className="field">
              <label htmlFor="team-hole-group">Scoring</label>
              <select id="team-hole-group" className="input" value={group.key} onChange={(e) => setGroupKey(e.target.value)}>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <HoleByHoleCard
            players={group.rows.map(({ team, card }) => ({
              id: keyFor(team.teamId, team.matchId, card.playerId),
              name: card.playerId ? card.playerName : team.teamName,
              // A side's one card is called by the side's name, in full —
              // never shortened as if it were a person.
              ...(card.playerId ? {} : { label: team.teamName }),
              shotsOn: (h: number) => card.shots?.[h] ?? 0,
            }))}
            cards={Object.fromEntries(
              group.rows.map(({ team, card }) => {
                const key = keyFor(team.teamId, team.matchId, card.playerId);
                return [key, draft[key] ?? card.strokes];
              }),
            )}
            pars={pars}
            yards={[]}
            strokeIndex={strokeIndex}
            holes={holes}
            firstHole={firstHole}
            // The holder's own card, by its key, so the mic hears "me". A
            // side's one card belongs to nobody in particular.
            meId={(() => {
              const mine = meId ? group.rows.find(({ card }) => card.playerId === meId) : undefined;
              return mine ? keyFor(mine.team.teamId, mine.team.matchId, mine.card.playerId) : undefined;
            })()}
            voice={casual}
            dense={casual}
            onSet={(key, hole, value) => setHole(key, hole, value)}
            {...(pickUp
              ? {
                  pickedUp: Object.fromEntries(
                    group.rows.map(({ team, card }) => {
                      const key = keyFor(team.teamId, team.matchId, card.playerId);
                      return [key, picksFor(key)];
                    }),
                  ),
                  onPickUp: (key: string, hole: number, on: boolean) => setPick(key, hole, on),
                }
              : {})}
          />
          {casual ? (
            casualFoot
          ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            {savedDraft === groupDraft && savedDraft !== "" && (
              <span role="status" className="text-muted" style={{ fontSize: 13 }}>
                Saved.
              </span>
            )}
            <button type="button" className="btn btn-primary" disabled={pending} onClick={saveGroup}>
              <Icon name="check" /> {pending ? "Saving…" : "Save scores"}
            </button>
          </div>
          )}
        </div>
      )}

      {view === "card" && teams.map((t) => (
        <div key={`${t.teamId}:${t.matchId}`} className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="card-title" style={{ fontSize: 15 }}>{t.teamName}</span>
            {t.opponentName && (
              <span className="text-muted" style={{ fontSize: 13 }}>v {t.opponentName}</span>
            )}
            {/* No tooltip: "Plays off 12" IS the playing handicap, said in
                the words a side would use.

                Only where the SIDE plays one ball (a single "Team card"). In a
                four-ball each player plays off their own strokes, shown on
                their own row, and a side figure beside them — "Plays off 37"
                over a 17 and a 24 — is a number nothing on the card uses. */}
            {t.cards.some((c) => c.playerId === "") && (
              <span className="tag tag-neutral">
                Plays off {t.playingHandicap}
              </span>
            )}
            <span className="text-muted" style={{ fontSize: 13, marginLeft: "auto" }}>
              {t.played > 0 ? `${t.grossTotal} gross · ${t.netTotal} net · ${t.played} holes` : "No score yet"}
            </span>
          </div>

          {t.cards.map((c) => {
            const key = keyFor(t.teamId, t.matchId, c.playerId);
            const values = draft[key] ?? c.strokes;
            /* The same cell the individual card and the match card use. A
               team's card is still one player's eighteen numbers; that it is
               summed with three others afterwards changes nothing about the
               box they go in. */
            const scoreCell = (i: number) => (
              <ScoreCell
                key={i}
                hole={i}
                firstHole={firstHole}
                value={values[i] ?? null}
                par={pars[i]}
                who={c.playerId ? c.playerName : t.teamName}
                onSet={(v) => setHole(key, i, v)}
                {...(pickUp ? { pickedUp: picksFor(key)[i], onPickUp: (on: boolean) => setPick(key, i, on) } : {})}
              />
            );
            return (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {c.playerId ? c.playerName : "Team card"}
                  </span>
                  {c.playerId !== "" && (
                    <span className="text-muted" style={{ fontSize: 13 }}>h/cap {indexLabel(c)}</span>
                  )}
                  {/* A casual card saves itself — see `lastSent`. */}
                  {!casual && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginLeft: "auto" }}
                    disabled={pending}
                    onClick={() => save(t.teamId, c.playerId, t.matchId, c.strokes)}
                  >
                    {pending ? "Saving…" : "Save card"}
                  </button>
                  )}
                </div>
                <div className="sc-wrap">
                  <table className="sc" style={{ minWidth: holes > 9 ? 960 : 560 }}>
                    <thead>
                      <tr>
                        <th>Hole</th>
                        {front.map((i) => (<th key={i}>{holeNumber(i, firstHole)}</th>))}
                        {isEighteen && <th className="sc-tot">Out</th>}
                        {back.map((i) => (<th key={i}>{holeNumber(i, firstHole)}</th>))}
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
                            <td key={i} style={{ color: "var(--color-accent-200)", fontWeight: 700 }}>
                              {c.shots?.[i] ? "•".repeat(c.shots[i]) : ""}
                            </td>
                          ))}
                          {isEighteen && <td className="sc-tot">{totalOf(c.shots ?? [], 0, 9)}</td>}
                          {back.map((i) => (
                            <td key={i} style={{ color: "var(--color-accent-200)", fontWeight: 700 }}>
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
      {view === "card" && casual && teams.length > 0 && casualFoot}
    </div>
  );
}
