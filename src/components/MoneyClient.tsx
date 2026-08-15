"use client";
import { useMemo, useState, useTransition } from "react";
import { addExpense, removeExpense, recordSettlement } from "@/app/actions/expenses";
import { requestContestEntry } from "@/app/actions/contests";
import type { MoneyView } from "@/lib/services/expenses";
import { PersonChip } from "@/components/PersonChip";

/**
 * The outing's money, on a phone.
 *
 * It opens on ONE NUMBER — what you owe or are owed, net of everything,
 * including the side games. Most people open this to see that and nothing
 * else, so it is the biggest thing on the screen and it is above the fold.
 *
 * Everything below it exists to answer "why". The parts are shown next to the
 * total rather than hidden behind it: a figure that disagrees with what
 * somebody remembers of the bet is a figure they will not trust, and hiding
 * the skins money is the fastest way to make a correct number look wrong.
 *
 * The app records money and never moves it. No button here says "pay" — they
 * say "mark settled", because what actually happened was two people and some
 * cash.
 */

const money = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
};

type Scope = "group" | "everyone" | "pick";

export function MoneyClient({ view }: { view: MoneyView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [stageId, setStageId] = useState("");
  const [scope, setScope] = useState<Scope>("everyone");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(view.field.map((p) => p.id)));

  const round = view.rounds.find((r) => r.stageId === stageId) ?? null;
  const groupIds = round?.groupPlayerIds ?? [];

  /** Who this line is split between, from the scope the payer chose. */
  const shareIds = useMemo(() => {
    if (scope === "group" && groupIds.length) return groupIds;
    if (scope === "pick") return [...picked];
    return view.field.map((p) => p.id);
  }, [scope, groupIds, picked, view.field]);

  const cents = Math.round(Number(amount.replace(/[^0-9.-]/g, "")) * 100);
  const valid = description.trim().length > 0 && Number.isFinite(cents) && cents !== 0;
  const each = valid && shareIds.length ? Math.floor(Math.abs(cents) / shareIds.length) : 0;

  const submit = () => {
    setError("");
    startTransition(async () => {
      const res = await addExpense({
        description,
        amountCents: cents,
        paidBy: view.playerId,
        stageId,
        shares: shareIds.map((playerId) => ({ playerId, weight: 1 })),
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        return;
      }
      setDescription("");
      setAmount("");
      setAdding(false);
    });
  };

  const owed = view.netCents > 0;

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--color-neutral-400)" }}>
        Money
      </div>

      {/* The one number. */}
      <section className="card elev-sm" style={{ marginTop: 8, alignItems: "center", textAlign: "center", padding: "20px 16px" }}>
        <div style={{ fontSize: 12.5, color: "var(--color-neutral-400)", fontWeight: 600 }}>
          {view.netCents === 0 ? "You're square" : owed ? "You're owed" : "You owe"}
        </div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 44,
            lineHeight: 1.1,
            fontVariantNumeric: "tabular-nums",
            color: view.netCents === 0 ? "var(--color-text)" : owed ? "var(--color-accent-2-300)" : "var(--color-text)",
          }}
        >
          {money(Math.abs(view.netCents))}
        </div>
        {/* The parts, always — never make the total take it on faith. */}
        <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 12, color: "var(--color-neutral-400)" }}>
          <span>Expenses {money(view.expensesCents)}</span>
          {view.gamesCents !== 0 && <span>Side games {money(view.gamesCents)}</span>}
          {view.settledCents !== 0 && <span>Settled {money(view.settledCents)}</span>}
        </div>
      </section>

      {/* Add — the common case is an amount and a label. */}
      {!adding ? (
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", minHeight: 52, marginTop: 12 }}
          onClick={() => setAdding(true)}
          disabled={!view.playerId}
        >
          <i className="ph ph-plus" /> Add an expense
        </button>
      ) : (
        <section className="card elev-sm" style={{ marginTop: 12, gap: 10 }}>
          <div className="field">
            <label htmlFor="exp-what">What was it for?</label>
            <input
              id="exp-what"
              className="input"
              value={description}
              placeholder="Dinner, carts, green fees…"
              onChange={(e) => setDescription(e.target.value)}
              style={{ minHeight: 46 }}
            />
          </div>
          <div className="field">
            <label htmlFor="exp-amount">Amount</label>
            <input
              id="exp-amount"
              className="input"
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
              style={{ minHeight: 46, fontSize: 18, fontVariantNumeric: "tabular-nums" }}
            />
            <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
              A refund goes in as a negative — “-30” for a cart fee that came back.
            </p>
          </div>

          {view.rounds.length > 0 && (
            <div className="field">
              <label htmlFor="exp-round">Round</label>
              <select
                id="exp-round"
                className="input"
                value={stageId}
                onChange={(e) => {
                  setStageId(e.target.value);
                  // Tagging a line to a round makes "my group" the sensible
                  // default: a cart fee belongs to the four who rode in it.
                  const r = view.rounds.find((x) => x.stageId === e.target.value);
                  setScope(r && r.groupPlayerIds.length > 1 ? "group" : "everyone");
                }}
                style={{ minHeight: 46 }}
              >
                <option value="">The whole outing</option>
                {view.rounds.map((r) => (
                  <option key={r.stageId} value={r.stageId}>{r.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>Split between</label>
            <div className="seg">
              {groupIds.length > 1 && (
                <label className="seg-opt">
                  <input type="radio" name="scope" checked={scope === "group"} onChange={() => setScope("group")} />
                  My group ({groupIds.length})
                </label>
              )}
              <label className="seg-opt">
                <input type="radio" name="scope" checked={scope === "everyone"} onChange={() => setScope("everyone")} />
                Everyone ({view.field.length})
              </label>
              <label className="seg-opt">
                <input type="radio" name="scope" checked={scope === "pick"} onChange={() => setScope("pick")} />
                Pick
              </label>
            </div>
          </div>

          {scope === "pick" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {view.field.map((p) => {
                const on = picked.has(p.id);
                return (
                  <PersonChip
                    key={p.id}
                    name={p.name}
                    on={on}
                    onClick={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })
                    }
                  />
                );
              })}
            </div>
          )}

          {/* Never render a split that does not add up. */}
          {valid && shareIds.length > 0 && (
            <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>
              {money(Math.abs(cents))} between {shareIds.length} — about {money(each)} each
              {Math.abs(cents) % shareIds.length !== 0 && ", odd cents to the first names"}.
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1, minHeight: 46 }} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 2, minHeight: 46 }}
              disabled={pending || !valid || shareIds.length === 0}
              onClick={submit}
            >
              Save expense
            </button>
          </div>
          {error && (
            <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {error}
            </p>
          )}
        </section>
      )}

      {/* The side bets behind the "side games" figure above. A total a player
          cannot expand is a number they have to take on trust, and this is
          the screen that can least afford one. */}
      {view.contests.length > 0 && (
        <section className="card elev-sm" style={{ marginTop: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Side bets</span>
          {view.contests.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                paddingTop: 8,
                borderTop: "1px solid var(--color-divider)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 550 }}>
                  {c.name}
                  {c.hole > 0 && <span className="text-muted" style={{ fontWeight: 400 }}> · hole {c.hole}</span>}
                </span>
                <span className="text-muted" style={{ fontSize: 11.5 }}>
                  {money(c.potCents)} pot · {c.entrants} in ·{" "}
                  {c.decided
                    ? `won by ${c.winners.join(" & ")}`
                    : /* An open pot pays and charges nobody, and saying so is
                         better than showing everyone down their stake for a
                         contest that has not been won. */
                      "still open"}
                </span>
              </span>
              {c.yourCents !== 0 && (
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                    color: c.yourCents > 0 ? "var(--color-accent-2-300)" : "var(--color-text)",
                  }}
                >
                  {money(c.yourCents)}
                </span>
              )}

              {/* Put your own name down, before the round.
                  It says "asked to join" rather than "in" until the organizer
                  has the cash, because until then it costs nothing and counts
                  for nothing — and telling a player otherwise would be the app
                  inventing a debt. */}
              {view.playerId && !c.decided && (
                <button
                  type="button"
                  className="touch-target"
                  disabled={pending || c.youConfirmed}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await requestContestEntry(c.id, !c.youIn);
                      if (!res.ok) setError(res.error ?? "Couldn't do that.");
                    })
                  }
                  style={{
                    minHeight: 40,
                    padding: "0 12px",
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: c.youConfirmed ? "default" : "pointer",
                    color: "var(--color-text)",
                    background: c.youIn
                      ? "color-mix(in srgb, var(--color-accent) 16%, transparent)"
                      : "var(--color-surface)",
                    border: `1px solid ${c.youIn ? "var(--color-accent)" : "var(--color-divider)"}`,
                  }}
                >
                  {c.youConfirmed ? "You're in" : c.youIn ? "Asked to join" : "I'm in"}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Who hands what to whom. A plain list, and the copy never implies the
          app moved anything. */}
      {view.transfers.length > 0 && (
        <section className="card elev-sm" style={{ marginTop: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Settle up</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 10px", lineHeight: 1.5 }}>
            The fewest handovers that make everyone square. TourneyHQ works the money out; it never moves it.
          </p>
          {view.transfers.map((t) => (
            <div
              key={`${t.fromPlayerId}-${t.toPlayerId}-${t.cents}`}
              style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8, borderTop: "1px solid var(--color-divider)" }}
            >
              <span style={{ flex: 1, fontSize: 13.5 }}>
                {t.fromName} <i className="ph ph-arrow-right" aria-label="pays" /> {t.toName}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(t.cents)}</span>
              <button
                type="button"
                className="btn btn-secondary touch-target"
                style={{ fontSize: 12 }}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await recordSettlement(t.fromPlayerId, t.toPlayerId, t.cents);
                    if (!res.ok) setError(res.error ?? "Couldn't record that.");
                  })
                }
              >
                Mark settled
              </button>
            </div>
          ))}
        </section>
      )}

      {/* The lines themselves. */}
      <section className="card elev-sm" style={{ marginTop: 12 }}>
        <span className="card-title" style={{ fontSize: 15 }}>
          Expenses ({view.expenses.length})
        </span>
        {view.expenses.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.6 }}>
            Nothing yet. Add what you paid for and it splits between whoever was there — carts with your
            group, dinner with everyone.
          </p>
        )}
        {view.expenses.map((e) => (
          <details key={e.id} style={{ paddingTop: 8, borderTop: "1px solid var(--color-divider)" }}>
            <summary className="touch-target" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 550 }}>{e.description}</span>
                <span className="text-muted" style={{ fontSize: 11.5 }}>
                  {e.unknownPayer ? "Paid by someone no longer in the field" : `Paid by ${e.paidByName}`}
                  {" · "}
                  {e.shares.length} {e.shares.length === 1 ? "share" : "shares"}
                </span>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(e.amountCents)}</span>
            </summary>
            <div style={{ padding: "8px 0 4px" }}>
              {e.shares.map((s) => (
                <div key={s.playerId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
                  <span className="text-muted">{s.name}{s.weight === 0 && " (not on this bill)"}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(s.cents)}</span>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary touch-target"
                style={{ fontSize: 12, marginTop: 8 }}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await removeExpense(e.id);
                    if (!res.ok) setError(res.error ?? "Couldn't remove that.");
                  })
                }
              >
                <i className="ph ph-trash" /> Remove
              </button>
            </div>
          </details>
        ))}
      </section>

      {view.settlements.length > 0 && (
        <section className="card elev-sm" style={{ marginTop: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Already settled</span>
          {view.settlements.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, paddingTop: 6 }}>
              <span className="text-muted">{s.fromName} → {s.toName} · {s.settledAt}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(s.cents)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
