"use client";
import { useState, useTransition } from "react";
import { addContest, setContestEntrants, setContestWinners, removeContest, confirmContestEntry } from "@/app/actions/contests";
import { saveSideGame, setSideGameEntrants, confirmSideGameEntry } from "@/app/actions/side-games";
import { setPotEntryMode } from "@/app/actions/money-setup";
import {
  POT_ENTRY_MODES,
  POT_MODE_LABEL,
  POT_MODE_HELP,
  isPotEntryMode,
} from "@/lib/domain/pot-entry";
import { CONTEST_KINDS, CONTEST_LABEL, type ContestKind } from "@/lib/domain/contests";
import { DERIVED_KINDS, DERIVED_LABEL, DERIVED_HELP } from "@/lib/domain/derived-games";
import { PersonChip } from "@/components/PersonChip";
import FieldInfo from "@/components/FieldInfo";
import { useMoney } from "@/components/CurrencyProvider";

/**
 * The derived pots, in the order a club would read them. Nassau is last and
 * separate because it is a match bet rather than a pot — it takes a stake and
 * no entrant list, since it applies to every match in the round.
 */
const DERIVED_ROWS: Array<{ kind: string; label: string; help: string }> = [
  ...DERIVED_KINDS.map((kind) => ({
    kind,
    label: DERIVED_LABEL[kind],
    help: DERIVED_HELP[kind],
  })),
  {
    kind: "nassau",
    label: "Nassau",
    help: "Front, back and overall — three bets on every match at this stake.",
  },
];

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
  /** Players who put their own name down and have not paid in yet. */
  pending: Array<{ playerId: string; name: string }>;
  /** opt-in | opt-out — who is in the pot by default. */
  entryMode: string;
  /** Taken out of an opt-out pot. */
  excluded: Array<{ playerId: string; name: string }>;
}

/**
 * The club's way of writing an amount, not this file's.
 *
 * Was a local `money()` hard-coding a dollar sign and dividing by a hundred.
 * There were several of these and a club outside the United States saw dollars
 * on every one, at a hundredth of the value in a currency with no minor unit.
 */


export interface SideGameView {
  id: string;
  kind: string;
  buyInCents: number;
  /** Confirmed stakes — the pot. */
  entrantIds: string[];
  /** Put their own name down from the app and still owe the cash. */
  pending: { playerId: string; name: string }[];
  entryMode: string;
  excluded: { playerId: string; name: string }[];
}

