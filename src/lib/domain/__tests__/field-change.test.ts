import { describe, it, expect } from "vitest";
import {
  FIELD_CHANGES,
  fieldBanner,
  fieldChangeAllowed,
  fieldDoors,
  fieldFactsOf,
  type FieldChange,
} from "../field-change";
import type { Family, TournamentFacts } from "../tournament-status";
import { FAMILIES, FAMILY_FIXTURES, launched } from "./tournament-facts-fixtures";

/**
 * WHO MAY CHANGE THE FIELD AFTER LAUNCH — the one rule (day-of field changes,
 * design of 6 Nov, PR A).
 *
 * Every family × every stage × every change has a verdict, and the verdict is
 * worked HERE from what the desk does on the morning, never copied from the
 * function:
 *
 *   - a withdrawal is written on the sheet at any time before the results are
 *     final; the group goes out short at its time (Rule 5.3a). It reopens
 *     nothing, and the cards returned stay on the record (Rule 3.3b(2));
 *     once the competition is final nothing changes (Rule 20.2e);
 *   - a late entry is possible in a stroke-play competition only until play has
 *     begun — a new name has no score for a round already under way;
 *   - in match play, a round robin, a knockout or a cup the draw IS the field:
 *     once it is made, nobody is added;
 *   - a league's field changes week to week by nature, so it takes entries
 *     between weeks;
 *   - a placed player is not moved between prize divisions once play is under
 *     way, and players' details and bulk imports are not day-of acts.
 *
 * Draft and unlocked are exactly today's behaviour: everything open (the
 * regression table copied from the present guard, `configurationLocked`).
 */

type Stage = "draft" | "registration" | "ready" | "live" | "liveWithResult" | "completed" | "unlocked" | "unlockedWithResult";
const STAGES: Stage[] = ["draft", "registration", "ready", "live", "liveWithResult", "completed", "unlocked", "unlockedWithResult"];

function at(family: Family, stage: Stage): TournamentFacts {
  const f = FAMILY_FIXTURES[family]();
  const withResult = (x: TournamentFacts): TournamentFacts => ({
    ...x,
    rounds: x.rounds.map((r, i) => (i === 0 ? { ...r, hasResult: true } : r)),
  });
  switch (stage) {
    case "draft":
    case "registration":
    case "ready":
      return { ...f, status: stage, configUnlocked: false };
    case "live":
      return launched(f);
    case "liveWithResult":
      return withResult(launched(f));
    case "completed":
      return { ...withResult(f), status: "completed", configUnlocked: false };
    case "unlocked":
      return { ...f, status: "live", configUnlocked: true };
    case "unlockedWithResult":
      return withResult({ ...f, status: "live", configUnlocked: true });
  }
}

/** The families whose draw is the field — no late entry once launched. */
const DRAW_IS_THE_FIELD: Family[] = ["match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup"];
/** The families whose flights are prize divisions a late entrant may be placed in. */
const PRIZE_DIVISIONS: Family[] = ["stroke", "stableford"];

/** The desk's answer, worked by hand — see the header. True = allowed. */
function expected(family: Family, stage: Stage, change: FieldChange): boolean {
  if (stage === "completed") return false;
  if (stage === "draft" || stage === "registration" || stage === "ready" || stage === "unlocked" || stage === "unlockedWithResult") {
    return true;
  }
  const begun = stage === "liveWithResult";
  switch (change) {
    case "withdraw":
    case "reinstate":
      return true;
    case "add":
    case "approve":
      if (DRAW_IS_THE_FIELD.includes(family)) return false;
      if (family === "league" || family === "casual") return true;
      return !begun;
    case "place-in-flight":
      return PRIZE_DIVISIONS.includes(family) && !begun;
    case "edit":
    case "bulk":
    case "move-flight":
      return false;
  }
}

describe("fieldChangeAllowed: every family × stage × change", () => {
  for (const family of FAMILIES) {
    for (const stage of STAGES) {
      it(`${family} · ${stage}`, () => {
        const facts = fieldFactsOf(at(family, stage));
        const got = Object.fromEntries(FIELD_CHANGES.map((c) => [c, fieldChangeAllowed(facts, c).ok]));
        const want = Object.fromEntries(FIELD_CHANGES.map((c) => [c, expected(family, stage, c)]));
        expect(got).toEqual(want);
      });
    }
  }

  it("covers all nine families and all eight changes", () => {
    expect(FAMILIES).toHaveLength(9);
    expect([...FIELD_CHANGES].sort()).toEqual(["add", "approve", "bulk", "edit", "move-flight", "place-in-flight", "reinstate", "withdraw"]);
  });

  it("the facts name the family the machine names, not a second reading of it", () => {
    for (const family of FAMILIES) expect(fieldFactsOf(at(family, "live")).family).toBe(family);
  });
});

