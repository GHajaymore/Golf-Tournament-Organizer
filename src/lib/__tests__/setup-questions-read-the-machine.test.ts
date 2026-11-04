import { describe, it, expect } from "vitest";
import { defaultAnswers, draftFromAnswers, reconcile, type SetupAnswers, type SetupDraft } from "@/lib/domain/setup-questions";
import { tournamentStatus, tournamentFamily, setupFlowOf, type TournamentFacts } from "@/lib/domain/tournament-status";
import { isStablefordRound } from "@/lib/domain/week-basis";
import { isPlayingRound, generatesPairings } from "@/lib/stage-types";
import { tracksPerRound } from "@/lib/domain/attendance";
import { facts, round } from "@/lib/domain/__tests__/tournament-facts-fixtures";

/**
 * THE QUESTIONNAIRE'S DRAFTS, READ BY THE STATE MACHINE (PR 3, brief item 10).
 *
 * #995's "Set up with a few questions" makes a draft tournament: rounds, days,
 * settings, and no flights ("left for you, on purpose: … flights (divided once
 * the field is in)"). Under D1 a medal or a Stableford with no flights is a
 * complete setup, so a questionnaire medal must NEVER say "No flights yet" —
 * and its rail must hold on nothing a draft cannot have yet (the field) but
 * the field. Built here the way `createTournament` stores the draft: its
 * rounds with their days, its dates, its attendance, nobody entered and no
 * flights; then a field of eight, as an organizer adds one.
 */

const TODAY = "2026-11-04";
const base = (patch: Partial<SetupAnswers>): SetupAnswers =>
  reconcile({ ...defaultAnswers("us", TODAY), name: "zz-questions", ...patch }, "us");

/** The facts of a fresh draft as `createTournament` writes it, with `confirmed` entered. */
function factsOf(d: SetupDraft, confirmed: number): TournamentFacts {
  return facts({
    shape: d.shape,
    league: tracksPerRound(d.settings.attendanceMode),
    dated: !!d.startOn,
    startOn: d.startOn,
    endOn: d.endOn,
    confirmed,
    groups: 0,
    moneyAnswered: false,
    rounds: d.rounds.map((r, i) =>
      round({
        id: `r${i}`,
        position: i,
        type: r.type,
        format: r.format,
        playing: isPlayingRound(r.type),
        stableford: isStablefordRound(r.scoringBasis, r.format),
        scheduled: !!r.playedOn,
        drawsPairings: generatesPairings(r.type),
        teeSheetSaved: r.type === "Stroke Play Round" ? false : null,
      }),
    ),
  });
}

describe("the questionnaire's drafts, under the state machine", () => {
  for (const [what, answers, family] of [
    ["a one-day medal", base({ running: "day", sides: "own", scoring: "stroke" }), "stroke"],
    ["a one-day Stableford", base({ running: "day", sides: "own", scoring: "stableford" }), "stableford"],
    ["a two-day medal", base({ running: "days", sides: "own", scoring: "stroke", count: 2 }), "stroke"],
    ["a weekly league", base({ running: "league", sides: "own", scoring: "stroke", count: 10 }), "league"],
  ] as const) {
    it(`${what}: a ${family}, never "No flights yet", and only the field holds it`, () => {
      const d = draftFromAnswers(answers);
      const empty = factsOf(d, 0);
      expect(tournamentFamily(empty)).toBe(family);
      const flow = setupFlowOf(empty)!;
      expect(flow.steps.map((s) => s.missing)).not.toContain("No flights yet.");
      // A fresh draft has nobody in it: the field is the one thing it is waiting for.
      expect(flow.current?.key).toBe("registration");
      // The field in: nothing holds — flights are optional (D1), and so is the money answer.
      const ready = tournamentStatus(factsOf(d, 8));
      expect(ready.setup.current).toBeNull();
      expect(ready.refusals.launch).toBeNull();
      expect(ready.setup.steps.find((s) => s.key === "grouping")).toMatchObject({ optional: true, missing: "Optional — one field." });
      expect(ready.journey).toBe("launch");
    });
  }

  it("a two-day medal from the questions is NOT a league — the count of rounds never made one", () => {
    const d = draftFromAnswers(base({ running: "days", sides: "own", scoring: "stroke", count: 2 }));
    expect(d.rounds).toHaveLength(2);
    expect(tournamentFamily(factsOf(d, 8))).toBe("stroke");
  });
});
