"use client";
import { useState, useTransition } from "react";
import { clearFlights, divideIntoFlights, moveFlightPlayer, renameFlight, reseedFlight } from "@/app/actions/tournament";
import type { FlightCriterion } from "@/lib/domain/bracket-flights";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";

/**
 * A KNOCKOUT IN SEVERAL FLIGHTS: dividing the field, and adjusting the division.
 *
 * Two states, and the screen is one or the other:
 *
 *   NOT DIVIDED  the organizer picks how the field is divided and into what
 *                shape. Every shape says what it costs in byes — a bye is a
 *                player with nobody to play in the first round — and one is
 *                recommended. Their own sizes are always an option.
 *   DIVIDED      each flight with its field, bracket size, byes and rounds;
 *                a player can be moved, a late entrant put in, a flight renamed
 *                or reseeded by hand, and the whole thing undone.
 *
 * Once a result is recorded in any flight the division is FIXED and this panel
 * only describes it: the draw is what it was on the day, as for one bracket.
 *
 * Everything here is arithmetic done on the server (`bracket-flights.ts`) and
 * handed in; this file draws it and sends the organizer's choice back.
 */
export interface FlightChoice {
  key: FlightCriterion;
  label: string;
  blurb: string;
  /** Why it cannot be used for this tournament, or "" when it can. */
  unavailable: string;
}

export interface ShapeChoice {
  counts: number[];
  byes: number;
  label: string;
  recommended: boolean;
}

export interface FlightSummary {
  name: string;
  size: number;
  byes: number;
  rounds: number;
  /** Each player's index as `indexLabel` writes it — never a bare number. */
  players: { id: string; name: string; index: string }[];
}

const byesText = (n: number) => (n === 0 ? "no byes" : n === 1 ? "1 bye" : `${n} byes`);

