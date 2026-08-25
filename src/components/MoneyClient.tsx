"use client";
import { EXPENSE_CATEGORIES } from "@/lib/domain/expense-categories";
import { useMemo, useState, useTransition } from "react";
import { addExpense, removeExpense, recordSettlement } from "@/app/actions/expenses";
import { requestContestEntry } from "@/app/actions/contests";
import { requestSideGameEntry } from "@/app/actions/side-games";
import type { MoneyView } from "@/lib/services/expenses";
import { unitemisedGames } from "@/lib/domain/money-breakdown";
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

/** One shared empty list, so "no group" keeps the same identity between
 *  renders and a `useMemo` depending on it can actually memoize. */
const NO_IDS: string[] = [];

export function MoneyClient({ view }: { view: MoneyView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAllTransfers, setShowAllTransfers] = useState(false);

  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [amount, setAmount] = useState("");
  const [stageId, setStageId] = useState("");
  const [scope, setScope] = useState<Scope>("everyone");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(view.field.map((p) => p.id)));

  const round = view.rounds.find((r) => r.stageId === stageId) ?? null;
  // `NO_IDS`, not a fresh `[]`. The fallback used to allocate a new array on
  // every render, so the memo below saw a different dependency each time and
  // never memoized anything — which is exactly what the standing lint warning
  // was reporting. A shared frozen empty array has a stable identity.
  const groupIds = round?.groupPlayerIds ?? NO_IDS;

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
        category,
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

  // The part of the pot money no line on this screen accounts for.
  //
  // Only CONTESTS carry a per-player figure (`yourCents`). The score pots are
  // listed but say nothing about what they did for you, and the skins pot is
  // not in the player app at all — yet all three are inside `gamesCents`.
  // Subtracted from the total rather than fetched again, so it cannot disagree
  // with the figure it explains.
  const unaccounted = unitemisedGames(
    view.gamesCents,
    view.contests.map((c) => c.yourCents),
  );

  /**
   * Yours first, and the rest behind a button.
   *
   * A big opt-out pot settles into one transfer per entrant — thirty-odd of
   * them, most for the same few pounds to the same person. All of it is
   * correct and none of it is yours, so the handful a player has to actually
   * do was buried under a screenful of other people squaring up with each
   * other. Ordering by relevance rather than truncating: the whole list is
   * still reachable, because somebody has to be able to check it.
   */
  const mine = view.transfers.filter(
    (t) => t.fromPlayerId === view.playerId || t.toPlayerId === view.playerId,
  );
  const theirs = view.transfers.filter(
    (t) => t.fromPlayerId !== view.playerId && t.toPlayerId !== view.playerId,
  );
  const shownTransfers = showAllTransfers ? [...mine, ...theirs] : mine;

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--color-neutral-400)" }}>
        Money
      </div>


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
              /* Names the whole weekend, not just the round. The old
                 placeholder suggested only on-course costs, so the ledger
                 read as a green-fee splitter — while the lodging, the fuel
                 and the meals, which are the LARGER half of a golf trip, went
                 into somebody else's app and a second settle-up. */
              placeholder="Lodging, travel, fuel, carts, food, green fees…"
              onChange={(e) => setDescription(e.target.value)}
              style={{ minHeight: 46 }}
            />
          </div>
          {/* The column existed with no picker, so every line was filed under
              nothing and the ledger could not answer "what did the lodging
              come to" — the first question a group asks when deciding whether
              to go again. */}
          <div className="field">
            <label htmlFor="exp-category">Category</label>
            <select
              id="exp-category"
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ minHeight: 46 }}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
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
        {/* "Side bets", not "Side games". Three names for one pile of money:
            this figure said "Side games", the section below it said "Side
            bets", and the one under that said "Pots on the scores" — so a
            player looking for what made up "Side games" found no section by
            that name. "Side bets" is also what the organizer's screen calls the
            card holding both kinds, so the two screens now agree. */}
        <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 12, color: "var(--color-neutral-400)" }}>
          <span>Expenses {money(view.expensesCents)}</span>
          {view.gamesCents !== 0 && <span>Side bets {money(view.gamesCents)}</span>}
          {view.settledCents !== 0 && <span>Settled {money(view.settledCents)}</span>}
        </div>
      </section>

      {/* Part of what makes up the "Side bets" figure in the summary. A total a
          player cannot expand is a number they have to take on trust, and this
          is the screen that can least afford one.

          "Decided on the day", not "Side bets" — that is now the name of the
          WHOLE, so it cannot also be the name of one of its two halves. This is
          the half a person judges: closest to the pin, long drive, whatever the
          first tee invented. The other half is worked out from the cards. Same
          distinction the organizer's screen draws with "You name the winner"
          and "Settled by the scores", in words that fit somebody who is not
          naming anybody. */}
      {view.contests.length > 0 && (
        <section className="card elev-sm" style={{ marginTop: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Decided on the day</span>
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

      {/* The pots the cards settle. Listed so a player can put their own name
          down for the birdie pot without finding the organizer first — and so
          the "side games" figure above can be broken open. */}
      {view.sideGames.length > 0 && (
        <section className="card elev-sm" style={{ marginTop: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Pots on the scores</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 8px", lineHeight: 1.5 }}>
            Worked out from the cards — no result to enter. Put your name down here and pay the
            organizer; nothing counts until they have it.
          </p>
          {view.sideGames.map((g) => (
            <div
              key={g.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                paddingTop: 8,
                borderTop: "1px solid var(--color-divider)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 550 }}>{g.label}</span>
                <span className="text-muted" style={{ fontSize: 11.5 }}>
                  {money(g.buyInCents)} each · {money(g.potCents)} pot · {g.entrants} in
                </span>
              </span>
              {view.playerId && (
                <button
                  type="button"
                  className="touch-target"
                  disabled={pending || g.youConfirmed}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await requestSideGameEntry(g.id, !g.youIn);
                      if (!res.ok) setError(res.error ?? "Couldn't do that.");
                    })
                  }
                  style={{
                    minHeight: 40,
                    padding: "0 12px",
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: g.youConfirmed ? "default" : "pointer",
                    color: "var(--color-text)",
                    background: g.youIn
                      ? "color-mix(in srgb, var(--color-accent) 16%, transparent)"
                      : "var(--color-surface)",
                    border: `1px solid ${g.youIn ? "var(--color-accent)" : "var(--color-divider)"}`,
                  }}
                >
                  {g.youConfirmed ? "You're in" : g.youIn ? "Asked to join" : "I'm in"}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* The rest of the "Side bets" figure, which had nowhere to appear.
          `gameNets` settles from three tables — the skins pot, side games and
          contests — and only CONTESTS carry a per-player figure. The score pots
          are listed but say nothing about what they did for you, and the skins
          pot is not in the player app at all. So part of a real number had no
          line explaining it, on the screen whose own comment says a total a
          player cannot expand is one it can least afford.

          Subtraction, not a second query: services/expenses.ts says a second
          implementation of the skins arithmetic inside a money screen "is
          exactly the drift this app has been burned by, and this one would
          drift about what somebody owes". A remainder cannot disagree with its
          own total. */}
      {unaccounted !== 0 && (
        <section className="card elev-sm" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 550 }}>
                The rest of your side bets
              </span>
              <span className="text-muted" style={{ fontSize: 11.5 }}>
                Your share of the skins and the score pots — worked out from the cards.
              </span>
            </span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: unaccounted > 0 ? "var(--color-accent-2-300)" : "var(--color-text)",
              }}
            >
              {money(unaccounted)}
            </span>
          </div>
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
          {shownTransfers.map((t) => (
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
          {theirs.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAllTransfers((v) => !v)}
              style={{ marginTop: 10, width: "100%", justifyContent: "center", fontSize: 12.5 }}
            >
              {showAllTransfers
                ? "Just mine"
                : `Show everyone else’s ${theirs.length} handover${theirs.length === 1 ? "" : "s"}`}
            </button>
          )}
          {mine.length === 0 && !showAllTransfers && (
            <p className="text-muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
              Nothing for you to hand over or collect.
            </p>
          )}
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