describe("every refusal says why and where to put it right", () => {
  it("a non-empty sentence and a way out with a screen, for every refused cell", () => {
    let refused = 0;
    for (const family of FAMILIES) {
      for (const stage of STAGES) {
        for (const change of FIELD_CHANGES) {
          const v = fieldChangeAllowed(fieldFactsOf(at(family, stage)), change);
          if (v.ok) continue;
          refused += 1;
          expect(v.says.trim().length, `${family} ${stage} ${change}`).toBeGreaterThan(10);
          expect(v.wayOut.says.trim().length).toBeGreaterThan(3);
          expect(v.wayOut.href).toMatch(/^\//);
          // Never a bet, never money moving (CLAUDE.md, Money).
          expect(v.says).not.toMatch(/\bbet\b|\bpay\b/i);
        }
      }
    }
    // The control: the sweep saw refusals (a sweep that finds nothing proves nothing).
    expect(refused).toBeGreaterThan(50);
  });

  it("withdraw is open in all nine families while live, with or without a result, and refused only when completed", () => {
    for (const family of FAMILIES) {
      for (const stage of ["live", "liveWithResult", "draft", "unlocked"] as Stage[]) {
        expect(fieldChangeAllowed(fieldFactsOf(at(family, stage)), "withdraw").ok, `${family} ${stage}`).toBe(true);
        expect(fieldChangeAllowed(fieldFactsOf(at(family, stage)), "reinstate").ok, `${family} ${stage}`).toBe(true);
      }
      expect(fieldChangeAllowed(fieldFactsOf(at(family, "completed")), "withdraw").ok).toBe(false);
    }
  });
});

describe("the words", () => {
  const says = (family: Family, stage: Stage, change: FieldChange) => {
    const v = fieldChangeAllowed(fieldFactsOf(at(family, stage)), change);
    return v.ok ? "" : v.says;
  };

  it("a late entry after the first card names the round, and who can unlock", () => {
    expect(says("stroke", "liveWithResult", "add")).toBe(
      "The first card of Round 1 is in, so late entries are closed. To add someone anyway, an Organizer can unlock the tournament on the dashboard.",
    );
  });

  it("a late entry into a drawn field says the draw is made", () => {
    for (const family of ["match", "roundRobinFlights", "knockout", "flightedKnockout"] as Family[]) {
      expect(says(family, "live", "add")).toBe(
        "The draw is made, so the field is fixed. To change it, an Organizer can unlock the tournament on the dashboard.",
      );
    }
    expect(says("teamCup", "live", "add")).toBe(
      "The sides are picked, so the field is fixed. To change it, an Organizer can unlock the tournament on the dashboard.",
    );
  });

  it("details and bulk say what stays open instead", () => {
    expect(says("stroke", "live", "edit")).toBe(
      "A player’s details are locked once the tournament is launched. To correct one, an Organizer can unlock the tournament on the dashboard.",
    );
    expect(says("stroke", "live", "bulk")).toBe(
      "Importing a list or removing several players at once is locked once the tournament is launched. Withdraw players one at a time, or ask an Organizer to unlock the tournament on the dashboard.",
    );
  });

  it("completed sends you to reopen it, and says who can", () => {
    const v = fieldChangeAllowed(fieldFactsOf(at("stroke", "completed")), "withdraw");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.says).toBe("The tournament is completed, so its field is as it finished. An Organizer can reopen it on the dashboard.");
      expect(v.wayOut).toEqual({ says: "Reopen it on the dashboard", href: "/dashboard" });
    }
  });

  /**
   * AN ASSISTANT CANNOT UNLOCK (`setConfigUnlocked` is admin-only; held against
   * real rows in `a-late-changes-after-launch.audit.test.ts`). The rule's words
   * reach either reader, so every refusal whose way out is Unlock must name WHO
   * can — a bare "unlock the tournament" leaves an Assistant on the morning with
   * a door they hold no key to (panel review of #1028, must-fix 2).
   */
  it("every refusal whose way out is Unlock names an Organizer, for the Assistant who cannot", () => {
    let seen = 0;
    for (const family of FAMILIES) {
      for (const stage of STAGES) {
        for (const confirmed of [false, true]) {
          const facts = { ...fieldFactsOf(at(family, stage)), flightsConfirmed: confirmed };
          for (const change of FIELD_CHANGES) {
            const v = fieldChangeAllowed(facts, change);
            if (v.ok || !/unlock/i.test(v.says + v.wayOut.says)) continue;
            seen += 1;
            expect(v.says, `${family} ${stage} ${change}`).toMatch(/\ban Organizer\b/i);
            expect(v.says, `${family} ${stage} ${change}: a bare "unlock the tournament."`).not.toMatch(/(^|[.,] )unlock the tournament\./i);
          }
        }
      }
    }
    expect(seen, "CONTROL: the sweep met refusals ending in Unlock").toBeGreaterThan(50);
  });
});

