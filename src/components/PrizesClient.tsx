"use client";
import { figureOr, readDecimal } from "@/lib/domain/decimal-text";
import { Fragment, useId, useOptimistic, useState, useTransition } from "react";
import {
  addPrize,
  updatePrize,
  setPrizeWinner,
  removePrize,
  applyPrizeStructure,
  setOnePrizePerPlayer,
  setPrizeCounts,
} from "@/app/actions/tournament";
import { SaveState, useSaveStatus } from "./SaveState";
import { PRIZE_STRUCTURES } from "@/lib/domain/prize-structures";
import { awardOrder, pickerFor, ONE_PRIZE_LABEL, ONE_PRIZE_HELP, COUNTS_LABEL } from "@/lib/domain/one-prize";
import { bringIntoView } from "@/lib/bring-into-view";
import { useMoney } from "@/components/CurrencyProvider";
import { usePrizeMoney } from "./usePrizeMoney";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { leaveOnEnter } from "@/lib/leave-on-enter";

export interface PrizeRow {
  id: string;
  category: string;
  detail: string;
  amount: number;
  winnerId: string | null;
  /** Whether the line counts toward one prize per player (a placing prize). */
  counts: boolean;
}

export function PrizesClient({
  prizes: stored,
  players,
  flights = [],
  byScore,
  onePrizePerPlayer = false,
}: {
  prizes: PrizeRow[];
  /**
   * The tournament's "One prize per player" (2026-10-21). While it is on, the
   * lines are shown in the order they are AWARDED — gross first — each line
   * says whether it counts, and a winner picker puts anybody who already holds
   * a counting prize out of the way, saying what they hold. The server keeps
   * the same rule (`setPrizeWinner`); this only makes it visible.
   */
  onePrizePerPlayer?: boolean;
  /** In FINISHING ORDER, with the board's place where the player holds one —
   *  so the winner picker opens on who actually won, not the alphabet. */
  players: Array<{ id: string; name: string; place?: number | null }>;
  /**
   * Each flight's own finishing order, labelled as every board labels it —
   * empty for a field with fewer than two flights (2026-10-08).
   *
   * A flight's prize offered the OVERALL order: "Flight A — Winner" opened on
   * "1. Dot Tee", the flight B player who won overall, so the top choice gave
   * Flight A's prize to somebody not in Flight A. A prize named for a flight
   * now lists that flight first, numbered by its place IN the flight, and
   * every option says which flight its player is in.
   */
  flights?: Array<{ label: string; players: Array<{ id: string; name: string; place?: number | null }> }>;
  /**
   * The field by GROSS and by NET, each numbered by its own places, or null
   * where the board has no strokes to order by (2026-10-08). A prize named
   * for one — "Best gross", "Best net" — opens on that order: both opened on
   * the board's net order, so "Best gross" offered the net winner first.
   */
  byScore?: {
    gross: Array<{ id: string; name: string; place?: number | null }> | null;
    net: Array<{ id: string; name: string; place?: number | null }> | null;
  };
}) {
  const flightOf = new Map(flights.flatMap((f) => f.players.map((pl) => [pl.id, f.label] as const)));
  /** The options for one prize: in the order its own name asks for. */
  const optionsFor = (category: string) => {
    if (/\bgross\b/i.test(category) && byScore?.gross) return byScore.gross;
    if (/\bnet\b/i.test(category) && byScore?.net) return byScore.net;
    const flight = flights.find((f) => category.startsWith(`${f.label} — `));
    if (!flight) return players;
    const inFlight = new Set(flight.players.map((pl) => pl.id));
    return [...flight.players, ...players.filter((pl) => !inFlight.has(pl.id)).map((pl) => ({ ...pl, place: null }))];
  };
  const money = usePrizeMoney();
  const { symbol } = useMoney();
  const fid = useId();
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [amount, setAmount] = useState("");
  const [structureRefused, setStructureRefused] = useState("");
  /**
   * What the server said no to on ONE line — an award, or its "counts" switch —
   * said under that line, where the press was. It used to sit at the head of
   * the list, which on a long list is a screen above the picker. A stale screen
   * (the field or the list moved) adds "reload"; the one-prize rule does not,
   * because its remedy is another name.
   */
  const [rowRefused, setRowRefused] = useState<{ prizeId: string; text: string } | null>(null);
  const [ruleRefused, setRuleRefused] = useState("");
  const [pending, startTransition] = useTransition();
  const saveStatus = useSaveStatus(pending);
  /**
   * The rule and each line's switch, shown as pressed while the press is on its
   * way — and back to what is stored the moment it is refused, which is what
   * `useOptimistic` does when the transition ends. Without it a tick drew
   * unticked until the server's answer arrived, then ticked.
   */
  const [on, showRule] = useOptimistic(onePrizePerPlayer, (_: boolean, next: boolean) => next);
  const [shown, showCounts] = useOptimistic(stored, (rows: PrizeRow[], next: { id: string; counts: boolean }) =>
    rows.map((r) => (r.id === next.id ? { ...r, counts: next.counts } : r)),
  );
  // Gross first while the rule is on; the committee's own order otherwise.
  const prizes = awardOrder(shown, on);
  const holdings = shown.map((p) => ({ id: p.id, category: p.category, winnerId: p.winnerId, counts: p.counts }));
  const optionText = (pl: { id: string; name: string; place?: number | null }) =>
    `${pl.place ? `${pl.place}. ${pl.name}` : pl.name}${flightOf.has(pl.id) ? ` · ${flightOf.get(pl.id)}` : ""}`;

  /**
   * A line's "counts toward one prize per player" switch — null with the rule
   * off, when it means nothing. In the table its column is headed, so it reads
   * "Counts"; on a phone's row it says the whole thing.
   */
  const countsSwitch = (p: PrizeRow, short: boolean) =>
    on ? (
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, whiteSpace: short ? "nowrap" : undefined }}>
        <input
          type="checkbox"
          checked={p.counts}
          disabled={pending}
          aria-label={`${p.category}: ${COUNTS_LABEL.toLowerCase()}`}
          onChange={(e) => {
            const want = e.target.checked;
            setRowRefused(null);
            startTransition(async () => {
              showCounts({ id: p.id, counts: want });
              const result = await setPrizeCounts(p.id, want);
              if (!result.ok) setRowRefused({ prizeId: p.id, text: result.error ?? "That could not be saved." });
            });
          }}
        />
        <span aria-hidden="true">{short ? "Counts" : COUNTS_LABEL}</span>
      </label>
    ) : null;

  /**
   * A prize's amount, winner and remove — the same three controls in the table
   * and in the phone's stacked rows, so the two layouts cannot drift. Named for
   * the prize, because in the stacked rows there is no column heading to say
   * which box is the amount and which list is the winner.
   */
  const controls = (p: PrizeRow, asCells = false) => {
    const picker = pickerFor(optionsFor(p.category), holdings, p.id, on);
    const amountBox = (
      <input
        className="input"
        type="number"
        min={0}
        defaultValue={p.amount || ""}
        disabled={pending}
        aria-label={`Amount for ${p.category}`}
        style={{ width: asCells ? 100 : 84, textAlign: "right" }}
        onKeyDown={leaveOnEnter}
        onBlur={(e) => {
          const typed = figureOr(readDecimal(e.target.value), Number.NaN);
          // What will be KEPT: an amount above nothing, or nothing. The server keeps the same rule
          // (`updatePrize`), and the box must show that and not what was typed: "-5" was stored as no
          // prize and went on standing in the box as minus five — the screen saying one thing and the
          // purse above it another. Found by the first browser test to re-price a prize (2026-10-13).
          const kept = Number.isFinite(typed) && typed > 0 ? typed : 0;
          if (kept !== typed) e.target.value = kept ? String(kept) : "";
          if (kept !== p.amount) startTransition(() => updatePrize(p.id, { amount: kept }));
        }}
      />
    );
    const winnerPick = (
      <select
        className="input"
        value={p.winnerId ?? ""}
        disabled={pending}
        aria-label={`Winner of ${p.category}`}
        style={asCells ? undefined : { flex: 1, minWidth: 0 }}
        onChange={(e) => {
          const chosen = e.target.value;
          setRowRefused(null);
          startTransition(async () => {
            const result = await setPrizeWinner(p.id, chosen);
            if (result.ok) return;
            const said = result.error ?? "That award could not be recorded.";
            setRowRefused({ prizeId: p.id, text: result.choose ? said : `${said} Reload the screen and award it again.` });
          });
        }}
      >
        <option value="">— Not awarded —</option>
        {/* The finishing place where the player holds one, so the winner reads
            first. Unranked players (no card, a manual round) show as just their
            name. On a flighted field, the player's flight too. Under one prize
            per player, the first who holds nothing is marked as next in line,
            and those who already hold a counting prize are listed last, saying
            which — not hidden, so the organizer can see why. */}
        {picker.free.map((pl) => (
          <option key={pl.id} value={pl.id}>
            {optionText(pl)}
            {pl.suggested ? " · next in line" : ""}
          </option>
        ))}
        {picker.holding.length > 0 && (
          <optgroup label="Already hold a prize">
            {picker.holding.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {optionText(pl)} · has {pl.holds}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
    const remove = (
      <ConfirmButton
        title="Remove prize"
        confirmLabel="Remove it"
        disabled={pending}
        onConfirm={() => startTransition(() => removePrize(p.id))}
      />
    );
    return asCells ? (
      <>
        <td style={{ textAlign: "right" }}>{amountBox}</td>
        <td>{winnerPick}</td>
        {on && <td>{countsSwitch(p, true)}</td>}
        <td>{remove}</td>
      </>
    ) : (
      <>
        {amountBox}
        {winnerPick}
        {remove}
      </>
    );
  };
  /** A refusal of something pressed on this line, said on this line. */
  const refusedHere = (p: PrizeRow) =>
    rowRefused?.prizeId === p.id ? (
      <p role="alert" ref={bringIntoView} style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
        <Icon name="warning-circle" /> {rowRefused.text}
      </p>
    ) : null;

  const purse = prizes.reduce((s, p) => s + p.amount, 0);
  const awarded = prizes.filter((p) => p.winnerId).length;

  const submit = () => {
    const amt = figureOr(readDecimal(amount), Number.NaN);
    if (!category.trim()) return;
    startTransition(async () => {
      await addPrize(category, Number.isFinite(amt) ? amt : 0, detail);
      setCategory("");
      setDetail("");
      setAmount("");
    });
  };

  return (
    <>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 150, gap: 2 }}>
          <span className="card-kicker">Total purse</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{money(purse)}</div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 150, gap: 2 }}>
          <span className="card-kicker">Prize lines</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{prizes.length}</div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 150, gap: 2 }}>
          <span className="card-kicker">Awarded</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{awarded} / {prizes.length}</div>
        </div>
      </div>

      <div className="card elev-sm" style={{ marginBottom: 16, gap: 12 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Add a prize</span>

        {/* Start from a common structure and edit the amounts, rather than
            retyping the same categories every medal. Each button adds editable
            lines with the amounts left at zero for the club to set; flight
            winners reads the field's actual flights. See prize-structures.ts. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span className="text-muted" style={{ fontSize: 13 }}>
            Start from a structure, then set the amounts:
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRIZE_STRUCTURES.map((s) => (
              <button
                key={s.key}
                type="button"
                className="btn"
                disabled={pending}
                title={s.blurb}
                onClick={() => {
                  setStructureRefused("");
                  startTransition(async () => {
                    const res = await applyPrizeStructure(s.key);
                    // "Flight winners" on a field with no flights adds
                    // nothing; it used to say nothing too.
                    if (res && !res.ok) setStructureRefused(res.error ?? "That added nothing.");
                  });
                }}
              >
                <Icon name="plus" /> {s.label}
              </button>
            ))}
          </div>
          {structureRefused && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {structureRefused}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label htmlFor={`${fid}-cat`}>Category</label>
            <input
              id={`${fid}-cat`}
              className="input"
              placeholder="e.g. Flight 1 — Winner"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 160 }}>
            <label htmlFor={`${fid}-detail`}>Detail (optional)</label>
            <input
              id={`${fid}-detail`}
              className="input"
              placeholder="e.g. Pro shop credit"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </div>
          <div className="field" style={{ width: 130 }}>
            <label htmlFor={`${fid}-amount`}>Amount ({symbol})</label>
            <input
              id={`${fid}-amount`}
              className="input"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
            <Icon name="plus" /> Add
          </button>
        </div>
      </div>

      {/* Named. This was the only untitled card on the screen, and it is the
          prize list itself — which the side-bets card further down refers to
          by name ("a club-funded prize belongs in the prize list…"), pointing
          at something no heading called that. */}
      <div className="card elev-sm">
        {/* An amount saves when its box is left and a winner when picked —
            said here, once for the list, as self-saving controls do. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span className="card-title" style={{ fontSize: 15 }}>Prizes</span>
          <SaveState status={saveStatus} />
        </div>
        {/* ONE PRIZE PER PLAYER, beside the list it governs (2026-10-21). Off
            by default; ticking it while somebody already holds two counting
            prizes is refused, naming them, and said right under the box. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={on}
              disabled={pending}
              onChange={(e) => {
                const want = e.target.checked;
                setRuleRefused("");
                setRowRefused(null);
                startTransition(async () => {
                  showRule(want);
                  const result = await setOnePrizePerPlayer(want);
                  if (!result.ok) setRuleRefused(result.error ?? "That could not be saved.");
                });
              }}
            />
            {ONE_PRIZE_LABEL}
          </label>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {ONE_PRIZE_HELP}
          </span>
          {ruleRefused && (
            <p role="alert" ref={bringIntoView} style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {ruleRefused}
            </p>
          )}
        </div>
        {/* ON A PHONE, ONE PRIZE A ROW (2026-09-29). The table put the WINNER
            in its last column, and at 390px that column was off the right edge
            — the one screen whose point is who won never showed it without a
            sideways scroll, and the amount box took most of what was left. So
            below 640px each prize is its name, then amount · winner · remove on
            one line. The same controls, from one place, in both layouts. */}
        {prizes.length > 0 && (
          <ul className="prize-narrow" aria-label="Prizes">
            {prizes.map((p) => (
              <li key={p.id} className="prize-row">
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{p.category}</span>
                  {p.detail && <span className="text-muted"> — {p.detail}</span>}
                </div>
                <div className="prize-controls">{controls(p)}</div>
                {countsSwitch(p, false)}
                {refusedHere(p)}
              </li>
            ))}
          </ul>
        )}
        <div className={`table-scroll prize-wide${prizes.length === 0 ? " is-empty" : ""}`}>
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Detail</th>
                <th style={{ textAlign: "right", width: 120 }}>Amount</th>
                <th style={{ width: 200 }}>Winner</th>
                {on && <th style={{ width: 90 }} title={COUNTS_LABEL}>Counts</th>}
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {prizes.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td style={{ fontWeight: 500 }}>{p.category}</td>
                    <td className="text-muted">{p.detail || "—"}</td>
                    {controls(p, true)}
                  </tr>
                  {rowRefused?.prizeId === p.id && (
                    <tr>
                      <td colSpan={on ? 6 : 5}>{refusedHere(p)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {prizes.length === 0 && (
                <tr>
                  <td colSpan={on ? 6 : 5} className="text-muted" style={{ fontSize: 13, padding: 16 }}>
                    {/* Names the control rather than pointing at a position.
                        "above" is a claim about layout that nothing checks and
                        a re-arrangement makes false — the defect this pass
                        found three times in one file on StagesClient. */}
                    No prizes yet — use &ldquo;Add a prize&rdquo; for flight winners, skins,
                    closest-to-pin, long drive and any specials.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
