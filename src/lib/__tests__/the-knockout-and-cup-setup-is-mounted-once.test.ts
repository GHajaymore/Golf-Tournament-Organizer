import { describe, it, expect } from "vitest";
import { cupLineupPlace, knockoutSetupOf, knockoutSetupPlace, drawSections } from "@/lib/domain/draw-sections";
import { roundDrawHref } from "@/lib/domain/round-draw-door";
import { STAGE_TYPES } from "@/lib/stage-types";
import type { Family } from "@/lib/domain/tournament-status";
import type { ScreenKey } from "@/lib/domain/console-merges";
import { readSource } from "./source";

/**
 * THE KNOCKOUT'S AND THE CUP'S SET-UP IS ON EXACTLY ONE SCREEN (R9c; CLAUDE.md, the old screen obeys the same boolean).
 *
 * Four controls left the Bracket, Rounds & formats and the Team cup for the draw section of Tee times & draw:
 *   - the play-off for third place (Rounds & formats hid it the moment the draw's door moved: `drawMoved`),
 *   - the play-by dates and the flights of a knockout in flights (the Bracket page),
 *   - a cup session's lineup (the Team cup page).
 * One boolean per control decides where it is drawn (`knockoutSetupPlace`, `cupLineupPlace`, each asking `drawSections(...).built`), and
 * this counts the mounts across every family, every round type and both states of the switch. A press with no home strands the event;
 * a press in two homes writes twice.
 *
 * The Rounds side is `roundDrawHref`, the one answer the Rounds screen asks (`drawMoved`); the Bracket and Team cup sides are
 * their pages' own `setupMoved` / `lineupMoved`, which no unit test can render (server pages that read the database), so the
 * source checks below hold each mount to the same place function.
 */

const FAMILIES: Family[] = ["stroke", "stableford", "match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup", "league", "casual"];
const MODES = ["single", "split", "plate", "flights"];

