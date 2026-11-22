"use client";
import { roundNumber as roundNumberOf } from "@/lib/domain/round-label";
import { entryModeFor, isManualFormat } from "@/lib/formats";
import { isIndividualStrokeRound, isKnockoutRound } from "@/lib/stage-types";
import { PointsControl, TableTiebreakControl, pointsInWords } from "@/components/ScoringClient";
import { matchTieInWords, tableTieInWords } from "@/lib/domain/tie-words";
import { individualTieBreak } from "@/lib/domain/week-basis";
import { TieRow, SettingsGroup, MatchTiebreakControl, countbackInWords } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundTies({ ctx }: { ctx: RoundCtx }) {
  const { stage, allStages, scoring, tiebreakers, matchTiebreakers, chainsRounds, locked, basis, format, holes, pending, roundRaisesTies } = ctx;
  return (
    <>
{/* TIES, FIRST UNDER CUSTOMIZE (2026-10-16). Ajay could not find the
                tiebreakers — on a phone, a tablet or a computer: they were at the
                foot of Customize inside ~2,000px of points and checkbox chains, and
                a knockout or a medal said nothing at all. One line per tie question,
                the rule in use in words, Change where there is a choice (the review
                panel: docs/tiebreak-brief-2026-10-16.md) — and, Ajay: "as part of
                the customize", so first in it, named on its closed bar. */}
            {roundRaisesTies && (
              <SettingsGroup
                title={stage.type === "Round Robin" ? "Ties and points" : "Ties"}
                blurb={stage.type === "Round Robin" ? "Ties and points are the same for every round robin in this tournament." : undefined}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {(isKnockoutRound(stage.type) || stage.type === "Single Match Stage") && (
                    <TieRow
                      question={`All square after ${holes}`}
                      rule={basis === "gross" ? "extra holes from the 1st, hole by hole" : "extra holes from the 1st, hole by hole, strokes given as in the round"}
                    />
                  )}
                  {stage.type === "Round Robin" && format === "Match Play" && (
                    <TieRow question={`A match all square after ${holes}`} rule={matchTieInWords(matchTiebreakers, holes)}>
                      <MatchTiebreakControl selected={matchTiebreakers} holes={holes} locked={pending || locked} />
                    </TieRow>
                  )}
                  {stage.type === "Round Robin" && (
                    <TieRow question="Level in the table" rule={tableTieInWords(tiebreakers, format === "Match Play" || entryModeFor(format) === "team" ? "" : individualTieBreak(basis, format))}>
                      <TableTiebreakControl tiebreakers={tiebreakers} locked={locked} />
                    </TieRow>
                  )}
                  {/* Points are scoring, not a tie rule; they share this group because they too
                      are set once for every round robin (2026-10-16). */}
                  {stage.type === "Round Robin" && (
                    <TieRow question="Points for a match" rule={pointsInWords(scoring)}>
                      <PointsControl initial={scoring} locked={locked} />
                    </TieRow>
                  )}
                  {stage.type === "Stroke Play Round" && !isManualFormat(format) && (isIndividualStrokeRound(stage) || entryModeFor(format) === "team") && (
                    <TieRow
                      question={`${entryModeFor(format) === "team" ? "Sides level" : "Level"} on ${chainsRounds && roundNumberOf(allStages, stage.id) > 1 ? "the total" : "the round"}`}
                      rule={`countback on ${chainsRounds && roundNumberOf(allStages, stage.id) > 1 ? "the last round's" : "the"} card — ${countbackInWords(holes)}; anybody still level shares the place`}
                    />
                  )}
                </div>
              </SettingsGroup>
            )}
    </>
  );
}
