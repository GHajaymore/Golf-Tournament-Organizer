"use client";
import { useState, useTransition } from "react";
import { addPrize, updatePrize, setPrizeWinner, removePrize } from "@/app/actions/tournament";
import { useMoney } from "@/components/CurrencyProvider";
import { money as formatMoney, minorUnitDigits } from "@/lib/domain/money-format";

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
  players: Array<{ id: string; name: string }>;
}) {
  const money = usePrizeMoney();
  const { symbol } = useMoney();
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();

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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label>Category</label>
            <input
              className="input"
              placeholder="e.g. Flight 1 — Winner"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 160 }}>
            <label>Detail (optional)</label>
            <input
              className="input"
              placeholder="e.g. Pro shop credit"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </div>
          <div className="field" style={{ width: 130 }}>
            <label>Amount ({symbol})</label>
            <input
              className="input"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
            <i className="ph ph-plus" /> Add
          </button>
        </div>
      </div>

      {/* Named. This was the only untitled card on the screen, and it is the
          prize list itself — which the side-bets card further down refers to
          by name ("a club-funded prize belongs in the prize list…"), pointing
          at something no heading called that. */}
      <div className="card elev-sm">
        <span className="card-title" style={{ fontSize: 15 }}>Prizes</span>
        <div className="table-scroll">
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
                  <td style={{ textAlign: "right" }}>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      defaultValue={p.amount || ""}
                      disabled={pending}
                      style={{ width: 100, textAlign: "right" }}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if ((Number.isFinite(v) ? v : 0) !== p.amount) {
                          startTransition(() => updatePrize(p.id, { amount: Number.isFinite(v) ? v : 0 }));
                        }
                      }}
                    />
                  </td>
                  <td>
                    <select
                      className="input"
                      value={p.winnerId ?? ""}
                      disabled={pending}
                      onChange={(e) => startTransition(() => setPrizeWinner(p.id, e.target.value))}
                    >
                      <option value="">— Not awarded —</option>
                      {players.map((pl) => (
                        <option key={pl.id} value={pl.id}>{pl.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-icon"
                      title="Remove prize"
                      disabled={pending}
                      onClick={() => startTransition(() => removePrize(p.id))}
                    >
                      <i className="ph ph-trash" />
                    </button>
                  </td>
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
