"use client";
import { useId, useState, useTransition } from "react";
import { addPrize, updatePrize, setPrizeWinner, removePrize, applyPrizeStructure } from "@/app/actions/tournament";
import { SaveState, useSaveStatus } from "./SaveState";
import { PRIZE_STRUCTURES } from "@/lib/domain/prize-structures";
import { useMoney } from "@/components/CurrencyProvider";
import { money as formatMoney, minorUnitDigits } from "@/lib/domain/money-format";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";

export interface PrizeRow {
  id: string;
  category: string;
  detail: string;
  amount: number;
  winnerId: string | null;
}

/**
 * A prize, in the CLUB'S currency.
 *
 * `currency: "USD"` was written here literally, so a club in Britain read its
 * whole prize list in dollars — on the screen it uses to tell members what
 * they won.
 *
 * NOTE the unit. `Prize.amount` is a Float in WHOLE units, unlike every other
 * money column in this app, which stores minor units. That is why this scales
 * by the currency's own minor-unit count before formatting rather than calling
 * `money()` directly: handing whole pounds to a formatter expecting pence
 * would divide the purse by a hundred.
 */
function usePrizeMoney() {
  const { currency } = useMoney();
  return (n: number) =>
    n > 0 ? formatMoney(Math.round(n * 10 ** minorUnitDigits(currency)), currency) : "—";
}

export function PrizesClient({
  prizes,
  players,
}: {
  prizes: PrizeRow[];
  /** In FINISHING ORDER, with the board's place where the player holds one —
   *  so the winner picker opens on who actually won, not the alphabet. */
  players: Array<{ id: string; name: string; place?: number | null }>;
}) {
  const money = usePrizeMoney();
  const { symbol } = useMoney();
  const fid = useId();
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const saveStatus = useSaveStatus(pending);

  /**
   * A prize's amount, winner and remove — the same three controls in the table
   * and in the phone's stacked rows, so the two layouts cannot drift. Named for
   * the prize, because in the stacked rows there is no column heading to say
   * which box is the amount and which list is the winner.
   */
  const controls = (p: PrizeRow, asCells = false) => {
    const amountBox = (
      <input
        className="input"
        type="number"
        min={0}
        defaultValue={p.amount || ""}
        disabled={pending}
        aria-label={`Amount for ${p.category}`}
        style={{ width: asCells ? 100 : 84, textAlign: "right" }}
        onBlur={(e) => {
          const v = parseFloat(e.target.value);
          if ((Number.isFinite(v) ? v : 0) !== p.amount) {
            startTransition(() => updatePrize(p.id, { amount: Number.isFinite(v) ? v : 0 }));
          }
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
        onChange={(e) => startTransition(() => setPrizeWinner(p.id, e.target.value))}
      >
        <option value="">— Not awarded —</option>
        {players.map((pl) => (
          <option key={pl.id} value={pl.id}>
            {/* The finishing place where the player holds one, so the winner
                reads first. Unranked players (no card, a manual round) show as
                just their name. */}
            {pl.place ? `${pl.place}. ${pl.name}` : pl.name}
          </option>
        ))}
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

  const purse = prizes.reduce((s, p) => s + p.amount, 0);
  const awarded = prizes.filter((p) => p.winnerId).length;

  const submit = () => {
    const amt = parseFloat(amount);
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
          <span className="text-muted" style={{ fontSize: 12.5 }}>
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
                onClick={() => startTransition(() => applyPrizeStructure(s.key))}
              >
                <Icon name="plus" /> {s.label}
              </button>
            ))}
          </div>
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
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {prizes.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.category}</td>
                  <td className="text-muted">{p.detail || "—"}</td>
                  {controls(p, true)}
                </tr>
              ))}
              {prizes.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted" style={{ fontSize: 13, padding: 16 }}>
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
