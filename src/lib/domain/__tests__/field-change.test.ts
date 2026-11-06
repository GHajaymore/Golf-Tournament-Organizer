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

  it("a late entry after play has begun names the round that began", () => {
    expect(says("stroke", "liveWithResult", "add")).toBe(
      "Round 1 has begun, so a new entry would have no score for it. To add someone anyway, unlock the tournament.",
    );
  });

  it("a late entry into a drawn field says the draw is made", () => {
    for (const family of ["match", "roundRobinFlights", "knockout", "flightedKnockout"] as Family[]) {
      expect(says(family, "live", "add")).toBe("The draw is made, so the field is fixed. To change it, unlock the tournament.");
    }
    expect(says("teamCup", "live", "add")).toBe("The sides are picked, so the field is fixed. To change it, unlock the tournament.");
  });

  it("details and bulk say what stays open instead", () => {
    expect(says("stroke", "live", "edit")).toBe(
      "A player’s details are locked once the tournament is launched. To correct one, unlock the tournament.",
    );
    expect(says("stroke", "live", "bulk")).toBe(
      "Importing a list or removing several players at once is locked once the tournament is launched. Withdraw players one at a time, or unlock the tournament.",
    );
  });

  it("completed sends you to reopen it", () => {
    const v = fieldChangeAllowed(fieldFactsOf(at("stroke", "completed")), "withdraw");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.wayOut).toEqual({ says: "Reopen it on the dashboard", href: "/dashboard" });
  });

  it("a confirmed draw keeps its own words before launch, and the unlock words after", () => {
    const draft = { ...fieldFactsOf(at("stroke", "draft")), flightsConfirmed: true };
    const live = { ...fieldFactsOf(at("stroke", "live")), flightsConfirmed: true };
    const d = fieldChangeAllowed(draft, "move-flight");
    expect(d.ok ? "" : d.says).toBe("Draw confirmed. Reopen it to move anyone.");
    const p = fieldChangeAllowed(live, "place-in-flight");
    expect(p.ok ? "" : p.says).toBe("The draw is confirmed, so the flights are fixed. To change them, unlock the tournament.");
    // Unlocked does not open a confirmed draw: that is the draw's own lock (`movePlayerToGroup`).
    const u = { ...fieldFactsOf(at("stroke", "unlocked")), flightsConfirmed: true };
    expect(fieldChangeAllowed(u, "move-flight").ok).toBe(false);
    // Withdrawing and adding never asked the draw.
    expect(fieldChangeAllowed(live, "withdraw").ok).toBe(true);
    expect(fieldChangeAllowed(live, "add").ok).toBe(true);
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

  it("the banner shows only while under way, and never promises an add the rule refuses", () => {
    expect(fieldBanner(fieldFactsOf(at("stroke", "draft")))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "unlocked")))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "completed")))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "live")))).toBe(
      "The tournament is under way. You can withdraw a player, put one back or add a late entry; the waiting list moves up by itself. The format, rounds and players’ details stay locked.",
    );
    const knockout = fieldBanner(fieldFactsOf(at("knockout", "live"))) ?? "";
    expect(knockout).toMatch(/^The tournament is under way\. You can withdraw a player or put one back\./);
    expect(knockout).toContain("The draw is made, so the field is fixed.");
    expect(knockout).not.toMatch(/late entry/);
    const begun = fieldBanner(fieldFactsOf(at("stroke", "liveWithResult"))) ?? "";
    expect(begun).toContain("Round 1 has begun");
  });
});
