"use client";
import { useState } from "react";
import { createCupTeams, renameCupTeam, setCupPlayerTeam } from "@/app/actions/cup";
import { setFlightCaptain } from "@/app/actions/attendance";
import { useAction } from "./useAction";
import { indexLabel } from "@/lib/domain/handicap-label";

interface Person {
  id: string;
  name: string;
  handicap: number;
  /** ghin | manual | none — `indexLabel` says "no index" rather than a scratch 0. */
  handicapSource?: string | null;
  handicapType?: string | null;
}
interface Team {
  id: string;
  name: string;
  captainId: string;
  players: Person[];
}

/**
 * MAKE THE TWO TEAMS — the first thing a cup needs, offered where the cup is
 * run (2026-10-06). It used to be "set up exactly two flights on Flights, with
 * the Manual rule": a screen about formation rules and flight sizes, for an
 * organizer who wanted to type two names.
 */
export function CreateCupTeams() {
  const { pending, error, run } = useAction();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  return (
    <form
      className="card elev-sm"
      aria-label="Make the two teams"
      style={{ display: "grid", gap: 12, maxWidth: "62ch" }}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createCupTeams(a, b));
      }}
    >
      <span className="card-title" style={{ fontSize: 16 }}>Your two teams</span>
      <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
        Name them, then put each player on one. The captains pick the pairs for each session after that.
      </p>
      {error && (
        <p role="alert" className="form-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <div className="field">
          <label htmlFor="cup-team-a">First team</label>
          <input id="cup-team-a" className="input" value={a} placeholder="e.g. Blues" onChange={(e) => setA(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cup-team-b">Second team</label>
          <input id="cup-team-b" className="input" value={b} placeholder="e.g. Whites" onChange={(e) => setB(e.target.value)} />
        </div>
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending || !a.trim() || !b.trim()}>
          Make the teams
        </button>
      </div>
    </form>
  );
}

/**
 * WHO IS ON WHICH TEAM, and who captains it. A player in a lineup stays where
 * they are until that match is removed — moving them would leave a match whose
 * side is on the wrong team.
 */
export function CupTeams({ teams, unplaced, inLineup }: { teams: [Team, Team]; unplaced: Person[]; inLineup: string[] }) {
  const { pending, error, run } = useAction();
  const busy = new Set(inLineup);
  return (
    <section aria-labelledby="cup-teams" style={{ marginTop: 8, marginBottom: 16 }}>
      <h2 id="cup-teams" className="card-title" style={{ fontSize: 18, margin: "0 0 10px" }}>
        Teams
      </h2>
      {error && (
        <p role="alert" className="form-error" style={{ margin: "0 0 10px" }}>
          {error}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {teams.map((t) => (
          <TeamCard key={t.id} team={t} unplaced={unplaced} busy={busy} pending={pending} run={run} />
        ))}
      </div>
      <p className="text-muted" style={{ margin: "10px 0 0", fontSize: 14 }}>
        {unplaced.length === 0
          ? "Everybody entered is on a team."
          : `Not on a team yet: ${unplaced.map((p) => p.name).join(", ")}.`}
      </p>
    </section>
  );
}

function TeamCard({
  team,
  unplaced,
  busy,
  pending,
  run,
}: {
  team: Team;
  unplaced: Person[];
  busy: Set<string>;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => void;
}) {
  const [name, setName] = useState(team.name);
  const renamed = name.trim() !== team.name && name.trim() !== "";
  return (
    <div className="card elev-sm" role="group" aria-label={`Team ${team.name}`} style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "1 1 140px", minWidth: 0, margin: 0 }}>
          <label htmlFor={`cup-name-${team.id}`}>Team name</label>
          <input id={`cup-name-${team.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {renamed && (
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => renameCupTeam(team.id, name))}>
            Save name
          </button>
        )}
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label htmlFor={`cup-captain-${team.id}`}>Captain</label>
        <select
          id={`cup-captain-${team.id}`}
          className="input"
          value={team.captainId}
          disabled={pending || team.players.length === 0}
          onChange={(e) => run(() => setFlightCaptain(team.id, e.target.value || null))}
        >
          <option value="">{team.players.length ? "No captain yet" : "Add players first"}</option>
          {team.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {team.players.length === 0 && <li className="text-muted" style={{ fontSize: 14 }}>Nobody on this team yet.</li>}
        {team.players.map((p) => (
          <li key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 14 }}>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {p.name} <span className="text-muted">· {indexLabel(p)}</span>
              {p.id === team.captainId && <span className="tag tag-accent" style={{ marginLeft: 6 }}>Captain</span>}
            </span>
            {busy.has(p.id) ? (
              <span className="text-muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>In a lineup</span>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                aria-label={`Take ${p.name} off ${team.name}`}
                disabled={pending}
                onClick={() => run(() => setCupPlayerTeam(p.id, ""))}
              >
                Take off
              </button>
            )}
          </li>
        ))}
      </ul>

      {unplaced.length > 0 && (
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`cup-add-${team.id}`}>Add a player</label>
          <select
            id={`cup-add-${team.id}`}
            className="input"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && run(() => setCupPlayerTeam(e.target.value, team.id))}
          >
            <option value="">Add to {team.name}…</option>
            {unplaced.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {indexLabel(p)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