/**
 * A CONFIRMED DRAW AND A LATE ENTRANT (panel review of #1028, must-fix 1).
 * Placing an UNPLACED player in a prize division moves nobody, so in stroke
 * play and Stableford the confirmed draw does not hold it (only the first card
 * does). Moving a PLACED player is still the draw's to refuse; and where
 * flights make the pairings (a round robin, a cup) placing somebody changes who
 * plays whom, so the draw still holds the placement too.
 */
describe("a confirmed draw holds moves, not a late entrant's placement in a prize division", () => {
  const withDraw = (family: Family, stage: Stage) => ({ ...fieldFactsOf(at(family, stage)), flightsConfirmed: true });

  for (const family of ["stroke", "stableford"] as Family[]) {
    it(`${family}: placement open before and after launch, shut by the first card; a move refused`, () => {
      expect(fieldChangeAllowed(withDraw(family, "draft"), "place-in-flight").ok).toBe(true);
      expect(fieldChangeAllowed(withDraw(family, "live"), "place-in-flight").ok).toBe(true);
      const begun = fieldChangeAllowed(withDraw(family, "liveWithResult"), "place-in-flight");
      expect(begun.ok ? "" : begun.says).toBe(
        "The first card of Round 1 is in, so the flights are fixed. To place a player, an Organizer can unlock the tournament on the dashboard.",
      );
      const move = fieldChangeAllowed(withDraw(family, "live"), "move-flight");
      expect(move.ok ? "" : move.says).toBe(
        "The draw is confirmed, so the flights are fixed. To change them, an Organizer can unlock the tournament on the dashboard.",
      );
      const draftMove = fieldChangeAllowed(withDraw(family, "draft"), "move-flight");
      expect(draftMove.ok ? "" : draftMove.says).toBe("Draw confirmed. Reopen it to move anyone.");
    });
  }

  it("where flights make the pairings, the confirmed draw still holds a placement", () => {
    for (const family of ["roundRobinFlights", "teamCup"] as Family[]) {
      const d = fieldChangeAllowed(withDraw(family, "draft"), "place-in-flight");
      expect(d.ok ? "" : d.says, family).toBe("Draw confirmed. Reopen it to move anyone.");
    }
  });

  it("unlocked does not open a confirmed draw's moves (the draw's own lock), and withdraw and add never asked it", () => {
    expect(fieldChangeAllowed(withDraw("stroke", "unlocked"), "move-flight").ok).toBe(false);
    expect(fieldChangeAllowed(withDraw("stroke", "unlocked"), "place-in-flight").ok).toBe(true);
    expect(fieldChangeAllowed(withDraw("stroke", "live"), "withdraw").ok).toBe(true);
    expect(fieldChangeAllowed(withDraw("stroke", "live"), "add").ok).toBe(true);
  });
});

describe("the screen's doors and banner come from the same rule", () => {
  it("fieldDoors is the verdict per change, as a sentence or null", () => {
    for (const family of FAMILIES) {
      for (const stage of STAGES) {
        const facts = fieldFactsOf(at(family, stage));
        const doors = fieldDoors(facts);
        for (const c of FIELD_CHANGES) {
          const v = fieldChangeAllowed(facts, c);
          expect(doors[c]).toBe(v.ok ? null : v.says);
        }
      }
    }
  });

  it("the banner is two short lines while under way, and never promises an add the rule refuses", () => {
    expect(fieldBanner(fieldFactsOf(at("stroke", "draft")))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "unlocked")))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "completed")))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "live")))).toEqual([
      "You can withdraw a player, put one back or add a late entry.",
      "The format, rounds and players’ details stay locked.",
    ]);
    const knockout = fieldBanner(fieldFactsOf(at("knockout", "live"))) ?? [];
    expect(knockout[0]).toBe("You can withdraw a player or put one back.");
    expect(knockout[1]).toContain("The draw is made, so the field is fixed.");
    expect(knockout.join(" ")).not.toMatch(/late entry/);
    const begun = fieldBanner(fieldFactsOf(at("stroke", "liveWithResult"))) ?? [];
    expect(begun[1]).toContain("The first card of Round 1 is in");
    // Short: no line of the banner runs past twenty words.
    for (const lines of [fieldBanner(fieldFactsOf(at("stroke", "live"))) ?? []]) {
      for (const l of lines) expect(l.split(/\s+/).length, l).toBeLessThanOrEqual(20);
    }
  });
});
