"use client";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/lib/domain/expense-categories";
import { useMemo, useState, useTransition } from "react";
import { addExpense, updateExpense, removeExpense, recordSettlement } from "@/app/actions/expenses";
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
type SplitMode = "evenly" | "shares" | "exact" | "percent";

/** Cents from whatever somebody typed, tolerant of "$", spaces and commas. */
const centsFrom = (text: string): number => {
  const n = Number((text ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** One shared empty list, so "no group" keeps the same identity between
 *  renders and a `useMemo` depending on it can actually memoize. */
const NO_IDS: string[] = [];

export function MoneyClient({ view }: { view: MoneyView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  /** The expense being changed, or null when this is a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Which line is one tap from being deleted. Money does not vanish on one tap. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showAllTransfers, setShowAllTransfers] = useState(false);

  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  // Defaults to you, which is the common case and what it always did.
  const [paidBy, setPaidBy] = useState<string>(view.playerId);
  const [amount, setAmount] = useState("");
  const [stageId, setStageId] = useState("");
  const [scope, setScope] = useState<Scope>("everyone");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(view.field.map((p) => p.id)));
  /** Shares per player, where anything unset is one. */
  const [weights, setWeights] = useState<Record<string, number>>({});
  /**
   * HOW the bill divides, which is a separate question from WHO is on it.
   *
   * Four ways, because a golf weekend generates all four and forcing one of
   * them into another is where the faked expenses came from:
   *  - evenly   the common case
   *  - shares   the room somebody had for one night (2:2:2:1)
   *  - exact    two rooms at rates that do not reduce to a ratio
   *  - percent  the corporate day where somebody covers 60%
   *
   * Percent is weights out of a hundred and is sent as weights; exact is the
   * only one the model needed a new column for.
   */
  const [splitMode, setSplitMode] = useState<SplitMode>("evenly");
  /** Typed amounts per player, as entered, for the exact and percent modes. */
  const [typed, setTyped] = useState<Record<string, string>>({});
  /** Whether more than one person put money down for this one bill. */
  const [manyPayers, setManyPayers] = useState(false);
  const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>({});

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

  /**
   * Who may appear as a PAYER, which is not the same list as who shares.
   *
   * Somebody can pay for a bill they are not on — one player fronting a
   * guest's green fee — so the payer list is the whole field, with the people
   * on this line first because that is who it usually is.
   */
  const shareIdsAndField = useMemo(() => {
    const onLine = new Set(shareIds);
    return [...shareIds, ...view.field.map((p) => p.id).filter((id) => !onLine.has(id))];
  }, [shareIds, view.field]);

  const cents = centsFrom(amount);
  const each = shareIds.length ? Math.floor(Math.abs(cents) / shareIds.length) : 0;

  /**
   * What each mode sends.
   *
   * `exact` sends amounts; `percent` converts to weights, because a percentage
   * IS a weight out of a hundred and the ledger should not carry two ways of
   * saying the same thing. Everything else sends weights.
   */
  const shares = useMemo(
    () =>
      shareIds.map((playerId) => {
        if (splitMode === "exact") {
          return { playerId, weight: 1, amountCents: centsFrom(typed[playerId] ?? "") };
        }
        if (splitMode === "percent") {
          return { playerId, weight: Math.max(0, Math.round(Number(typed[playerId] ?? "") || 0)) };
        }
        if (splitMode === "shares") return { playerId, weight: weights[playerId] ?? 1 };
        return { playerId, weight: 1 };
      }),
    [shareIds, splitMode, typed, weights],
  );

  const payers = useMemo(
    () =>
      manyPayers
        ? shareIdsAndField
            .map((playerId) => ({ playerId, amountCents: centsFrom(paidAmounts[playerId] ?? "") }))
            .filter((p) => p.amountCents !== 0)
        : [],
    [manyPayers, paidAmounts, shareIdsAndField],
  );

  /**
   * The two sums a person can get wrong, checked here so the answer arrives
   * while they are still typing rather than after a round trip. The server
   * checks them again — it is a public endpoint and this is money — but a
   * split that does not add up should never be submittable in the first place.
   */
  const splitTotal = splitMode === "exact" ? shares.reduce((s, r) => s + (r.amountCents ?? 0), 0) : cents;
  const percentTotal = splitMode === "percent" ? shares.reduce((s, r) => s + r.weight, 0) : 100;
  const paidTotal = payers.reduce((s, p) => s + p.amountCents, 0);

  const splitOff = splitMode === "exact" && cents !== 0 ? cents - splitTotal : 0;
  const percentOff = splitMode === "percent" ? 100 - percentTotal : 0;
  const paidOff = manyPayers && cents !== 0 ? cents - paidTotal : 0;

  const valid =
    description.trim().length > 0 &&
    Number.isFinite(cents) &&
    cents !== 0 &&
    shareIds.length > 0 &&
    splitOff === 0 &&
    percentOff === 0 &&
    paidOff === 0;

  /**
   * Put the form back to empty.
   *
   * Every field, not just the two that were being cleared. Leaving the split
   * mode, the picked players and the typed amounts behind meant the NEXT
   * expense silently inherited the last one's arrangement — the bar split two
   * ways becoming the default for the green fees.
   */
  const reset = () => {
    setEditing(null);
    setDescription("");
    setAmount("");
    setCategory("other");
    setPaidBy(view.playerId);
    setStageId("");
    setScope("everyone");
    setPicked(new Set(view.field.map((p) => p.id)));
    setWeights({});
    setSplitMode("evenly");
    setTyped({});
    setManyPayers(false);
    setPaidAmounts({});
    setAdding(false);
  };

  /**
   * Reopen an existing line in the form that created it.
   *
   * One form for both, rather than a second one for editing: two forms over
   * the same six-part arrangement — payers, participants, weights, exact
   * amounts, category, round — is two places for the rules to drift, and the
   * one that drifts is always the one used less.
   *
   * The saved shape decides the mode, so a line entered as exact amounts
   * reopens as exact amounts rather than being silently re-split evenly.
   */
  const startEdit = (e: MoneyView["expenses"][number]) => {
    setError("");
    setEditing(e.id);
    setDescription(e.description);
    setAmount((e.amountCents / 100).toFixed(2));
    setCategory(e.category || "other");
    setPaidBy(e.paidBy);
    setStageId("");

    const ids = e.shares.map((s) => s.playerId);
    setScope("pick");
    setPicked(new Set(ids));

    const exact = e.shares.some((s) => s.exactCents !== null);
    if (exact) {
      setSplitMode("exact");
      setTyped(
        Object.fromEntries(e.shares.map((s) => [s.playerId, ((s.exactCents ?? 0) / 100).toFixed(2)])),
      );
      setWeights({});
    } else {
      // Weights of all 1 are an even split; anything else was deliberate.
      const uneven = e.shares.some((s) => s.weight !== 1);
      setSplitMode(uneven ? "shares" : "evenly");
      setWeights(Object.fromEntries(e.shares.map((s) => [s.playerId, s.weight])));
      setTyped({});
    }

    setManyPayers(e.payers.length > 0);
    setPaidAmounts(
      Object.fromEntries(e.payers.map((p) => [p.playerId, (p.amountCents / 100).toFixed(2)])),
    );
    setAdding(true);
  };

  const submit = () => {
    setError("");
    startTransition(async () => {
      const input = {
        description,
        amountCents: cents,
        paidBy,
        stageId,
        category,
        shares,
        // Omitted, not empty: the action reads an absent list as "the named
        // payer covered it" and an empty one as "nobody paid", which is an
        // error. Sending [] for the ordinary one-payer case would refuse
        // every expense on the screen.
        ...(payers.length > 0 ? { payers } : {}),
      };
      const res = editing ? await updateExpense(editing, input) : await addExpense(input);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        return;
      }
      reset();
    });
  };

  const owed = view.netCents > 0;

  /**
   * How many people are not square.
   *
   * The floor on handovers WITHOUT simplification: everybody who owes
   * something makes at least one payment. Comparing it to the simplified
   * count is what turns “trust us” into a number somebody can check.
   */
  const owing = view.standing.filter((s) => s.netCents < 0).length;

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
          onClick={() => { reset(); setAdding(true); }}
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
          {/* WHO PAID, which this could not say.
              It was hard-coded to whoever was signed in, so the ledger could
              only hold what YOU paid. One person doing the admin — which is
              how a society trip actually runs — could not enter the dinner
              somebody else put on their card, and a player who does not use
              the app could not be owed anything at all. The action already
              accepted any payer in the field and checked it; only the screen
              insisted. */}
          <div className="field">
            <label htmlFor="exp-payer">Who paid</label>
            <select
              id="exp-payer"
              className="input"
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              style={{ minHeight: 46 }}
            >
              {view.field.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === view.playerId ? `${p.name} (you)` : p.name}
                </option>
              ))}
            </select>
          </div>
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

          {/* HOW IT DIVIDES — a separate question from who is on it.
              The model always held unequal shares and the screen only ever
              sent 1s, so a single room against three twins, or two rooms at
              different rates, had to be faked as separate expenses. All four
              ways are now offered, because a weekend generates all four. */}
          {shareIds.length > 1 && (
            <div className="field">
              <label>Split</label>
              <div className="seg">
                {([
                  ["evenly", "Evenly"],
                  ["shares", "By shares"],
                  ["exact", "Exact amounts"],
                  ["percent", "By percent"],
                ] as Array<[SplitMode, string]>).map(([key, label]) => (
                  <label className="seg-opt" key={key}>
                    <input
                      type="radio"
                      name="splitMode"
                      checked={splitMode === key}
                      onChange={() => setSplitMode(key)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {shareIds.length > 1 && splitMode !== "evenly" && (
            <div style={{ display: "grid", gap: 6 }}>
              {shareIds.map((id) => {
                const p = view.field.find((f) => f.id === id);
                if (!p) return null;
                return (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                    {splitMode === "shares" ? (
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={99}
                        aria-label={`Shares for ${p.name}`}
                        value={weights[id] ?? 1}
                        onChange={(e) =>
                          setWeights((prev) => ({ ...prev, [id]: Math.max(0, Number(e.target.value) || 0) }))
                        }
                        style={{ width: 68, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                      />
                    ) : (
                      <input
                        className="input"
                        inputMode="decimal"
                        aria-label={
                          splitMode === "exact" ? `Amount for ${p.name}` : `Percent for ${p.name}`
                        }
                        placeholder={splitMode === "exact" ? "0.00" : "0"}
                        value={typed[id] ?? ""}
                        onChange={(e) => setTyped((prev) => ({ ...prev, [id]: e.target.value }))}
                        style={{ width: 92, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                      />
                    )}
                  </label>
                );
              })}

              {/* What is still missing, said as a number rather than as
                  "invalid". Somebody typing four amounts wants to know how
                  much is left, not that they are wrong. */}
              {splitMode === "exact" && splitOff !== 0 && cents !== 0 && (
                <span style={{ fontSize: 12, color: "var(--color-danger)" }}>
                  {splitOff > 0 ? `${money(splitOff)} still to allocate` : `${money(-splitOff)} over the total`}
                </span>
              )}
              {splitMode === "percent" && percentOff !== 0 && (
                <span style={{ fontSize: 12, color: "var(--color-danger)" }}>
                  {percentOff > 0 ? `${percentOff}% still to allocate` : `${-percentOff}% over 100`}
                </span>
              )}
              {splitMode === "shares" && (
                <span className="text-muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                  Shares, not amounts — two means twice as much as one. A zero leaves somebody on the
                  line without charging them, which is how a guest gets included in the round and not
                  in the bill.
                </span>
              )}
            </div>
          )}

          {/* MORE THAN ONE CARD. A bill is not always one person's, and
              splitting it into two expenses to record that would say the group
              ate two dinners. */}
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={manyPayers}
                onChange={(e) => setManyPayers(e.target.checked)}
              />
              More than one person paid
            </label>
          </div>

          {manyPayers && (
            <div style={{ display: "grid", gap: 6 }}>
              {shareIdsAndField.map((id) => {
                const p = view.field.find((f) => f.id === id);
                if (!p) return null;
                return (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                    <input
                      className="input"
                      inputMode="decimal"
                      aria-label={`Amount paid by ${p.name}`}
                      placeholder="0.00"
                      value={paidAmounts[id] ?? ""}
                      onChange={(e) => setPaidAmounts((prev) => ({ ...prev, [id]: e.target.value }))}
                      style={{ width: 92, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    />
                  </label>
                );
              })}
              {paidOff !== 0 && cents !== 0 && (
                <span style={{ fontSize: 12, color: "var(--color-danger)" }}>
                  {paidOff > 0
                    ? `${money(paidOff)} of this bill is unaccounted for`
                    : `${money(-paidOff)} more than the bill`}
                </span>
              )}
              <span className="text-muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                Leave somebody blank if they put nothing in. Anyone can pay for a bill they are not
                sharing — fronting a guest&rsquo;s green fee is exactly that.
              </span>
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
            <button type="button" className="btn btn-secondary" style={{ flex: 1, minHeight: 46 }} onClick={reset}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 2, minHeight: 46 }}
              disabled={pending || !valid || shareIds.length === 0}
              onClick={submit}
            >
              {editing ? "Save changes" : "Save expense"}
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
              {/* ITEMISED, where it used to be a lump.
                  This was money in a player's own total that the screen could
                  not account for — captioned honestly, and still the fastest
                  way to make a correct number look wrong. The pot service
                  always knew which holes somebody won; it was thrown away one
                  line later.

                  It is also the half a general expense splitter can never
                  show, because it never scored the round. */}
              {view.gameLines.length > 0 && (
                <span style={{ display: "block", marginTop: 6 }}>
                  {view.gameLines.map((l) => (
                    <span
                      key={`${l.label}-${l.detail}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        fontSize: 12,
                        padding: "2px 0",
                      }}
                    >
                      <span className="text-muted" style={{ minWidth: 0 }}>
                        {l.label} — {l.detail}
                      </span>
                      <span
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                          color: l.cents > 0 ? "var(--color-accent-2-300)" : undefined,
                        }}
                      >
                        {money(l.cents)}
                      </span>
                    </span>
                  ))}
                </span>
              )}
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
            {/* SHOW THE SAVING, do not just claim it.
                Every splitting app simplifies debts and every one of them
                asks you to take it on faith, which is why people re-add it by
                hand to check. The count everybody WOULD have made is knowable
                — it is how many people are not square — so it is stated
                beside the count they now have. A reduction you can see is a
                reduction nobody re-does on paper. */}
            {view.transfers.length > 0 && owing > view.transfers.length ? (
              <>
                <b>
                  {view.transfers.length} handover{view.transfers.length === 1 ? "" : "s"}
                </b>{" "}
                instead of {owing} — everybody squares without {owing - view.transfers.length} of the
                payments they would otherwise have made.{" "}
              </>
            ) : (
              <>The fewest handovers that make everyone square. </>
            )}
            TourneyHQ works the money out; it never moves it.
          </p>
          {shownTransfers.map((t) => (
            <div
              key={`${t.fromPlayerId}-${t.toPlayerId}-${t.cents}`}
              style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8, borderTop: "1px solid var(--color-divider)" }}
            >
              <span style={{ flex: 1, fontSize: 13.5, minWidth: 0 }}>
                {t.fromName} <i className="ph ph-arrow-right" aria-label="pays" /> {t.toName}
                {/* WHAT IT IS FOR.
                    A handover says an amount and nothing else, which is the
                    moment somebody asks "for what?" and nobody can answer
                    without scrolling.

                    It explains the POSITION, not the transfer, and says so.
                    A netted handover cannot be attributed to particular
                    lines — that is what netting means — and labelling this
                    one "the lodging" would be a tidy lie. Shown only on your
                    own rows, because these are the only parts this screen
                    knows: somebody else's breakdown is not ours to state. */}
                {(t.fromPlayerId === view.playerId || t.toPlayerId === view.playerId) && (
                  <span
                    className="text-muted"
                    style={{ display: "block", fontSize: 11.5, lineHeight: 1.5, marginTop: 2 }}
                  >
                    Your position: {money(view.expensesCents)} of shared costs
                    {view.gamesCents !== 0 && <> · {money(view.gamesCents)} from the games</>}
                    {view.settledCents !== 0 && <> · {money(view.settledCents)} already settled</>}
                  </span>
                )}
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
                  {/* Everyone who paid, not just the first of them. This said
                      "Paid by {one name}" from the moment a bill could have
                      several payers: the arithmetic credited both and the
                      sentence named one, which is the kind of wrong nobody
                      reports and everybody stops trusting. */}
                  {e.payers.length > 1
                    ? `Paid by ${e.payers.map((p) => `${p.name} ${money(p.amountCents)}`).join(", ")}`
                    : e.unknownPayer
                      ? "Paid by someone no longer in the field"
                      : `Paid by ${e.paidByName}`}
                  {" · "}
                  {e.shares.length} {e.shares.length === 1 ? "share" : "shares"}
                  {e.category && e.category !== "other" && ` · ${expenseCategoryLabel(e.category)}`}
                  {e.spentOn && ` · ${e.spentOn}`}
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
              {/* Offered only to whoever entered it, or staff. The server
                  enforces the same rule from the same function, so a button
                  shown here is a button that works — and a line somebody else
                  entered simply has no controls rather than controls that
                  refuse. */}
              {!e.canEdit && (
                <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
                  Entered by {e.createdBy || "someone else"} — ask them or an organizer to change it.
                </p>
              )}
              {e.canEdit && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-secondary touch-target"
                  style={{ fontSize: 12 }}
                  disabled={pending}
                  onClick={() => startEdit(e)}
                >
                  <i className="ph ph-pencil-simple" /> Edit
                </button>

                {/* Two taps, not one.
                    A wrong participant used to mean deleting the line and
                    typing it again, so Remove was the only way to fix
                    anything and sat one tap from a finger. Now that Edit
                    exists, Remove only ever means "this never happened" — and
                    a money record that disappears without a confirmation is
                    one nobody can reconstruct. */}
                {confirmDelete === e.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-danger touch-target"
                      style={{ fontSize: 12 }}
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await removeExpense(e.id);
                          if (!res.ok) setError(res.error ?? "Couldn't remove that.");
                          setConfirmDelete(null);
                        })
                      }
                    >
                      <i className="ph ph-trash" /> Yes, remove it
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary touch-target"
                      style={{ fontSize: 12 }}
                      onClick={() => setConfirmDelete(null)}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary touch-target"
                    style={{ fontSize: 12 }}
                    disabled={pending}
                    onClick={() => setConfirmDelete(e.id)}
                  >
                    <i className="ph ph-trash" /> Remove
                  </button>
                )}
              </div>
              )}
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
