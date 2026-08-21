"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sideDrawReadiness, sideAddBlock } from "@/lib/domain/draw-readiness";
import {
  createTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  autoDrawTeams,
  generateTeamMatches,
} from "@/app/actions/teams";

export interface TeamMemberRow {
  playerId: string;
  name: string;
  handicap: number;
  position: number;
}

export interface TeamRow {
  id: string;
  name: string;
  seed: number;
  stageId: string | null;
  members: TeamMemberRow[];
  playingHandicap: number;
}

export interface RoundRow {
  id: string;
  label: string;
  format: string;
}

export interface FormatInfo {
  name: string;
  desc: string;
  min: number;
  max: number;
  sharesOneCard: boolean;
  allowance: number;
  /** What the format recommends, when a committee has overridden it. */
  recommendedAllowance: number;
  allowanceOverridden: boolean;
  /** The per-player shares in force, best player first, or null for a format
   *  that isn't scored by a split at all. */
  shares: number[] | null;
  /** The split the format itself recommends. */
  recommendedShares: number[] | null;
  sharesOverridden: boolean;
  /** How many partners' scores count on a hole, or null for a format that
   *  doesn't aggregate separate balls. */
  countBest: number | null;
  countBestOverridden: boolean;
  maxCountBest: number;
  allowanceIsConvention: boolean;
}

export interface ProblemRow {
  teamId: string;
  teamName: string;
  problem: string;
}