export function ContestsClient({
  roundLabel,
  stageId,
  contests,
  sideGames,
  field,
}: {
  roundLabel: string;
  stageId: string;
  contests: ContestView[];
  /** The derived pots — settled by the cards, so no winner is ever picked. */
  sideGames: SideGameView[];
  field: Array<{ id: string; name: string; playing: boolean }>;
}) {
  const { money, plain } = useMoney();
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

  /**
   * Opt-in or opt-out, on one pot.
   *
   * Shown on every pot rather than set once for the tournament, because a
   * club routinely runs both on the same day: the closest-to-the-pin is on
   * for everybody, and the £10 sweep is for whoever fancies it.
   */
  const modeToggle = (potType: "contest" | "sideGame", potId: string, mode: string) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", marginTop: 6 }}>
      {POT_ENTRY_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className={`tag ${mode === m ? "tag-accent" : "tag-neutral"}`}
          disabled={pending}
          onClick={() => run(() => setPotEntryMode(potType, potId, m))}
          style={{ cursor: "pointer", border: "none" }}
        >
          {POT_MODE_LABEL[m]}
        </button>
      ))}
      {/* Both modes explained on TAP, not on hover.
          The line below shows the mode in force, which is right; the OTHER
          mode's help was in a `title` on its button, so on a phone the only
          way to read it was to switch — and switching is not free. Opt-out
          marks everyone in the field as in AND as paid, so "try it and see" is
          a change to who owes money. */}
      <FieldInfo label="how a pot fills">
        {POT_ENTRY_MODES.map((m) => (
          <p key={m}>
            <b>{POT_MODE_LABEL[m]}</b> — {POT_MODE_HELP[m]}
          </p>
        ))}
      </FieldInfo>
      <span className="text-muted" style={{ fontSize: 11.5, flexBasis: "100%", lineHeight: 1.55 }}>
        {POT_MODE_HELP[isPotEntryMode(mode) ? mode : "opt-in"]}
      </span>
    </div>
  );

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
        {/* "under Prizes", not "in the prize list above". The list it meant had
            no heading at all until this pass named it, so the sentence pointed
            at something nothing on the screen called that — and pointed by
            POSITION, which is a claim nothing checks. */}
        Player-funded: everyone in the pot puts in, the winner takes it, and it lands in the same
        settle-up as the expenses. A club-funded prize belongs under <b>Prizes</b> on this screen
        instead — nobody owes anybody for those.
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

      {/* The pots the CARDS settle. No winner is ever picked here, and that is
          the point: the scores name one. All an organizer sets is the stake
          and who is in. */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--color-divider)" }}>
        <span className="card-kicker">Settled by the scores</span>
        <p className="text-muted" style={{ fontSize: 12.5, margin: "4px 0 10px", lineHeight: 1.55 }}>
          Low gross, low net, birdies, eagles and the Nassau are worked out from the cards — set the
          stake and who is in, and the money follows the scoring. Nobody types a winner.
        </p>

        {DERIVED_ROWS.map((row) => {
          const game = sideGames.find((g) => g.kind === row.kind);
          const entered = new Set(game?.entrantIds ?? []);
          const on = !!game && game.buyInCents > 0;
          return (
            <div key={row.kind} style={{ paddingTop: 10, borderTop: "1px solid var(--color-divider)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 120 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 550 }}>{row.label}</span>
                  <span className="text-muted" style={{ fontSize: 11.5 }}>{row.help}</span>
                </span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                  <span className="text-muted">Stake</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    defaultValue={game ? plain(game.buyInCents) : ""}
                    placeholder="0.00"
                    disabled={pending}
                    style={{ width: 82, minHeight: 40, textAlign: "right" }}
                    onBlur={(e) => {
                      const cents = Math.round(Number(e.target.value.replace(/[^0-9.]/g, "")) * 100);
                      if (!Number.isFinite(cents)) return;
                      if (game && cents === game.buyInCents) return;
                      run(() => saveSideGame(stageId, row.kind, cents));
                    }}
                  />
                </label>
              </div>

              {/* Same block, and the same reasoning, as the contests below:
                  these people asked to join from their phone and have not paid
                  yet, so their stake is NOT in the pot above. Collecting from
                  them is the job, so they come first. This was the one pot type
                  a player could join from the app and the only one with nowhere
                  for the organizer to see it. */}
              {on && game && modeToggle("sideGame", game.id, game.entryMode)}

              {on && game && game.pending.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: "var(--radius-md)",
                    background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
                  }}
                >
                  <span className="card-kicker">
                    Asked to join — take their money ({game.pending.length})
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {game.pending.map((p) => (
                      <PersonChip
                        key={p.playerId}
                        name={`${p.name} · ${money(game.buyInCents)}`}
                        on={false}
                        tone="in"
                        disabled={pending}
                        onClick={() => run(() => confirmSideGameEntry(game.id, p.playerId, true))}
                      />
                    ))}
                  </div>
                </div>
              )}

              {on && (
                <div style={{ marginTop: 8 }}>
                  <span className="text-muted" style={{ fontSize: 11.5 }}>
                    {row.kind === "nassau"
                      ? "Applies to every match in this round at that stake per segment."
                      : `In the pot (${entered.size})`}
                  </span>
                  {row.kind !== "nassau" && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {field.map((p) => {
                        const isIn = entered.has(p.id);
                        return (
                          <PersonChip
                            key={p.id}
                            name={p.name}
                            on={isIn}
                            tone="in"
                            disabled={pending || !game}
                            onClick={() => {
                              if (!game) return;
                              const next = isIn
                                ? game.entrantIds.filter((id) => id !== p.id)
                                : [...game.entrantIds, p.id];
                              run(() => setSideGameEntrants(game.id, next));
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The other half of the distinction, which had no name at all.
          "Settled by the scores" above is only meaningful against something,
          and that something — closest to the pin, long drive, whatever the
          first tee invented — was a bare list of contests under no heading. So
          the screen named one kind of pot and left the reader to work out what
          the rest were.

          The empty state moved in here too. It read "No side bets on this
          round yet" while sitting ABOVE five side bets with stake fields on
          them, because it counts `contests` and the derived pots are not
          contests. It was answering a different question than the one its
          position implied. */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--color-divider)" }}>
        <span className="card-kicker">You name the winner</span>
        <p className="text-muted" style={{ fontSize: 12.5, margin: "4px 0 10px", lineHeight: 1.55 }}>
          Closest to the pin, long drive, and whatever else the first tee invented. Nothing in the
          cards decides these, so you tick who took it.
        </p>

        {contests.length === 0 && !adding && (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            None on this round yet — start one with &ldquo;Add a bet&rdquo;.
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

            {modeToggle("contest", c.id, c.entryMode)}

            {/* Anybody who put their own name down in the app and has not yet
                handed the money over. Shown first, because collecting from
                these people is the job — and their stake is NOT in the pot
                above until it is taken. */}
            {c.pending.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-md)",
                  background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
                }}
              >
                <span className="card-kicker">Asked to join — take their money ({c.pending.length})</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {c.pending.map((p) => (
                    <PersonChip
                      key={p.playerId}
                      name={`${p.name} · ${money(c.buyInCents)}`}
                      on={false}
                      tone="in"
                      disabled={pending}
                      onClick={() => run(() => confirmContestEntry(c.id, p.playerId, true))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Who paid in. */}
            <div style={{ marginTop: 8 }}>
              <span className="card-kicker">In the pot ({entered.size})</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {field.map((p) => {
                  const on = entered.has(p.id);
                  return (
                    <PersonChip
                      key={p.id}
                      name={p.name}
                      on={on}
                      tone="in"
                      disabled={pending}
                      onClick={() => {
                        const next = on
                          ? c.entrantIds.filter((id) => id !== p.id)
                          : [...c.entrantIds, p.id];
                        run(() => setContestEntrants(c.id, next));
                      }}
                    />
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
                      <PersonChip
                        key={p.id}
                        name={p.name}
                        on={on}
                        // The club's SECOND colour for money out, the same
                        // pairing the board uses — both configured, neither
                        // fixed by this screen.
                        tone="won"
                        disabled={pending}
                        onClick={() => {
                          const next = on
                            ? c.winnerIds.filter((id) => id !== p.id)
                            : [...c.winnerIds, p.id];
                          run(() => setContestWinners(c.id, next));
                        }}
                      />
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
      </div>

      {error && (
        <p style={{ fontSize: 12.5, marginTop: 10, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}
