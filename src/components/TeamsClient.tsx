"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  autoDrawTeams,
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
}: {
  rounds: RoundRow[];
  activeRoundId: string;
  format: FormatInfo;
  teams: TeamRow[];
  problems: ProblemRow[];
  unassigned: { id: string; name: string; handicap: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [confirmDraw, setConfirmDraw] = useState(false);
  const [addingTo, setAddingTo] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
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
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Handicap allowance {format.allowance}%
          {format.allowanceIsConvention
            ? " — the common club convention for this format, not a published standard. Change it if your committee sets its own."
            : " — the recommended allowance for this format."}
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
      </div>
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