describe("the play-off for third place is on exactly one of Rounds & formats and Tee times & draw", () => {
  it("every family x round type x switch state: one home for a bracket round, none for any other", () => {
    let checked = 0;
    for (const family of FAMILIES) {
      for (const type of STAGE_TYPES) {
        // EVERY state of the two keys: the old Rounds screen is drawn when `rounds` is not shown, and `teeTimes` can be shown on its own.
        for (const [roundsShown, teeTimesShown] of [[false, false], [true, false], [false, true], [true, true]]) {
          const round = { type, format: "Match Play", hasSavedSheet: false };
          const shown = new Set<ScreenKey>([...(roundsShown ? ["rounds" as const] : []), ...(teeTimesShown ? ["teeTimes" as const] : [])]);
          // EITHER Rounds screen draws the play-off for third only while the draw's door has not moved: the new one by `!drawMoved`, the old one because the page fills no view for a moved round.
          const onRounds = type === "Bracket Stage" && roundDrawHref({ id: "r1", type, format: round.format }, family, "admin", shown) === "/stages";
          const onTeeTimes = knockoutSetupOf(round, "single", true).thirdPlace && knockoutSetupPlace(round, family, teeTimesShown) === "teeTimes";
          const where = `${family} / ${type} / Rounds ${roundsShown ? "shown" : "off"} / Tee times ${teeTimesShown ? "shown" : "off"}`;
          expect(Number(onRounds) + Number(onTeeTimes), where).toBe(type === "Bracket Stage" ? 1 : 0);
          checked += 1;
        }
      }
    }
    expect(checked, "the sweep found nothing to check").toBeGreaterThan(50);
  });

  it("Rounds hides it exactly while the draw's door has moved, and Tee times mounts it from the same place function", () => {
    const rounds = readSource("src", "components", "rounds", "RoundsScreen.tsx");
    expect(rounds).toMatch(/!drawMoved && roundThirdPlaceShown\(ctx\)/);
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(page).toMatch(/knockoutSetupPlace\(roundForPlace, family, true\) === "teeTimes"/);
    expect(page).toMatch(/setup\.thirdPlace && \(/);
    // The OLD Rounds screen asks the same door: no view, and no DrawRound, for a moved round.
    const stages = readSource("src", "app", "(app)", "stages", "page.tsx");
    expect(stages).toMatch(/drawMoved\[s\.id\] = !!told && roundDrawHref\(s, told\.status\.family, session\.viewRole, shown\) !== "\/stages"/);
    expect(stages).toMatch(/isKnockoutRound\(x\.type\) && !drawMoved\[x\.id\]/);
    expect(stages).toMatch(/drawMoved=\{drawMoved\}/);
    expect(readSource("src", "components", "StagesClient.tsx")).toMatch(/!ctx\.drawMoved && \(/);
  });
});

describe("the play-by dates and the flights are on exactly one of the Bracket and Tee times & draw", () => {
  it("for staff, in every family and bracket mode: the Bracket draws them exactly when Tee times does not", () => {
    for (const family of FAMILIES) {
      for (const mode of MODES) {
        for (const teeTimesShown of [false, true]) {
          const round = { type: "Bracket Stage", format: "Match Play", hasSavedSheet: false };
          const moved = knockoutSetupPlace(round, family, teeTimesShown) === "teeTimes";
          const setup = knockoutSetupOf(round, mode, true);
          const where = `${family} / ${mode} / Tee times ${teeTimesShown ? "shown" : "off"}`;
          expect(Number(!moved) + Number(moved && setup.playBy), `${where}: play-by`).toBe(1);
          if (mode === "flights") expect(Number(!moved) + Number(moved && setup.flights), `${where}: flights`).toBe(1);
          else expect(setup.flights, where).toBe(false);
        }
      }
    }
  });

  it("the Bracket page mounts each behind the same `setupMoved` and says where they went", () => {
    const page = readSource("src", "app", "(app)", "bracket", "page.tsx");
    expect(page).toMatch(/knockoutSetupPlace\(\{ type: koStage\.type, format: koStage\.format, hasSavedSheet: false \}, told\.status\.family, shown\.has\("teeTimes"\)\) === "teeTimes"/);
    expect(page).toMatch(/\{!setupMoved && <KnockoutPlayByForm /);
    expect(page).toMatch(/mode === "flights" && !setupMoved && <BracketFlights /);
    expect(page).toMatch(/data-knockout-setup-moved/);
  });

  it("a PLAYER keeps the Bracket's read-only flights: only staff move", () => {
    const page = readSource("src", "app", "(app)", "bracket", "page.tsx");
    expect(page).toMatch(/const setupMoved =\s*isStaff &&/);
  });
});

describe("a cup session's lineup is on exactly one of the Team cup and Tee times & draw", () => {
  it("every family x round type x switch state: Tee times holds it for a session of a built family, the cup page otherwise, never both", () => {
    for (const family of FAMILIES) {
      for (const type of STAGE_TYPES) {
        for (const teeTimesShown of [false, true]) {
          const round = { type, format: "Match Play", hasSavedSheet: false };
          const onTeeTimes = knockoutSetupOf(round, "single", false).lineup && cupLineupPlace(round, family, teeTimesShown) === "teeTimes";
          const onCupPage = cupLineupPlace(round, family, teeTimesShown) === "cup";
          // The cup page draws the lineups of every session at once, so it is asked of a Team Session; any other round has no lineup at all.
          if (type === "Team Session") expect(Number(onTeeTimes) + Number(onCupPage), `${family} / ${teeTimesShown}`).toBe(1);
          else expect(onTeeTimes, `${family} / ${type}`).toBe(false);
        }
      }
    }
  });

  it("the cup page and Tee times mount CupLineup behind the same place function", () => {
    const cup = readSource("src", "app", "(app)", "cup", "page.tsx");
    expect(cup).toMatch(/cupLineupPlace\(\{ type: "Team Session", format: "", hasSavedSheet: false \}, told\.status\.family, shown\.has\("teeTimes"\)\) === "teeTimes"/);
    expect(cup).toMatch(/lineupMoved \? \(/);
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(page).toMatch(/setup\.lineup && cupLineupPlace\(roundForPlace, family, true\) === "teeTimes"/);
  });

  it("casual is the one family neither built screen draws, so every control stays on its old screen", () => {
    expect(drawSections({ type: "Bracket Stage", format: "Match Play", hasSavedSheet: false }, "casual").built).toBe(false);
    expect(knockoutSetupPlace({ type: "Bracket Stage", format: "Match Play", hasSavedSheet: false }, "casual", true)).toBe("bracket");
  });
});
