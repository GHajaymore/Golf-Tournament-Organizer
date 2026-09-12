"use client";
import { useState, useTransition } from "react";
import { recordSettlement, removeSettlement } from "@/app/actions/expenses";
import type { MoneyView } from "@/lib/services/expenses";
import { useMoney } from "@/components/CurrencyProvider";
import { splitLabel } from "@/lib/domain/expense-split-label";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";

/**
 * The ledger, for whoever is running it.
 *
 * The settle-up lived only on the player screen, reached at /me/money — which
 * works for an organizer who is also playing and fails completely for the one
 * who is not. A society treasurer collecting for the minibus is the single
 * most likely person to need this and was the one person who could not see it:
 * the screen is built around "you", and a treasurer standing off the course
 * has no row of their own.
 *
 * So this answers the other question. Not "what do I owe" but "where is
 * everybody, and what is left to collect" — the whole standing, every
 * handover, and the lines behind them.
 */
export function OrganizerLedger({ view }: { view: MoneyView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showLines, setShowLines] = useState(false);

  // The club's currency, from the provider. The old prop carried a SYMBOL,
  // which cannot say how many minor units a currency has.
  const { money } = useMoney();
  const tone = (cents: number) =>
    cents > 0 ? "var(--color-accent-2-300)" : cents < 0 ? "var(--color-danger)" : "var(--color-text)";

  const owed = view.standing.filter((s) => s.netCents > 0);
  const owing = view.standing.filter((s) => s.netCents < 0);
  const square = view.standing.filter((s) => s.netCents === 0);
  // What is still to move. The transfers ARE the outstanding position — a
  // settled payment has already been folded into the standing.
  const outstanding = view.transfers.reduce((a, t) => a + t.cents, 0);

  return (
    <section className="card elev-sm" style={{ marginTop: 16, gap: 10 }}>
      <span className="card-title" style={{ fontSize: 15 }}>The ledger</span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: "-2px 0 0", lineHeight: 1.55 }}>
        Everybody&rsquo;s position and what is left to collect. Expenses and side-game winnings together,
        which is the only figure worth settling on. TourneyHQ works it out; it never moves the money.
      </p>

      <div className="stat-grid" style={{ marginTop: 4 }}>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Still to change hands</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{money(outstanding)}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            over {view.transfers.length} handover{view.transfers.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Owed money</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{owed.length}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>people fronted something</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Owe money</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{owing.length}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {square.length > 0 ? `${square.length} already square` : "nobody square yet"}
          </div>
        </div>
      </div>

      {/* Everyone, creditors first — the way a treasurer reads it: who do I
          have to pay out, then who do I have to chase. */}
      <div style={{ marginTop: 6 }}>
        <span className="card-kicker">Where everybody stands</span>
        <div style={{ marginTop: 6 }}>
          {view.standing.length === 0 && (
            <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>
              Nothing recorded yet.
            </p>
          )}
          {view.standing.map((s) => (
            <div
              key={s.playerId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                fontSize: 13,
                padding: "5px 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              <span>{s.name}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: tone(s.netCents) }}>
                {money(s.netCents)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Every handover, not just one person's — this is the list a treasurer
          works down. Marking one settled is recorded as a payment that
          happened, which is all this app ever claims about money. */}
      {view.transfers.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <span className="card-kicker">To collect and pay out</span>
          <div style={{ marginTop: 6 }}>
            {view.transfers.map((t) => (
              <div
                key={`${t.fromPlayerId}-${t.toPlayerId}-${t.cents}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--color-divider)",
                }}
              >
                <span style={{ flex: 1, fontSize: 13 }}>
                  {t.fromName} <Icon name="arrow-right" aria-label="pays" /> {t.toName}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(t.cents)}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12 }}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError("");
                      const res = await recordSettlement(t.fromPlayerId, t.toPlayerId, t.cents);
                      if (!res.ok) setError(res.error ?? "Couldn't record that.");
                    })
                  }
                >
                  Mark settled
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="form-error">
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      {/* WHAT HAS ALREADY BEEN COLLECTED.
          A settled handover drops out of the list above, because it has been
          folded into the standing — so the treasurer marked it and then had no
          record that they had. "Did I already collect from Priya?" had no
          answer on the one screen built for collecting. The player's own
          screen has shown this all along.

          With who recorded it, which is the provenance a treasurer is asked
          for, and an Undo — `removeSettlement` shipped fully authorized and
          audit-tested, wired to nothing at all. */}
      {view.settlements.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <span className="card-kicker">Already collected</span>
          <div style={{ marginTop: 6 }}>
            {view.settlements.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12.5,
                  padding: "5px 0",
                  borderBottom: "1px solid var(--color-divider)",
                }}
              >
                <span className="text-muted" style={{ flex: 1, minWidth: 0 }}>
                  {s.fromName} <Icon name="arrow-right" aria-label="paid" /> {s.toName} · {s.settledAt}
                  {s.recordedBy ? ` · recorded by ${s.recordedBy}` : ""}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(s.cents)}</span>
                {s.canRemove && (
                  <ConfirmButton
                    className="btn btn-ghost"
                    style={{ fontSize: 11.5 }}
                    icon="arrow-counter-clockwise"
                    label="Undo"
                    title={`Undo ${s.fromName} to ${s.toName}`}
                    confirmLabel="Undo it"
                    note="Says the money did not change hands after all."
                    disabled={pending}
                    onConfirm={() =>
                      startTransition(async () => {
                        setError("");
                        const res = await removeSettlement(s.id);
                        if (!res.ok) setError(res.error ?? "Couldn't undo that.");
                      })
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The lines behind it, folded away. A treasurer checks these when
          somebody queries a number, not on the way past. */}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setShowLines((v) => !v)}
        style={{ alignSelf: "flex-start", fontSize: 12.5 }}
      >
        <Icon name={showLines ? "ph ph-caret-up" : "ph ph-caret-down"} /> The {view.expenses.length} expense
        {view.expenses.length === 1 ? "" : "s"} behind it
      </button>
      {showLines && (
        <div>
          {view.expenses.map((e) => (
            <div
              key={e.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                fontSize: 13,
                padding: "6px 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block" }}>{e.description}</span>
                <span className="text-muted" style={{ fontSize: 11.5 }}>
                  {/* THE DIVISION, NOT THE COUNT — the same rule the player's
                      screen has had, from the same function.

                      This said "7 shares". A count is not checkable; a
                      division is, and "$287.00 ÷ 7" is arithmetic a treasurer
                      can do in their head while somebody is querying it on the
                      phone. The player's ledger was fixed and this one, its
                      sibling, was not. */}
                  Paid by {e.paidByName || "somebody no longer in the field"}
                  {` · ${splitLabel(e.amountCents, e.shares, money)}`}
                  {e.spentOn ? ` · ${e.spentOn}` : ""}
                </span>
                {/* WHO OWES WHAT ON THIS LINE.
                    These lines are folded away because a treasurer opens them
                    when somebody queries a number — and the query is nearly
                    always "why do I owe that", which the total alone cannot
                    answer. The player's own screen shows this; the person
                    actually collecting the money could not see it. */}
                <span style={{ display: "block", marginTop: 4 }}>
                  {e.shares
                    .filter((s) => s.weight > 0 || (s.exactCents ?? 0) !== 0)
                    .map((s) => (
                      <span
                        key={s.playerId}
                        className="text-muted"
                        style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5, padding: "1px 0" }}
                      >
                        <span style={{ minWidth: 0 }}>{s.name}</span>
                        <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {money(s.cents)}
                        </span>
                      </span>
                    ))}
                </span>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(e.amountCents)}</span>
            </div>
          ))}
          {view.expenses.length === 0 && (
            <p className="text-muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
              No expenses recorded. Players add them from their own Money tab.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
