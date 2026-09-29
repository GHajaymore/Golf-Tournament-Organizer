"use client";
import { useState } from "react";
import { addCupMatch, removeCupMatch, setCupSettings } from "@/app/actions/cup";
import { useAction } from "./useAction";
import { ConfirmButton } from "./ConfirmButton";

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => void;

interface Person {
  id: string;
  name: string;
}
interface Team {
  id: string;
  name: string;
  players: Person[];
}
interface Session {
  id: string;
  name: string;
  kind: string;
  sideSize: number;
  matches: { id: string; a: string[]; b: string[]; started: boolean }[];
  /** Players already in a match this session. */
  busy: string[];
}

/**
 * THE CAPTAINS' LINEUP, entered by the organizer: for each session, who plays
 * whom. Pick a pair (or a single player for singles) from each team and add
 * the match. The server checks every choice again — right team, confirmed,
 * nobody twice in one session.
 */
export function CupLineup({
  teams,
  sessions,
  pointsToWin,
  holder,
}: {
  teams: [Team, Team];
  sessions: Session[];
  pointsToWin: number;
  holder: string;
}) {
  const { pending, error, run } = useAction();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && (
        <p role="alert" className="form-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <CupSettings teams={teams} pointsToWin={pointsToWin} holder={holder} pending={pending} run={run} />
      {sessions.map((s) => (
        <SessionLineup key={s.id} session={s} teams={teams} pending={pending} run={run} />
      ))}
    </div>
  );
}

function CupSettings({
  teams,
  pointsToWin,
  holder,
  pending,
  run,
}: {
  teams: [Team, Team];
  pointsToWin: number;
  holder: string;
  pending: boolean;
  run: Run;
}) {
  const [target, setTarget] = useState(pointsToWin > 0 ? String(pointsToWin) : "");
  const [who, setWho] = useState(holder);
  return (
    <form
      className="card elev-sm"
      style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setCupSettings(Number(target.replace("½", ".5")) || 0, who));
      }}
    >
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Points to win
        <input
          id="cup-target"
          className="input"
          inputMode="decimal"
          value={target}
          placeholder="More than half"
          onChange={(e) => setTarget(e.target.value)}
          style={{ width: 140 }}
        />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Holder (keeps it on a tie)
        <select id="cup-holder" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Nobody — a tie is shared</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        Save
      </button>
    </form>
  );
}

function SessionLineup({
  session,
  teams,
  pending,
  run,
}: {
  session: Session;
  teams: [Team, Team];
  pending: boolean;
  run: Run;
}) {
  const blank = () => new Array(session.sideSize).fill("");
  const [a, setA] = useState<string[]>(blank);
  const [b, setB] = useState<string[]>(blank);
  const busy = new Set(session.busy);
  const picker = (team: Team, picks: string[], set: (v: string[]) => void, side: string) =>
    picks.map((value, i) => (
      <select
        key={i}
        id={`cup-${session.id}-${side}-${i}`}
        aria-label={`${team.name} player ${i + 1}, ${session.name}`}
        className="input"
        value={value}
        onChange={(e) => set(picks.map((p, j) => (j === i ? e.target.value : p)))}
      >
        <option value="">{team.name}…</option>
        {team.players
          .filter((p) => !busy.has(p.id) && (p.id === value || !picks.includes(p.id)))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    ));
  const ready = a.every(Boolean) && b.every(Boolean);
  // Nobody left to pick on one side: say so, rather than offer empty pickers.
  const full = teams.some((t) => t.players.filter((p) => !busy.has(p.id)).length < session.sideSize);

  return (
    <section className="card elev-sm" aria-label={`${session.name} lineup`}>
      <h2 className="card-title" style={{ fontSize: 16, margin: 0 }}>
        {session.name} · {session.kind}
      </h2>
      <ul style={{ listStyle: "none", margin: "10px 0", padding: 0, display: "grid", gap: 6 }}>
        {session.matches.length === 0 && <li className="text-muted" style={{ fontSize: 13 }}>No matches yet.</li>}
        {session.matches.map((m) => (
          <li key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 14 }}>
            <span style={{ minWidth: 0 }}>
              {m.a.join(" & ")} <span className="text-muted">v</span> {m.b.join(" & ")}
            </span>
            {!m.started && (
              <ConfirmButton
                title={`Remove ${m.a.join(" & ")} v ${m.b.join(" & ")}`}
                confirmLabel="Remove match"
                disabled={pending}
                onConfirm={() => run(() => removeCupMatch(m.id))}
              />
            )}
          </li>
        ))}
      </ul>
      {full ? (
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          Everyone who can play in this session has a match. Remove one to change the lineup.
        </p>
      ) : (
      <form
        style={{ display: "grid", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          run(
            () => addCupMatch(session.id, a, b),
            () => {
              setA(blank());
              setB(blank());
            },
          );
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          {picker(teams[0], a, setA, "a")}
          {picker(teams[1], b, setB, "b")}
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={!ready || pending}>
            Add match
          </button>
        </div>
      </form>
      )}
    </section>
  );
}
