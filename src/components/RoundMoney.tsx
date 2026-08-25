"use client";
import { useState } from "react";
import type { RoundMoneyView } from "@/lib/services/expenses";
import { useMoney } from "@/components/CurrencyProvider";

/**
 * What the pots paid, round by round, with the outing underneath.
 *
 * Both, because they answer different questions: "did I win the skins on
 * Thursday" is a round, and "what am I owed at the end" is the outing. A
 * league settles every week and a running season total means nothing to it; a
 * member-guest settles once and three separate sheets are a nuisance.
 *
 * Nothing appears for a round still being played. Not hidden after the fact —
 * the service does not compute it, so there is no half-answer here to leak.
 * A player looking at forty pounds on the 14th who finishes with nothing has
 * been told something the app had no business claiming.
 */
export function RoundMoney({ view }: { view: RoundMoneyView }) {
  const [open, setOpen] = useState<string | null>(null);
  // The club's currency from the provider, not a symbol threaded in as a
  // prop. The prop carried only the SYMBOL, so it could not say how many minor
  // units the currency has — and `/ 100` assumed a hundred, which yen has not.
  const { money: fmt } = useMoney();
  const money = (cents: number) => `${cents > 0 ? "+" : ""}${fmt(cents)}`;
  const tone = (cents: number) =>
    cents > 0 ? "var(--color-accent-2-300)" : cents < 0 ? "var(--color-danger)" : "var(--color-text)";

  const played = view.rounds.filter((r) => r.final);

  return (
    <section className="card elev-sm" style={{ gap: 10 }}>
      <span className="card-title" style={{ fontSize: 15 }}>The pots</span>

      {!view.playerId ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          You aren&rsquo;t in this tournament&rsquo;s field, so there is nothing here for you.
        </p>
      ) : !view.anyFinal ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          Nothing settled yet. A round&rsquo;s pots are worked out once every hole is in — a skins pot can
          carry to the last green, so a running total would only be a different number that looked like the
          answer.
        </p>
      ) : (
        <>
          {/* The outing first: the number people actually came for. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
            }}
          >
            <span style={{ fontSize: 13 }}>
              {view.yourTotalCents > 0
                ? "You're up over the whole tournament"
                : view.yourTotalCents < 0
                  ? "You're down over the whole tournament"
                  : "You're square over the whole tournament"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 22,
                color: tone(view.yourTotalCents),
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {money(view.yourTotalCents)}
            </span>
          </div>

          {/* Then the rounds that made it up. */}
          {played.map((r) => {
            const isOpen = open === r.stageId;
            return (
              <div key={r.stageId} style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.stageId)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "none",
                    border: "none",
                    padding: "4px 0",
                    color: "var(--color-text)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 14 }}>{r.label}</span>
                  <span
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      color: tone(r.yourCents),
                    }}
                  >
                    {money(r.yourCents)}
                  </span>
                  <i className={isOpen ? "ph ph-caret-up" : "ph ph-caret-down"} />
                </button>

                {isOpen && (
                  <div style={{ padding: "4px 0 8px" }}>
                    {r.standing.length === 0 ? (
                      <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>
                        No pots on this round.
                      </p>
                    ) : (
                      r.standing.map((s) => (
                        <div
                          key={s.playerId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            fontSize: 13,
                            padding: "3px 0",
                            fontWeight: s.playerId === view.playerId ? 600 : 400,
                          }}
                        >
                          <span>{s.name}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums", color: tone(s.netCents) }}>
                            {money(s.netCents)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Rounds still out there, so the total is not mistaken for the end
              of it. Named rather than counted: "Round 3 is still out" is a
              fact somebody can check against the leaderboard. */}
          {view.rounds.some((r) => !r.final) && (
            <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0", lineHeight: 1.6 }}>
              Still being played:{" "}
              {view.rounds
                .filter((r) => !r.final)
                .map((r) => `${r.label} (${r.holesReturned}/${r.holeCount} holes in)`)
                .join(", ")}
              . Their pots are added here once they finish.
            </p>
          )}
        </>
      )}

      <p className="text-muted" style={{ fontSize: 11.5, margin: "2px 0 0" }}>
        TourneyHQ works this out and writes it down. It never moves money.
      </p>
    </section>
  );
}
