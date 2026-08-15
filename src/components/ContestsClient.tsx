"use client";
import { useState, useTransition } from "react";
import { addContest, setContestEntrants, setContestWinners, removeContest } from "@/app/actions/contests";
import { CONTEST_KINDS, CONTEST_LABEL, type ContestKind } from "@/lib/domain/contests";

/**
 * Closest to the pin, long drive, and whatever else the first tee invented.
 *
 * Next to the skins pot, and for the same reason it lives here: it is a
 * payout, and this is where a club already comes to settle up. Same three
 * steps, in the order they happen on the day — start the bet, record who paid
 * in, then name who won it.
 *
 * The pot is shown before it is won, because that money is real and on the
 * table. What is NOT shown before it is won is anybody being down their
 * stake: an undecided pot pays and charges nobody, or a player would be told
 * they owe money for a contest nobody has taken yet.
 *
 * TourneyHQ works this out and writes it down. It never moves the money.
 */

export interface ContestView {
  id: string;
  kind: string;
  name: string;
  hole: number;
  buyInCents: number;
  entrantIds: string[];
  winnerIds: string[];
  potCents: number;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function ContestsClient({
  roundLabel,
  stageId,
  contests,
  field,
}: {
  roundLabel: string;
  stageId: string;
  contests: ContestView[];
  field: Array<{ id: string; name: string; playing: boolean }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ContestKind>("closest-pin");
  const [name, setName] = useState("");
  const [hole, setHole] = useState("");
  const [stake, setStake] = useState("5");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError("");
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });

  const create = () => {
    const cents = Math.round(Number(stake.replace(/[^0-9.]/g, "")) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError("Enter a stake per player, or zero for a free contest.");
      return;
    }
    run(async () => {
      const res = await addContest({
        kind,
        name: name.trim() || CONTEST_LABEL[kind],
        buyInCents: cents,
        stageId,
        hole: Number(hole) || 0,
      });
      if (res.ok) {
        setAdding(false);
        setName("");
        setHole("");
      }
      return res;
    });
  };

  return (
    <section className="card elev-sm" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="card-title">Side bets — {roundLabel}</span>
        {!adding && (
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)} disabled={pending}>
            <i className="ph ph-plus" /> Add a bet
          </button>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: 12.5, margin: "4px 0 0", lineHeight: 1.55 }}>
        Player-funded: everyone in the pot puts in, the winner takes it, and it lands in the same
        settle-up as the expenses. A club-funded prize belongs in the prize list above instead —
        nobody owes anybody for those.
      </p>

      {adding && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="pair-grid">
            <div className="field">
              <label htmlFor="c-kind">Bet</label>
              <select id="c-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as ContestKind)}>
                {CONTEST_KINDS.map((k) => (
                  <option key={k} value={k}>{CONTEST_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-hole">Hole (optional)</label>
              <input id="c-hole" className="input" inputMode="numeric" value={hole} placeholder="7" onChange={(e) => setHole(e.target.value)} />
            </div>
          </div>
          <div className="pair-grid">
            <div className="field">
              <label htmlFor="c-name">Name</label>
              <input id="c-name" className="input" value={name} placeholder={CONTEST_LABEL[kind]} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-stake">Stake per player</label>
              <input id="c-stake" className="input" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" style={{ flex: 2 }} disabled={pending} onClick={create}>
              Start this bet
            </button>
          </div>
        </div>
      )}

      {contests.length === 0 && !adding && (
        <p className="text-muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
          No side bets on this round yet.
        </p>
      )}

      {contests.map((c) => {
        const entered = new Set(c.entrantIds);
        const won = new Set(c.winnerIds);
        return (
          <div key={c.id} style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--color-divider)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>
                {c.name}
                {c.hole > 0 && <span className="text-muted" style={{ fontWeight: 400 }}> · hole {c.hole}</span>}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {money(c.potCents)} pot
                <span className="text-muted" style={{ fontSize: 12 }}> · {money(c.buyInCents)} each</span>
              </span>
            </div>

            {/* Who paid in. */}
            <div style={{ marginTop: 8 }}>
              <span className="card-kicker">In the pot ({entered.size})</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {field.map((p) => {
                  const on = entered.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`btn ${on ? "btn-primary" : "btn-secondary"} touch-target`}
                      style={{ fontSize: 12.5 }}
                      aria-pressed={on}
                      disabled={pending}
                      onClick={() => {
                        const next = on
                          ? c.entrantIds.filter((id) => id !== p.id)
                          : [...c.entrantIds, p.id];
                        run(() => setContestEntrants(c.id, next));
                      }}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Who won it. More than one is a tie, and the pot splits. */}
            <div style={{ marginTop: 10 }}>
              <span className="card-kicker">
                Winner{won.size > 1 ? "s — tie, pot splits" : ""}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {field
                  .filter((p) => entered.has(p.id) || won.has(p.id))
                  .map((p) => {
                    const on = won.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`btn ${on ? "btn-primary" : "btn-secondary"} touch-target`}
                        style={{ fontSize: 12.5 }}
                        aria-pressed={on}
                        disabled={pending}
                        onClick={() => {
                          const next = on
                            ? c.winnerIds.filter((id) => id !== p.id)
                            : [...c.winnerIds, p.id];
                          run(() => setContestWinners(c.id, next));
                        }}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                {entered.size === 0 && (
                  <span className="text-muted" style={{ fontSize: 12.5 }}>Add who paid in first.</span>
                )}
              </div>
              <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
                {won.size === 0
                  ? "Still open — nobody is charged or paid until it's won."
                  : won.size === 1
                    ? `${money(c.potCents)} to the winner.`
                    : `${money(c.potCents)} split ${won.size} ways.`}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary touch-target"
              style={{ fontSize: 12, marginTop: 10 }}
              disabled={pending}
              onClick={() => run(() => removeContest(c.id))}
            >
              <i className="ph ph-trash" /> Remove this bet
            </button>
          </div>
        );
      })}

      {error && (
        <p style={{ fontSize: 12.5, marginTop: 10, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}