export function TeamsClient({
  rounds,
  activeRoundId,
  format,
  teams,
  problems,
  unassigned,
  matchCount,
}: {
  rounds: RoundRow[];
  activeRoundId: string;
  format: FormatInfo;
  teams: TeamRow[];
  problems: ProblemRow[];
  unassigned: { id: string; name: string; handicap: number }[];
  /** Matches already generated for this round. */
  matchCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [confirmDraw, setConfirmDraw] = useState(false);
  const [confirmMatches, setConfirmMatches] = useState(false);
  const [addingTo, setAddingTo] = useState("");

  // Why matches cannot be drawn yet, or null. Rendered under the button rather
  // than hidden in a `title`.
  const sideBlock = sideDrawReadiness({ sideCount: teams.length });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const makeMatches = (replace: boolean) => {
    setError("");
    startTransition(async () => {
      const res = await generateTeamMatches(activeRoundId, replace);
      if (res.needsConfirm) {
        setConfirmMatches(true);
        return;
      }
      setConfirmMatches(false);
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const draw = (replace: boolean) => {
    setError("");
    startTransition(async () => {
      const res = await autoDrawTeams(activeRoundId, replace);
      if (res.needsConfirm) {
        setConfirmDraw(true);
        return;
      }
      setConfirmDraw(false);
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const sizeText =
    format.min === format.max ? `${format.min} players` : `${format.min}–${format.max} players`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* What this format actually is, so nobody has to remember. */}
      <div className="card elev-sm" style={{ gap: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="card-title" style={{ fontSize: 15 }}>{format.name}</span>
          <span className="tag tag-outline">{sizeText} a side</span>
          <span className="tag tag-neutral">
            {format.sharesOneCard ? "One ball per side" : "Everyone plays their own ball"}
          </span>
          {rounds.length > 1 && (
            <select
              className="input"
              style={{ marginLeft: "auto", maxWidth: 280 }}
              value={activeRoundId}
              onChange={(e) => router.push(`/teams?round=${e.target.value}`)}
            >
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          )}
        </div>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{format.desc}</p>

        {/* Handicaps, the split and how many balls count moved onto the round
            card in Rounds & formats. They are settings of the round, and this
            screen had its own round selector — so the same round was being
            configured in two places, neither mentioning the other. */}
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Handicap allowance <b style={{ color: "var(--color-text)" }}>{format.allowance}%</b>
          {format.shares ? ` · split ${format.shares.join(" / ")}` : ""}
          {format.countBest !== null ? ` · best ${format.countBest} of ${format.max}` : ""}
          {" — set on "}
          <a href="/stages">Rounds &amp; formats</a>.
        </p>
      </div>

      {problems.length > 0 && (
        <div className="card elev-sm" style={{ gap: 6, borderLeft: "3px solid var(--color-danger)" }}>
          <span className="card-title" style={{ fontSize: 14 }}>
            {problems.length === 1 ? "One side isn't ready" : `${problems.length} sides aren't ready`}
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            Better to fix now than on the first tee.
          </p>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {problems.map((p) => (
              <li key={p.teamId}>{p.teamName} {p.problem}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>{error}</p>
      )}

      {confirmDraw && (
        <div className="card elev-sm" style={{ gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
          <span className="card-title" style={{ fontSize: 14 }}>Replace the existing sides?</span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            This round already has teams. Drawing again discards them and starts over.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => draw(true)}>
              Replace and redraw
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDraw(false)}>
              Keep them
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label>Add a team</label>
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. The Slicers"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                run(() => createTeam(newName, activeRoundId));
                setNewName("");
              }
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || !newName.trim()}
          onClick={() => {
            run(() => createTeam(newName, activeRoundId));
            setNewName("");
          }}
        >
          <i className="ph ph-plus" /> Add team
        </button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => draw(false)}>
          <i className="ph ph-shuffle" /> Draw sides automatically
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || !!sideBlock}
          onClick={() => makeMatches(false)}
        >
          <i className="ph ph-arrows-clockwise" /> {matchCount > 0 ? "Regenerate" : "Generate"} matches
        </button>
      </div>

      {/* The reason the button above is dead, on the page rather than in a
          `title` — which never appears on a touch device and is not announced.
          The last surviving instance of that pattern, flagged in the
          2026-08-18 session record and left for whoever was next in this file.

          No link: both ways out are controls on this screen, so it names them
          by the words on them instead of pointing somewhere. */}
      {sideBlock && (
        <p
          style={{
            fontSize: 12.5,
            margin: 0,
            lineHeight: 1.5,
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "9px 11px",
            borderRadius: 9,
            background: "color-mix(in srgb, var(--color-text) 5%, transparent)",
          }}
        >
          <i className="ph ph-info" style={{ fontSize: 14, marginTop: 1, flex: "none" }} />
          <span>{sideBlock.problem}</span>
        </p>
      )}

      {confirmMatches && (
        <div className="card elev-sm" style={{ gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
          <span className="card-title" style={{ fontSize: 14 }}>Replace this round&apos;s matches?</span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            This round already has {matchCount} {matchCount === 1 ? "match" : "matches"}. Regenerating
            discards them and pairs the sides again.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => makeMatches(true)}>
              Replace them
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmMatches(false)}>
              Keep them
            </button>
          </div>
        </div>
      )}
      <p className="text-muted" style={{ fontSize: 12, margin: "-8px 0 0" }}>
        An automatic draw balances the sides by handicap, pairing stronger players with weaker ones —
        otherwise a field with a wide spread is decided at registration rather than on the course.
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {teams.map((t) => {
          const short = t.members.length < format.min;
          // Why "Add player" is dead, if it is. Three reasons shared one
          // disabled attribute and none of them was on the screen.
          const addBlock = sideAddBlock({
            sideSize: t.members.length,
            max: format.max,
            unassignedCount: unassigned.length,
            formatName: format.name,
          });
          return (
            <div key={t.id} className="card elev-sm" style={{ gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="card-title" style={{ fontSize: 14, flex: 1 }}>{t.name}</span>
                {/* Says what the number IS. It rendered as a bare "14" beside
                    the side's name with its meaning in a `title` — a number
                    with no label, on a screen whose whole subject is handicaps,
                    explained only to a mouse. */}
                <span className="tag tag-neutral">Plays off {t.playingHandicap}</span>
                <button
                  type="button"
                  className="btn btn-icon"
                  title="Remove team"
                  disabled={pending}
                  onClick={() => run(() => deleteTeam(t.id))}
                >
                  <i className="ph ph-trash" />
                </button>
              </div>

              {t.members.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>Nobody on this side yet.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                  {t.members.map((m) => (
                    <li key={m.playerId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{m.name}</span>
                      <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {m.handicap}
                      </span>
                      <button
                        type="button"
                        className="btn btn-icon"
                        title={`Remove ${m.name}`}
                        disabled={pending}
                        onClick={() => run(() => removeTeamMember(t.id, m.playerId))}
                      >
                        <i className="ph ph-x" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {short && (
                <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                  Needs {format.min - t.members.length} more.
                </p>
              )}

              {addingTo === t.id ? (
                <select
                  className="input"
                  autoFocus
                  value=""
                  onChange={(e) => {
                    if (e.target.value) run(() => addTeamMember(t.id, e.target.value));
                    setAddingTo("");
                  }}
                  onBlur={() => setAddingTo("")}
                >
                  <option value="">Choose a player…</option>
                  {unassigned.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.handicap})</option>
                  ))}
                </select>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pending || !!addBlock}
                    onClick={() => setAddingTo(t.id)}
                  >
                    <i className="ph ph-user-plus" /> Add player
                  </button>
                  {/* The reason, on the card. This button carried three
                      conditions in one `disabled` and explained none of them,
                      so an organizer looking at a full four-ball could not tell
                      whether the side was full or the field was exhausted. The
                      same defect the Generate matches button on this very
                      screen was fixed for earlier. */}
                  {addBlock && (
                    <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.45 }}>
                      {addBlock.problem}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {unassigned.length > 0 && (
        <div className="card elev-sm" style={{ gap: 6 }}>
          <span className="card-title" style={{ fontSize: 14 }}>
            Not on a side yet ({unassigned.length})
          </span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            {unassigned.map((p) => p.name).join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
