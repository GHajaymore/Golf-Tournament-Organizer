import { describe, it, expect } from "vitest";
import { drawControlsOf, drawSections } from "@/lib/domain/draw-sections";
import { relocate } from "@/lib/domain/console-merges";
import { STAGE_TYPES } from "@/lib/stage-types";
import type { Family } from "@/lib/domain/tournament-status";
import { readSource } from "./source";

/**
 * "DRAW ROUND n's MATCHES" IS ON ONE SCREEN (R9b; the old screen obeys the same boolean).
 *
 * `DrawRound` is mounted by Rounds & formats (the button, or a link once the draw lives on Tee times) and by the draw
 * section of Tee times & draw. `drawControlsOf(...).nextRound` is the one answer to "does this round have it", and
 * `relocate` is the one answer to "is the draw's door moved to Tee times". For every built family, round type, first or
 * later round and each step of the tournament, exactly one of {Rounds' button, Rounds' link} is drawn, and the link is
 * drawn exactly when Tee times mounts the button.
 *
 * ON #1221 MERGE: R4d's `roundDrawHref` also asks `drawSections(...).built`, which is how a family NOT built stays on
 * Rounds (a knockout is R9c's). Replace the `relocate` call below by `roundDrawHref` and drop the `built` filter, so the
 * unbuilt families are held too. Until then the unbuilt ones are left out, because Rounds links them to a sheet with no
 * draw: that is the gap #1221 closes.
 */

const FAMILIES: Family[] = ["stroke", "stableford", "match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup", "league", "casual"];
const STEPS = [
  { name: "setting up", launched: false, completed: false },
  { name: "live", launched: true, completed: false },
  { name: "completed", launched: true, completed: true },
];
const SHOWN = new Set(["rounds", "teeTimes"] as const);

describe("the draw of the next round is on exactly one screen", () => {
  it("for every built family x round type x first or later x step: one of Rounds' button or link, and the link exactly when Tee times mounts it", () => {
    let checked = 0;
    for (const family of FAMILIES) {
      for (const type of STAGE_TYPES) {
        const round = { type, format: type === "Stroke Play Round" ? "Stroke Play" : "Match Play" };
        if (!drawSections({ ...round, hasSavedSheet: false }, family).built) continue;
        for (const isFirst of [true, false]) {
          for (const step of STEPS) {
            const has = drawControlsOf(round, { isFirst, launched: step.launched, completed: step.completed }).nextRound;
            const moved = relocate({ href: "/stages", job: "draw", roundId: "r2", role: "admin" }, SHOWN) !== "/stages";
            const roundsButton = has && !moved;
            const roundsLink = has && moved;
            const teeTimes = has && drawSections({ ...round, hasSavedSheet: false }, family).built;
            const where = `${family} / ${type} / ${isFirst ? "first" : "later"} / ${step.name}`;
            expect([roundsButton, roundsLink].filter(Boolean).length, where).toBe(has ? 1 : 0);
            expect(teeTimes, where).toBe(roundsLink);
            checked += 1;
          }
        }
      }
    }
    expect(checked, "the sweep found nothing to check").toBeGreaterThan(50);
  });

  it("a round never has it before the tournament is live, on the first round, once it is over, or when seeded from qualifiers", () => {
    const rr = { type: "Round Robin", format: "Match Play" };
    expect(drawControlsOf(rr, { isFirst: false, launched: true, completed: false }).nextRound).toBe(true);
    expect(drawControlsOf(rr, { isFirst: true, launched: true, completed: false }).nextRound).toBe(false);
    expect(drawControlsOf(rr, { isFirst: false, launched: false, completed: false }).nextRound).toBe(false);
    expect(drawControlsOf(rr, { isFirst: false, launched: true, completed: true }).nextRound).toBe(false);
  });

  it("Tee times reads 'first round' as Rounds does: of all the stages, not of the playing rounds", () => {
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(page).toMatch(/isFirst: state\.stages\[0\]\?\.id === stage\.id/);
  });
});
