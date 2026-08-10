"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FieldInfo from "@/components/FieldInfo";
import {
  createTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  autoDrawTeams,
  generateTeamMatches,
  setStageAllowance,
  setStageAllowanceWeights,
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
  const [editingAllowance, setEditingAllowance] = useState(false);
  const [allowance, setAllowance] = useState("");
  const [editingShares, setEditingShares] = useState(false);
  const [shares, setShares] = useState<string[]>([]);
  const [addingTo, setAddingTo] = useState("");

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

        {/* The allowance is a committee decision, not a rule, but almost every
            round wants the recommended one — so it reads as a plain statement
            until someone chooses to change it. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            Handicap allowance <b style={{ color: "var(--color-text)" }}>{format.allowance}%</b>
            {format.allowanceOverridden
              ? ` — set by your committee, in place of the usual ${format.recommendedAllowance}%.`
              : format.allowanceIsConvention
                ? " — the common club convention for this format, not a published standard."
                : " — the recommended allowance for this format."}
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "2px 10px", fontSize: 12 }}
            onClick={() => {
              setAllowance(String(format.allowance));
              setEditingAllowance((o) => !o);
            }}
          >
            {editingAllowance ? "Cancel" : "Change"}
          </button>
        </div>

        {editingAllowance && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              className="input"
              inputMode="numeric"
              style={{ width: 90 }}
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
              aria-label="Handicap allowance percent"
            />
            <span className="text-muted" style={{ fontSize: 12 }}>% of course handicap</span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => {
                const n = parseInt(allowance, 10);
                run(() => setStageAllowance(activeRoundId, Number.isFinite(n) ? n : -1));
                setEditingAllowance(false);
              }}
            >
              Save
            </button>
            {format.allowanceOverridden && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => {
                  run(() => setStageAllowance(activeRoundId, 0));
                  setEditingAllowance(false);
                }}
              >
                Back to {format.recommendedAllowance}%
              </button>
            )}
          </div>
        )}

        {/* Formats scored by a per-player split get their own control. A flat
            percentage cannot express greensomes' 60/40, and clubs genuinely
            differ — 50/50 and 55/45 are both played. */}
        {format.shares && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Handicap split{" "}
              <b style={{ color: "var(--color-text)" }}>{format.shares.join(" / ")}</b>
              {format.sharesOverridden
                ? ` — set by your committee, in place of the usual ${format.recommendedShares?.join(" / ")}.`
                : " — the recommended split for this format."}
              <FieldInfo label="the handicap split">
                <p>
                  The shares are applied best player first: the first number is the
                  percentage of the <b>lower</b> handicap, the second the percentage of
                  the <b>higher</b>.
                </p>
                <p>
                  Greensomes is 60 / 40 because taking the better of two drives is an
                  advantage, so the side plays off fewer strokes than an alternate-shot
                  pair of the same two players.
                </p>
                <p>The shares do not have to add up to 100.</p>
              </FieldInfo>
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 10px", fontSize: 12 }}
              onClick={() => {
                setShares(format.shares!.map(String));
                setEditingShares((o) => !o);
              }}
            >
              {editingShares ? "Cancel" : "Change"}
            </button>
          </div>
        )}

        {editingShares && format.shares && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {shares.map((v, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input
                  className="input"
                  inputMode="numeric"
                  style={{ width: 70 }}
                  value={v}
                  onChange={(e) =>
                    setShares((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                  }
                  aria-label={i === 0 ? "Share of the lower handicap, percent" : `Share ${i + 1}, percent`}
                />
                <span className="text-muted" style={{ fontSize: 12 }}>%</span>
              </span>
            ))}
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => {
                const nums = shares.map((s) => parseInt(s, 10));
                run(() =>
                  setStageAllowanceWeights(
                    activeRoundId,
                    nums.map((n) => (Number.isFinite(n) ? n : -1)),
                  ),
                );
                setEditingShares(false);
              }}
            >
              Save
            </button>
            {format.sharesOverridden && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => {
                  run(() => setStageAllowanceWeights(activeRoundId, []));
                  setEditingShares(false);
                }}
              >
                Back to {format.recommendedShares?.join(" / ")}
              </button>
            )}
          </div>
        )}
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
          disabled={pending || teams.length < 2}
          title={teams.length < 2 ? "Draw at least two sides first" : undefined}
          onClick={() => makeMatches(false)}
        >
          <i className="ph ph-arrows-clockwise" /> {matchCount > 0 ? "Regenerate" : "Generate"} matches
        </button>
      </div>

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
          return (
            <div key={t.id} className="card elev-sm" style={{ gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="card-title" style={{ fontSize: 14, flex: 1 }}>{t.name}</span>
                <span className="tag tag-neutral" title="The side's playing handicap under this format">
                  {t.playingHandicap}
                </span>
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
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pending || t.members.length >= format.max || unassigned.length === 0}
                  onClick={() => setAddingTo(t.id)}
                >
                  <i className="ph ph-user-plus" /> Add player
                </button>
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
