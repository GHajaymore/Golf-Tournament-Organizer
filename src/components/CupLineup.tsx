"use client";
import { useState } from "react";
import { addCupMatch, removeCupMatch, setCupSettings, publishCupLineup, hideCupLineup, nameCupSession } from "@/app/actions/cup";
import { forfeitMatch } from "@/app/actions/tournament";
import { useAction } from "./useAction";
import { figureOr, readDecimal } from "@/lib/domain/decimal-text";
import { ConfirmButton } from "./ConfirmButton";
import { bringIntoView } from "@/lib/bring-into-view";

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
  /** Whether the lineup has been announced to the players and the public board. */
  published: boolean;
  matches: {
    id: string;
    a: string[];
    b: string[];
    /** A shot, or a concession, is recorded in it. */
    started: boolean;
    final: boolean;
    /** "3&2", "Conceded", "2 UP thru 9" — the board's own words. */
    label: string;
    /** What each team is stored under on the match — a concession names it. */
    aSideId: string;
    bSideId: string;
    conceded: "A" | "B" | null;
  }[];
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
  /** The figure refused, said beside Save. */
  const [said, setSaid] = useState("");
  return (
    <form
      className="card elev-sm"
      style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
      onSubmit={(e) => {
        e.preventDefault();
        // "14,5" is fourteen and a half (`decimalPoint`): read as nothing, it set the cup back to
        // "more than half" without a word. An empty box IS "more than half"; anything else that is
        // not a figure is refused beside Save — "abc" did the same as "14,5" until 2026-10-21 (the
        // text-box crawl).
        const read = readDecimal(target.replace("½", ".5"));
        const points = read.kind === "blank" ? 0 : figureOr(read, Number.NaN);
        if (!Number.isFinite(points) || points < 0 || points > 200 || Math.round(points * 2) !== points * 2) {
          setSaid("Points to win is a whole or half number, like 14½ — or leave it empty for more than half.");
          return;
        }
        setSaid("");
        run(() => setCupSettings(points, who));
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
      {said && (
        <p role="alert" className="form-error" style={{ margin: 0, flexBasis: "100%" }} ref={bringIntoView}>
          {said}
        </p>
      )}
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

  const underWay = session.matches.some((m) => m.started);
  return (
    <section className="card elev-sm" aria-label={`${session.name} lineup`}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <h2 className="card-title" style={{ fontSize: 16, margin: 0 }}>
          {session.name} · {session.kind}
        </h2>
        <span className={`tag ${session.published ? "tag-accent" : "tag-neutral"}`}>
          {session.published ? "Announced" : "Draft"}
        </span>
        <SessionNamer stageId={session.id} name={session.name} />
      </div>
      {/* WHO CAN SEE IT, said where the lineup is built. A captain picks the
          afternoon's pairs knowing the morning's score, so each session is
          announced on its own, both teams together. */}
      <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
        {session.published
          ? "Players and the public board can see this lineup."
          : "Only staff can see this lineup until you announce it."}
      </p>
      <ul style={{ listStyle: "none", margin: "10px 0", padding: 0, display: "grid", gap: 8 }}>
        {session.matches.length === 0 && <li className="text-muted" style={{ fontSize: 13 }}>No matches yet.</li>}
        {session.matches.map((m) => (
          <li
            key={m.id}
            aria-label={`${m.a.join(" & ")} v ${m.b.join(" & ")}`}
            style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 14 }}
          >
            <span style={{ minWidth: 0 }}>
              {m.a.join(" & ")} <span className="text-muted">v</span> {m.b.join(" & ")}
              {m.label && <span className="text-muted"> · {m.conceded ? `Conceded by ${(m.conceded === "A" ? teams[0] : teams[1]).name}` : m.label}</span>}
            </span>
            <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {/* THE ORGANIZER RECORDS A CONCESSION (Rule 3.2b; Ajay,
                  2026-10-06) — the captain tells the committee, never a
                  player's button. The players' cards stay as they were. */}
              {session.published && !m.conceded && !m.final &&
                (["A", "B"] as const).map((side) => {
                  const team = side === "A" ? teams[0] : teams[1];
                  return (
                    <ConfirmButton
                      key={side}
                      className="btn btn-secondary"
                      icon="flag"
                      label={`${team.name} concede`}
                      title={`Record ${team.name} conceding ${m.a.join(" & ")} v ${m.b.join(" & ")}`}
                      confirmLabel={`${team.name} conceded`}
                      note="A full point to the other team."
                      disabled={pending}
                      onConfirm={() => run(() => forfeitMatch(m.id, side === "A" ? m.aSideId : m.bSideId))}
                    />
                  );
                })}
              {m.conceded && (
                <ConfirmButton
                  className="btn btn-secondary"
                  icon="arrow-counter-clockwise"
                  label="Undo concession"
                  title={`Undo the concession in ${m.a.join(" & ")} v ${m.b.join(" & ")}`}
                  confirmLabel="Undo concession"
                  note="The match goes back to its cards."
                  disabled={pending}
                  onConfirm={() => run(() => forfeitMatch(m.id, ""))}
                />
              )}
              {!m.started && (
                <ConfirmButton
                  title={`Remove ${m.a.join(" & ")} v ${m.b.join(" & ")}`}
                  confirmLabel="Remove match"
                  disabled={pending}
                  onConfirm={() => run(() => removeCupMatch(m.id))}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
      {!session.published && session.matches.length > 0 && (
        <div style={{ margin: "0 0 12px" }}>
          <ConfirmButton
            className="btn btn-primary"
            icon="megaphone"
            label="Announce lineup"
            title={`Announce the ${session.name} lineup`}
            confirmLabel="Announce to everyone"
            note="Both teams' pairings go out together, and each player is told their match."
            disabled={pending}
            onConfirm={() => run(() => publishCupLineup(session.id))}
          />
        </div>
      )}
      {session.published && !underWay && (
        <div style={{ margin: "0 0 12px" }}>
          <ConfirmButton
            className="btn btn-secondary"
            icon="eye-slash"
            label="Take the announcement back"
            title={`Hide the ${session.name} lineup again`}
            confirmLabel="Hide this lineup"
            note="Only before anybody has scored in it."
            disabled={pending}
            onConfirm={() => run(() => hideCupLineup(session.id))}
          />
        </div>
      )}
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

/**
 * NAME A SESSION (2026-10-20): the name the board, the players and the final
 * report call it. "Session 2" reads as unnamed, so the box starts empty for
 * it; an empty save hands the session back to that. A refusal is said here,
 * beside the box, and the box stays open with what was typed.
 */
function SessionNamer({ stageId, name }: { stageId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const unnamed = /^Session \d+$/.test(name);
  const [text, setText] = useState(unnamed ? "" : name);
  const { pending, error, run } = useAction({ refresh: true });
  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost"
        style={{ minHeight: 44, fontSize: 13 }}
        onClick={() => setOpen(true)}
        aria-label={`Rename ${name}`}
      >
        Rename
      </button>
    );
  }
  const boxId = `session-name-${stageId}`;
  return (
    <form
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, width: "100%" }}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => nameCupSession(stageId, text), () => setOpen(false));
      }}
    >
      <label htmlFor={boxId} style={{ fontSize: 13 }}>
        Session name
      </label>
      <input
        id={boxId}
        className="input"
        value={text}
        maxLength={24}
        placeholder="Saturday four-balls"
        onChange={(e) => setText(e.target.value)}
        style={{ flex: "1 1 160px", minWidth: 0 }}
      />
      <button type="submit" className="btn btn-primary" disabled={pending} style={{ minHeight: 44 }}>
        {pending ? "Saving…" : "Save name"}
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        style={{ minHeight: 44 }}
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
      {error && (
        <span role="alert" className="form-error" style={{ width: "100%" }}>
          {error}
        </span>
      )}
    </form>
  );
}
