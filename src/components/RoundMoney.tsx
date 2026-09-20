"use client";
import { useState } from "react";
import type { RoundMoneyView } from "@/lib/services/expenses";
import { useMoney } from "@/components/CurrencyProvider";
import { Icon } from "./Icon";

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
  /**
   * A SHARED-BALL ROUND IS NOT OUTSTANDING. It is finished and unpayable.
   *
   * Foursomes, greensomes and a scramble have no individual scores, so a
   * per-player pot is refused on them at the door — and their card is filed
   * against the SIDE, which `roundStrokes` correctly declines to key on a
   * player. The money view therefore sees a round with no cards, for ever, and
   * "not final" was being read as "still being played".
   *
   * That is what printed "a round's pots are worked out once every hole is in"
   * over a finished tournament on the seeded club, 2026-09-20: the screen was
   * waiting on two foursomes rounds it can never pay from. Waiting is the
   * wrong word for a round whose amount cannot change, which is the test
   * `money-layout.ts` opens with.
   *
   * Named below rather than silently dropped — a round that disappears from
   * "still being played" without a reason is the same absence-reported-as-fact
   * this screen keeps being fixed for.
   */
  const sharedBall = view.rounds.filter((r) => r.sharedBall);
  /**
   * ONE LIST, READ BY BOTH — the header's scope and the "Still being played"
   * line at the foot of this card.
   *
   * They were two copies of `view.rounds.some((r) => !r.final)`, and a source
   * test pinned the duplication precisely so the two could not drift. The rule
   * has grown a second clause, so the list is built once instead: a copy that
   * has to be updated twice is the thing that test was protecting against.
   */
  const stillPlaying = view.rounds.filter((r) => !r.final && !r.sharedBall);
  const outstanding = stillPlaying.length > 0;
  /**
   * What the headline total is actually over.
   *
   * "the whole tournament" is only true once nothing is outstanding. Read off
   * the same list the "Still being played" line uses at the foot of this card,
   * so the two cannot come to disagree about whether a round is still out —
   * and so a tournament that finishes gets the fuller sentence back without
   * anybody remembering to change it.
   */
  const scope = outstanding ? " on the rounds that have finished" : " over the whole tournament";

  return (
    <section className="card elev-sm" style={{ gap: 10 }}>
      <span className="card-title" style={{ fontSize: 15 }}>The pots</span>

      {/*
        What is riding on the round in front of you.

        A player can be in the club's pot, their fourball's skins, a birdie pot
        and a two-man bet at once, and every one of those was its own row with
        no total anywhere. This is the number somebody wants walking to the
        first tee, and it is a STAKE rather than a position — knowable the
        moment the bets are agreed, and unchanged by what the cards do — which
        is the only reason it is safe to show while a round is still live.
      */}
      {view.playerId && view.stake.games > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-divider)",
            minWidth: 0,
          }}
        >
          <span className="text-muted" style={{ fontSize: 12.5, minWidth: 0, lineHeight: 1.5 }}>
            You&rsquo;re in {view.stake.games} {view.stake.games === 1 ? "game" : "games"} still to
            play
          </span>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 16, whiteSpace: "nowrap" }}>
            {fmt(view.stake.cents)} in
          </span>
        </div>
      )}

      {!view.playerId ? (
        /**
         * SCOPED TO THE POTS, because the page carries on underneath it.
         *
         * This said "there is nothing here for you", sitting directly below
         * the page's Money heading — and then the screen showed the contest
         * results, the skins pot, the settle-up handovers, six itemised
         * expenses, and an "Add an expense" button aimed at this very reader.
         * The one sentence a non-entrant reads first was the one thing on the
         * page that was not true.
         *
         * What is actually absent is a STAKE: they are not in the field, so
         * none of the pots can pay them. The shared money is deliberately
         * visible to everyone in the group and stays visible.
         */
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          You aren&rsquo;t in this tournament&rsquo;s field, so you have no stake in its pots. The
          group&rsquo;s shared costs are below.
        </p>
      ) : !view.anyFinal ? (
        /**
         * "NOT YET" AND "NOT AT ALL" ARE DIFFERENT ANSWERS, and this said the
         * first to both.
         *
         * `anyFinal` is false in three unrelated states: a tournament with no
         * pot in it at all, a round still out, and every round finished with
         * nothing having changed hands. The sentence explained a WAIT, so on
         * the first and third it described a settlement that was never coming
         * — a club on shared costs, or a day of team rounds where a per-player
         * pot is refused outright, was told to keep waiting for holes that
         * were already in.
         *
         * Read off the seeded club on 2026-09-20: three complete team rounds,
         * every hole in, the organizer's own Prizes screen correctly saying
         * "No pots on this round — Foursomes is played with one ball per side",
         * and the player's money screen still saying pots "are worked out once
         * every hole is in".
         *
         * Told apart by the same test the rest of this card uses — a round is
         * outstanding when it is not final — so the two cannot drift.
         */
        <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          {!view.anyGame ? (
            <>
              No side games on this tournament, so there is nothing to divide. Skins, pots and contests are set
              up per round, and none has been.
            </>
          ) : outstanding || view.rounds.length === 0 ? (
            <>
              Nothing settled yet. A round&rsquo;s pots are worked out once every hole is in — a skins pot can
              carry to the last green, so a running total would only be a different number that looked like the
              answer.
            </>
          ) : (
            <>
              Every round is in, and no pot changed hands.
              {sharedBall.length > 0 &&
                " Rounds played with one ball per side have no individual scores, so no pot can run on them."}
            </>
          )}
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
            {/* NOT "over the whole tournament" WHILE PART OF IT IS UNSETTLED.

                The figure is right and the phrase was not. `roundMoneyFor`
                counts only rounds whose pots are final — deliberately; see
                `money-layout.ts` — so on a tournament with a round still out
                this total excludes real, decided money. Read off the demo on
                2026-09-12: the header said "You're down over the whole
                tournament −$10.00" while the ledger four inches below said
                "Side bets −$15.00", the difference being a closest-to-the-pin
                already won on a round that has not finished.

                Nothing about the arithmetic changes here. Two figures on one
                screen claiming to answer the same question is the whole
                defect, and the top one was the one making a claim it could not
                keep. The same condition the "Still being played" line below
                already uses, so the header and that sentence cannot disagree
                about whether anything is outstanding. */}
            <span style={{ fontSize: 13 }}>
              {view.yourTotalCents > 0
                ? `You're up${scope}`
                : view.yourTotalCents < 0
                  ? `You're down${scope}`
                  : `You're square${scope}`}
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
                  <Icon name={isOpen ? "ph ph-caret-up" : "ph ph-caret-down"} />
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
          {outstanding && (
            <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0", lineHeight: 1.6 }}>
              Still being played:{" "}
              {stillPlaying
                /**
                 * MEASURED IN WHATEVER THIS ROUND IS ACTUALLY PLAYED IN.
                 *
                 * This always said holes, and a match-play round scored as
                 * win-and-loss returns no cards — so a Round Robin with 47 of
                 * its 48 matches over was described to its field as "0/18
                 * holes in". Zero was the right number for the wrong
                 * instrument, and it reads as "nobody has teed off".
                 */
                .map((r) =>
                  r.matchesTotal > 0
                    ? `${r.label} (${r.matchesOver}/${r.matchesTotal} matches done)`
                    : `${r.label} (${r.holesReturned}/${r.holeCount} holes in)`,
                )
                .join(", ")}
              . Their pots are added here once they finish.
            </p>
          )}
        </>
      )}
    </section>
  );
}