export function BracketFlights({
  fieldSize,
  criteria,
  shapes,
  criterion,
  flights,
  unplaced,
  departed,
  fixed,
  readOnly,
  finished,
}: {
  fieldSize: number;
  criteria: FlightChoice[];
  shapes: ShapeChoice[];
  /** How the stored division was made, or null when the field is not divided. */
  criterion: FlightCriterion | null;
  flights: FlightSummary[] | null;
  /** In the field, in no flight: entered after the division was made. */
  unplaced: { id: string; name: string }[];
  /** In a flight, no longer in the field. They stay in the draw. */
  departed: string[];
  /** A result is recorded, so the division can no longer change. */
  fixed: boolean;
  readOnly: boolean;
  /**
   * The tournament is completed. NOT the setup lock: dividing the field is the draw, made when the
   * field is known — after a qualifying round, which is after launch — so launching does not shut it.
   */
  finished: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const firstOpen = criteria.find((c) => !c.unavailable)?.key ?? "handicap";
  const [by, setBy] = useState<FlightCriterion>(firstOpen);
  const recommended = shapes.findIndex((s) => s.recommended);
  const [shape, setShape] = useState<number | "own">(recommended >= 0 ? recommended : 0);
  const [own, setOwn] = useState("");
  const [mover, setMover] = useState("");
  const [toFlight, setToFlight] = useState(0);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [newName, setNewName] = useState("");

  const canChange = !readOnly && !finished && !fixed;
  const run = (action: () => Promise<{ ok: boolean; error?: string }>, then?: () => void) => {
    setError("");
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
      else then?.();
    });
  };

  const ownCounts = own
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const ownTotal = ownCounts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const ownValid = ownCounts.length > 0 && ownCounts.every((n) => Number.isInteger(n) && n >= 2) && ownTotal === fieldSize;
  const chosenCounts = by === "flights" ? [] : shape === "own" ? ownCounts : (shapes[shape]?.counts ?? []);
  const canDivide = by === "flights" || (shape === "own" ? ownValid : chosenCounts.length > 0);

  /* ── Not divided yet ────────────────────────────────────────────────── */
  if (!flights) {
    return (
      <div className="card elev-sm" style={{ gap: 14, marginBottom: 16 }}>
        <div>
          <span className="card-kicker">Flights</span>
          <h2 style={{ fontSize: 17, margin: "4px 0 0" }}>Divide the field of {fieldSize}</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            Each flight is its own knockout: lose and you&rsquo;re out. Nothing is drawn until you divide the field, and you can
            adjust it afterwards.
          </p>
        </div>

        {readOnly || finished ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            {finished ? "This tournament is completed and its field was never divided." : "The organizer has not divided the field yet."}
          </p>
        ) : fieldSize < 2 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>A knockout needs at least two players in the field.</p>
        ) : (
          <>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
              <legend style={{ fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 6 }}>How</legend>
              {criteria.map((c) => (
                <label key={c.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, opacity: c.unavailable ? 0.6 : 1 }}>
                  <input type="radio" name="flight-by" checked={by === c.key} disabled={!!c.unavailable || pending} onChange={() => setBy(c.key)} style={{ marginTop: 3 }} />
                  <span>
                    <span style={{ fontWeight: 500 }}>{c.label}</span>
                    <span className="text-muted" style={{ display: "block", fontSize: 13 }}>{c.unavailable || c.blurb}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {by !== "flights" && (
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
                <legend style={{ fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 6 }}>Into</legend>
                {shapes.map((s, i) => (
                  <label key={s.counts.join("-")} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 14, flexWrap: "wrap" }}>
                    <input type="radio" name="flight-shape" checked={shape === i} disabled={pending} onChange={() => setShape(i)} />
                    <span style={{ fontWeight: 500 }}>{s.label}</span>
                    <span className="text-muted" style={{ fontSize: 13 }}>{byesText(s.byes)}</span>
                    {s.recommended && <span className="tag tag-neutral">Suggested</span>}
                  </label>
                ))}
                <label style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 14, flexWrap: "wrap" }}>
                  <input type="radio" name="flight-shape" checked={shape === "own"} disabled={pending} onChange={() => setShape("own")} />
                  <span style={{ fontWeight: 500 }}>Your own sizes</span>
                </label>
                {shape === "own" && (
                  <div style={{ display: "grid", gap: 4 }}>
                    <label htmlFor="flight-own" className="text-muted" style={{ fontSize: 13 }}>
                      Players in each flight, top flight first, separated by commas
                    </label>
                    <input
                      id="flight-own"
                      className="input"
                      inputMode="numeric"
                      placeholder="16, 16, 12"
                      value={own}
                      onChange={(e) => setOwn(e.target.value)}
                      style={{ maxWidth: 320 }}
                    />
                    <span className="text-muted" style={{ fontSize: 13 }}>
                      {ownCounts.length === 0
                        ? `They must add up to ${fieldSize}.`
                        : ownValid
                          ? `${ownCounts.length} flights, ${ownTotal} players.`
                          : ownCounts.some((n) => !Number.isInteger(n) || n < 2)
                            ? "Each flight needs at least two players."
                            : `These add up to ${ownTotal}; the field is ${fieldSize}.`}
                    </span>
                  </div>
                )}
              </fieldset>
            )}

            {error && <p className="form-error">{error}</p>}
            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || !canDivide}
                onClick={() => run(() => divideIntoFlights(by, chosenCounts))}
              >
                Divide the field
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  /* ── Divided ────────────────────────────────────────────────────────── */
  const how = criteria.find((c) => c.key === criterion)?.label ?? "";
  const everyone = flights.flatMap((f, i) => f.players.map((p) => ({ ...p, flight: i })));
  const moverFlight = everyone.find((p) => p.id === mover)?.flight ?? -1;
  const swap = (flight: number, at: number, dir: -1 | 1) => {
    const ids = flights[flight].players.map((p) => p.id);
    const to = at + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    run(() => reseedFlight(flight, ids));
  };

  return (
    <div className="card elev-sm" style={{ gap: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="card-kicker">Flights</span>
          <h2 style={{ fontSize: 17, margin: "4px 0 0" }}>
            {flights.length} flights{how ? ` · ${how.toLowerCase()}` : ""}
          </h2>
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            {fixed
              ? "Results are in, so the flights are fixed. Each is its own knockout."
              : "Each is its own knockout. You can move players, reseed and rename until the first result is recorded."}
          </p>
        </div>
        {canChange && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {criterion === "random" && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => run(() => divideIntoFlights("random", flights.map((f) => f.players.length)))}
              >
                <Icon name="shuffle" /> Draw again
              </button>
            )}
            <ConfirmButton
              onConfirm={() => run(() => clearFlights())}
              label="Start again"
              title="Undo the division"
              confirmLabel="Undo the flights"
              icon="arrows-clockwise"
              note="Nobody has played, so nothing is lost."
              className="btn btn-secondary"
              disabled={pending}
            />
          </div>
        )}
      </div>

      {unplaced.length > 0 && (
        <p className="form-error" role="status" style={{ margin: 0 }}>
          {unplaced.length === 1 ? `${unplaced[0].name} has` : `${unplaced.length} players have`} entered since the field was divided and{" "}
          {unplaced.length === 1 ? "is" : "are"} in no flight{canChange ? " — put them in one below." : "."}
        </p>
      )}
      {departed.length > 0 && (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {departed.join(", ")} {departed.length === 1 ? "has" : "have"} left the field since the draw and {departed.length === 1 ? "stays" : "stay"} in it:
          the opponent goes through by walkover.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}

      {canChange && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            Move or add a player
            <select className="input" value={mover} onChange={(e) => setMover(e.target.value)} disabled={pending} style={{ minWidth: 200 }}>
              <option value="">Choose a player</option>
              {unplaced.length > 0 && (
                <optgroup label="In no flight">
                  {unplaced.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              )}
              {flights.map((f) => (
                <optgroup key={f.name} label={f.name}>
                  {f.players.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.index ? ` (${p.index})` : ""}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            To
            <select className="input" value={toFlight} onChange={(e) => setToFlight(Number(e.target.value))} disabled={pending}>
              {flights.map((f, i) => (
                <option key={f.name} value={i}>{f.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending || !mover || moverFlight === toFlight}
            onClick={() => run(() => moveFlightPlayer(mover, toFlight), () => setMover(""))}
          >
            Move
          </button>
        </div>
      )}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {flights.map((f, i) => (
          <details key={f.name} style={{ border: "1px solid var(--color-divider)", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
            <summary style={{ cursor: "pointer", display: "grid", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</span>
              <span className="text-muted" style={{ fontSize: 13 }}>
                {f.players.length} players · bracket of {f.size} · {byesText(f.byes)} · {f.rounds} {f.rounds === 1 ? "round" : "rounds"}
              </span>
            </summary>
            {canChange &&
              (renaming === i ? (
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    aria-label={`New name for ${f.name}`}
                    value={newName}
                    maxLength={40}
                    onChange={(e) => setNewName(e.target.value)}
                    style={{ flex: "1 1 140px", minWidth: 0 }}
                  />
                  <button type="button" className="btn btn-secondary" disabled={pending || !newName.trim()} onClick={() => run(() => renameFlight(i, newName), () => setRenaming(null))}>
                    Save name
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} disabled={pending} onClick={() => { setRenaming(i); setNewName(f.name); }}>
                  <Icon name="pencil-simple" /> Rename
                </button>
              ))}
            <ol style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
              {f.players.map((p, at) => (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, minWidth: 0 }}>
                  <span className="text-muted num" style={{ width: 24, flex: "none", textAlign: "right", fontSize: 13 }}>{at + 1}</span>
                  <span style={{ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>{p.name}</span>
                  {p.index && <span className="text-muted num" style={{ fontSize: 13, flex: "none" }}>{p.index}</span>}
                  {canChange && (
                    <span style={{ display: "flex", gap: 4, flex: "none" }}>
                      <button type="button" className="btn btn-icon" title={`Seed ${p.name} higher`} aria-label={`Seed ${p.name} higher`} disabled={pending || at === 0} onClick={() => swap(i, at, -1)}>
                        <Icon name="caret-up" />
                      </button>
                      <button type="button" className="btn btn-icon" title={`Seed ${p.name} lower`} aria-label={`Seed ${p.name} lower`} disabled={pending || at === f.players.length - 1} onClick={() => swap(i, at, 1)}>
                        <Icon name="caret-down" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </div>
  );
}
