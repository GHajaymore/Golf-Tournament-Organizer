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
import { NO_SHEET } from "../../__tests__/field-doors";

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

type Stage =
  | "draft"
  | "registration"
  | "ready"
  | "live"
  | "liveWithResult"
  | "completed"
  | "unlocked"
  | "unlockedWithResult"
  | "fieldCorrection"
  | "flightsCorrection";
const STAGES: Stage[] = ["draft", "registration", "ready", "live", "liveWithResult", "completed", "unlocked", "unlockedWithResult", "fieldCorrection", "flightsCorrection"];

/** A committee correction open on one scope, after Round 1's first card — the day the way out is needed. */
const correctionOn = (scope: "field" | "flights") => ({ scope, by: "A. Organizer", reason: "A walk-in after the first card", until: "2026-11-30T05:00:00.000Z" });

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
    case "fieldCorrection":
      return { ...withResult(launched(f)), correction: correctionOn("field") };
    case "flightsCorrection":
      return { ...withResult(launched(f)), correction: correctionOn("flights") };
  }
}

/** The families whose draw is the field — no late entry once launched. */
const DRAW_IS_THE_FIELD: Family[] = ["match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup"];
/** The families whose flights are prize divisions a late entrant may be placed in. */
const PRIZE_DIVISIONS: Family[] = ["stroke", "stableford"];
/** The knockouts: their draw is made at the first result (the bracket re-seeds until it). */
const KNOCKOUTS: Family[] = ["knockout", "flightedKnockout"];
/** The stages with a result in Round 1 — for a knockout, a knockout result: its draw made. */
const WITH_RESULT: Stage[] = ["liveWithResult", "completed", "unlockedWithResult", "fieldCorrection", "flightsCorrection"];

/** The desk's answer, worked by hand — see the header. True = allowed. */
function expected(family: Family, stage: Stage, change: FieldChange): boolean {
  if (stage === "completed") return false;
  /**
   * A KNOCKOUT'S DRAW IS MADE AT ITS FIRST RESULT (panel Q3, J12): a bracket
   * has fixed places, so nobody enters after it — launched or not, and no
   * correction gives a made bracket a new place. The way out is a reserve.
   */
  const entering = change === "add" || change === "add-to-flight" || change === "approve";
  if (KNOCKOUTS.includes(family) && WITH_RESULT.includes(stage) && entering) return false;
  if (stage === "draft" || stage === "registration" || stage === "ready" || stage === "unlocked" || stage === "unlockedWithResult") {
    return true;
  }
  /**
   * THE CORRECTION OPENS WHAT ITS REFUSAL NAMED (panel review of 5b, must-fix
   * 1), worked from the desk's side: the field's correction is for the walk-in,
   * the approval, the wrong name and the list — and, in a prize-division
   * competition, for putting the walk-in in a division (part of the late
   * entry). The flights' is for placing where flights make the pairings, and
   * for moving somebody placed. Each opens its own and nothing of the other's.
   */
  if (stage === "fieldCorrection") {
    if (change === "move-flight") return false;
    if (change === "place-in-flight") return PRIZE_DIVISIONS.includes(family);
    return true;
  }
  if (stage === "flightsCorrection") {
    if (change === "move-flight") return true;
    if (change === "place-in-flight") return !PRIZE_DIVISIONS.includes(family);
    // The rest is the day-of table with a card in, below.
  }
  const begun = stage === "liveWithResult" || stage === "flightsCorrection";
  switch (change) {
    case "withdraw":
    case "reinstate":
    case "place-in-group": // an undrawn player written into a tee-sheet group with room moves nobody (PR B)
    case "reserve": // onto the waiting list: nobody enters the field (J12)
      return true;
    case "add":
    case "approve":
      // A round robin's late entrant needs a flight (panel Q3): a bare add or an approval has none to give.
      if (family === "roundRobinFlights") return false;
      if (DRAW_IS_THE_FIELD.includes(family)) return false;
      if (family === "league" || family === "casual") return true;
      return !begun;
    case "add-to-flight":
      // A round robin's late entry IS one with a flight; the window is its only question.
      if (family === "roundRobinFlights") return !begun;
      // In a prize division: an entry and a placement, both. Elsewhere flights are not joined once launched.
      return PRIZE_DIVISIONS.includes(family) && expected(family, stage, "add") && expected(family, stage, "place-in-flight");
    case "place-in-flight":
      // A round robin's unplaced player is put in one as a late entrant is (J04), in the same window.
      return (PRIZE_DIVISIONS.includes(family) || family === "roundRobinFlights") && !begun;
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
        const facts = fieldFactsOf(at(family, stage), NO_SHEET);
        const got = Object.fromEntries(FIELD_CHANGES.map((c) => [c, fieldChangeAllowed(facts, c).ok]));
        const want = Object.fromEntries(FIELD_CHANGES.map((c) => [c, expected(family, stage, c)]));
        expect(got).toEqual(want);
      });
    }
  }

  it("covers all nine families and all eleven changes", () => {
    expect(FAMILIES).toHaveLength(9);
    expect([...FIELD_CHANGES].sort()).toEqual(["add", "add-to-flight", "approve", "bulk", "edit", "move-flight", "place-in-flight", "place-in-group", "reinstate", "reserve", "withdraw"]);
  });

  it("the facts name the family the machine names, not a second reading of it", () => {
    for (const family of FAMILIES) expect(fieldFactsOf(at(family, "live"), NO_SHEET).family).toBe(family);
  });
});

describe("every refusal says why and where to put it right", () => {
  it("a non-empty sentence and a way out with a screen, for every refused cell", () => {
    let refused = 0;
    for (const family of FAMILIES) {
      for (const stage of STAGES) {
        for (const change of FIELD_CHANGES) {
          const v = fieldChangeAllowed(fieldFactsOf(at(family, stage), NO_SHEET), change);
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
        expect(fieldChangeAllowed(fieldFactsOf(at(family, stage), NO_SHEET), "withdraw").ok, `${family} ${stage}`).toBe(true);
        expect(fieldChangeAllowed(fieldFactsOf(at(family, stage), NO_SHEET), "reinstate").ok, `${family} ${stage}`).toBe(true);
      }
      expect(fieldChangeAllowed(fieldFactsOf(at(family, "completed"), NO_SHEET), "withdraw").ok).toBe(false);
    }
  });
});

describe("the words", () => {
  const says = (family: Family, stage: Stage, change: FieldChange) => {
    const v = fieldChangeAllowed(fieldFactsOf(at(family, stage), NO_SHEET), change);
    return v.ok ? "" : v.says;
  };

  it("a late entry after the first card names the round, and who can unlock", () => {
    expect(says("stroke", "liveWithResult", "add")).toBe(
      "The first card of Round 1 is in, so late entries are closed. To add someone anyway, an Organizer can make a committee correction to the field on the dashboard.",
    );
  });

  it("a late entry into a drawn field says the draw is made — a knockout's with the reserve, a round robin's asks for a flight (J12)", () => {
    expect(says("match", "live", "add")).toBe(
      "The draw is made, so the field is fixed. To change it, an Organizer can make a committee correction to the field on the dashboard.",
    );
    for (const family of ["knockout", "flightedKnockout"] as Family[]) {
      // Launched, no result yet: the reserve, and the correction that would open the field.
      expect(says(family, "live", "add")).toBe(
        "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. An Organizer can open the field with a committee correction.",
      );
      // A result in: the reserve, and how to draw again — never a correction (no correction makes a place).
      expect(says(family, "liveWithResult", "add")).toBe(
        "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. To draw it again, clear its results on the Bracket.",
      );
    }
    expect(says("roundRobinFlights", "live", "add")).toBe(
      "In a round robin, a late entrant needs a flight. Without one they have no matches. Choose their flight in the Add form.",
    );
    expect(says("roundRobinFlights", "live", "approve")).toBe(
      "In a round robin, a late entrant needs a flight. Approving cannot give one. Add them with a flight in the Add form instead.",
    );
    expect(says("teamCup", "live", "add")).toBe(
      "The sides are picked, so the field is fixed. To change it, an Organizer can make a committee correction to the field on the dashboard.",
    );
  });

  it("details and bulk say what stays open instead", () => {
    expect(says("stroke", "live", "edit")).toBe(
      "A player’s details are locked once the tournament is launched. To correct one, an Organizer can make a committee correction to the field on the dashboard.",
    );
    expect(says("stroke", "live", "bulk")).toBe(
      "Importing a list or removing several players at once is locked once the tournament is launched. Withdraw players one at a time, or ask an Organizer to make a committee correction to the field on the dashboard.",
    );
  });

  it("every refusal that offers the correction names the PART to open — the field or the flights (panel review of 5b)", () => {
    let seen = 0;
    for (const family of FAMILIES) {
      for (const stage of STAGES) {
        for (const confirmed of [false, true]) {
          const facts = { ...fieldFactsOf(at(family, stage), NO_SHEET), flightsConfirmed: confirmed };
          for (const change of FIELD_CHANGES) {
            const v = fieldChangeAllowed(facts, change);
            if (v.ok || !/committee correction/.test(v.says)) continue;
            seen += 1;
            // The part the sentence names is the part a correction must be opened on to go through.
            const part = /to the field|open the field/.test(v.says) ? "field" : /to the flights/.test(v.says) ? "flights" : null;
            expect(part, `${family} ${stage} ${change}: ${v.says}`).not.toBeNull();
            // (A completed tournament's refusals say Reopen, never the correction, so none reaches here.)
            const opened = { ...facts, correction: correctionOn(part as "field" | "flights") };
            expect(fieldChangeAllowed(opened, change).ok, `${family} ${stage} ${change}: the correction the sentence names opens nothing`).toBe(true);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it("completed sends you to reopen it, and says who can", () => {
    const v = fieldChangeAllowed(fieldFactsOf(at("stroke", "completed"), NO_SHEET), "withdraw");
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
          const facts = { ...fieldFactsOf(at(family, stage), NO_SHEET), flightsConfirmed: confirmed };
          for (const change of FIELD_CHANGES) {
            const v = fieldChangeAllowed(facts, change);
            // The way out was Unlock; since PR 5b it is the committee correction, the Organizer's just the same.
            if (v.ok || !/unlock|committee correction/i.test(v.says + v.wayOut.says)) continue;
            seen += 1;
            expect(v.says, `${family} ${stage} ${change}`).toMatch(/\ban Organizer\b/i);
            expect(v.says, `${family} ${stage} ${change}: a bare "unlock the tournament."`).not.toMatch(/(^|[.,] )unlock the tournament\./i);
          }
        }
      }
    }
    expect(seen, "CONTROL: the sweep met refusals whose way out is the Organizer's correction").toBeGreaterThan(50);
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
  const withDraw = (family: Family, stage: Stage) => ({ ...fieldFactsOf(at(family, stage), NO_SHEET), flightsConfirmed: true });

  for (const family of ["stroke", "stableford"] as Family[]) {
    it(`${family}: placement open before and after launch, shut by the first card; a move refused`, () => {
      expect(fieldChangeAllowed(withDraw(family, "draft"), "place-in-flight").ok).toBe(true);
      expect(fieldChangeAllowed(withDraw(family, "live"), "place-in-flight").ok).toBe(true);
      const begun = fieldChangeAllowed(withDraw(family, "liveWithResult"), "place-in-flight");
      expect(begun.ok ? "" : begun.says).toBe(
        "The first card of Round 1 is in, so the flights are fixed. To place a player, an Organizer can make a committee correction to the field on the dashboard.",
      );
      const move = fieldChangeAllowed(withDraw(family, "live"), "move-flight");
      expect(move.ok ? "" : move.says).toBe(
        "The draw is confirmed, so the flights are fixed. To change them, an Organizer can make a committee correction to the flights on the dashboard.",
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

  it("a correction to the flights opens the move the confirmed-draw refusal sent them to make; one to the field does not", () => {
    expect(fieldChangeAllowed(withDraw("stroke", "flightsCorrection"), "move-flight").ok).toBe(true);
    expect(fieldChangeAllowed(withDraw("stroke", "fieldCorrection"), "move-flight").ok).toBe(false);
    // Where flights make the pairings, the placement the draw held is the flights' too.
    expect(fieldChangeAllowed(withDraw("roundRobinFlights", "flightsCorrection"), "place-in-flight").ok).toBe(true);
    // A confirmed draw before launch has no correction (nothing is locked): Reopen the draw, as always.
    expect(fieldChangeAllowed({ ...withDraw("stroke", "draft"), correction: correctionOn("flights") }, "move-flight").ok).toBe(false);
  });
});

/**
 * THE TD'S WORST CASE (panel review of 5b, must-fix 1): locked out on the day,
 * told "an Organizer can make a committee correction", and the correction
 * opened nothing. Every refusal here names a part; a correction open on that
 * part goes through, and on the other part changes nothing.
 */
describe("a committee correction opens exactly the changes whose refusal named it", () => {
  const walkIn = (family: Family, scope: "field" | "flights" | null, clock = NO_SHEET) => {
    const f = fieldFactsOf(at(family, "liveWithResult"), clock);
    return scope ? { ...f, correction: correctionOn(scope) } : f;
  };

  it("a walk-in after the first card: refused, then taken through a correction to the field — and placed in a division", () => {
    expect(fieldChangeAllowed(walkIn("stroke", null), "add").ok).toBe(false);
    expect(fieldChangeAllowed(walkIn("stroke", "field"), "add").ok).toBe(true);
    expect(fieldChangeAllowed(walkIn("stroke", "field"), "approve").ok).toBe(true);
    expect(fieldChangeAllowed(walkIn("stroke", "field"), "place-in-flight").ok).toBe(true);
    expect(fieldChangeAllowed(walkIn("stableford", "field"), "place-in-flight").ok).toBe(true);
    // The flights' correction is not the field's.
    expect(fieldChangeAllowed(walkIn("stroke", "flights"), "add").ok).toBe(false);
  });

  it("a walk-in after the last tee time, the same", () => {
    const passed = { lastTee: { round: "Round 1", day: NO_SHEET.now.day, time: "10:40 AM" }, now: { day: NO_SHEET.now.day, minutes: 11 * 60 } };
    const shut = fieldChangeAllowed(walkIn("stroke", null, passed), "add");
    expect(shut.ok ? "" : shut.says).toBe("Late entries are closed. Round 1’s last tee time (10:40 AM) has passed. An Organizer can open the field with a committee correction.");
    expect(fieldChangeAllowed(walkIn("stroke", "field", passed), "add").ok).toBe(true);
  });

  it("a player's details and a list: the field's; a drawn field's late entry too, since its refusal named the field", () => {
    for (const family of FAMILIES) {
      if (family === "casual" || family === "league") continue; // open by nature
      expect(fieldChangeAllowed(walkIn(family, "field"), "edit").ok, family).toBe(true);
      expect(fieldChangeAllowed(walkIn(family, "field"), "bulk").ok, family).toBe(true);
      // A knockout with a result is the exception, below: its refusal names the reserve, not the field.
      if (family !== "knockout" && family !== "flightedKnockout") expect(fieldChangeAllowed(walkIn(family, "field"), "add").ok, family).toBe(true);
      expect(fieldChangeAllowed(walkIn(family, "flights"), "edit").ok, family).toBe(false);
    }
  });

  it("a knockout with a result: no correction makes a place in a made bracket — the reserve is the way out (J12, panel Q3)", () => {
    for (const family of ["knockout", "flightedKnockout"] as Family[]) {
      for (const change of ["add", "add-to-flight", "approve"] as FieldChange[]) {
        const v = fieldChangeAllowed(walkIn(family, "field"), change);
        expect(v.ok, `${family} ${change}`).toBe(false);
        if (!v.ok) expect(v.wayOut).toEqual({ says: "Add them as a reserve on Entries", href: "/registration" });
      }
      expect(fieldChangeAllowed(walkIn(family, "field"), "reserve").ok).toBe(true);
      expect(fieldChangeAllowed(walkIn(family, null), "reserve").ok).toBe(true);
    }
  });

  it("moving a placed player: the flights' — and placing where flights make the pairings", () => {
    expect(fieldChangeAllowed(walkIn("stroke", "flights"), "move-flight").ok).toBe(true);
    expect(fieldChangeAllowed(walkIn("stroke", "field"), "move-flight").ok).toBe(false);
    expect(fieldChangeAllowed(walkIn("roundRobinFlights", "flights"), "place-in-flight").ok).toBe(true);
    expect(fieldChangeAllowed(walkIn("roundRobinFlights", "field"), "place-in-flight").ok).toBe(false);
  });

  it("a correction never opens a completed tournament's field (Reopen is the remedy), and before launch there is nothing to open", () => {
    expect(fieldChangeAllowed({ ...fieldFactsOf(at("stroke", "completed"), NO_SHEET), correction: correctionOn("field") }, "add").ok).toBe(false);
    expect(fieldChangeAllowed({ ...fieldFactsOf(at("stroke", "draft"), NO_SHEET), correction: correctionOn("field") }, "add").ok).toBe(true);
  });

  it("the Entries banner says what the field's correction opened, and drops the close time", () => {
    const sheet = { lastTee: { round: "Round 1", day: NO_SHEET.now.day, time: "10:40 AM" }, now: NO_SHEET.now };
    expect(fieldBanner(walkIn("stroke", "field", sheet))).toEqual([
      "The field is open for a correction: late entries, players’ details and imports go through.",
      "The format and rounds stay locked.",
    ]);
    // A correction on the flights changes nothing the field's banner says.
    expect(fieldBanner(walkIn("stroke", "flights", sheet))).toEqual(fieldBanner(walkIn("stroke", null, sheet)));
    // The facts carry the scope and nothing else of the correction.
    expect(fieldFactsOf(at("stroke", "fieldCorrection"), NO_SHEET).correction).toEqual({ scope: "field" });
    expect(fieldFactsOf(at("stroke", "live"), NO_SHEET).correction).toBeNull();
  });
});

describe("the screen's doors and banner come from the same rule", () => {
  it("fieldDoors is the verdict per change, as a sentence or null", () => {
    for (const family of FAMILIES) {
      for (const stage of STAGES) {
        const facts = fieldFactsOf(at(family, stage), NO_SHEET);
        const doors = fieldDoors(facts);
        for (const c of FIELD_CHANGES) {
          const v = fieldChangeAllowed(facts, c);
          expect(doors[c]).toBe(v.ok ? null : v.says);
        }
      }
    }
  });

  it("the banner is two short lines while under way, and never promises an add the rule refuses", () => {
    expect(fieldBanner(fieldFactsOf(at("stroke", "draft"), NO_SHEET))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "unlocked"), NO_SHEET))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "completed"), NO_SHEET))).toBeNull();
    expect(fieldBanner(fieldFactsOf(at("stroke", "live"), NO_SHEET))).toEqual([
      "You can withdraw a player, put one back or add a late entry.",
      "The format, rounds and players’ details stay locked.",
    ]);
    const knockout = fieldBanner(fieldFactsOf(at("knockout", "live"), NO_SHEET)) ?? [];
    // A knockout: the reserve is what is open, and the first sentence of its refusal says why (J12).
    expect(knockout).toEqual(["You can withdraw a player, put one back or add a reserve.", "The draw is made, so nobody can join the knockout."]);
    expect(knockout.join(" ")).not.toMatch(/late entry/);
    // A round robin: a late entry with a flight.
    expect((fieldBanner(fieldFactsOf(at("roundRobinFlights", "live"), NO_SHEET)) ?? [])[0]).toBe(
      "You can withdraw a player, put one back or add a late entry with a flight.",
    );
    const begun = fieldBanner(fieldFactsOf(at("stroke", "liveWithResult"), NO_SHEET)) ?? [];
    expect(begun[1]).toContain("The first card of Round 1 is in");
    // Short: no line of the banner runs past twenty words.
    for (const lines of [fieldBanner(fieldFactsOf(at("stroke", "live"), NO_SHEET)) ?? []]) {
      for (const l of lines) expect(l.split(/\s+/).length, l).toBeLessThanOrEqual(20);
    }
  });
});

/**
 * THE LATE-ENTRY CUTOFF (the panel's request, PR B), worked from the desk:
 *
 *   A walk-in may be taken while they can still play every round — that is,
 *   while a group of Round 1 is still to go off. The Committee sets the
 *   starting times (Rule 5.3a) and publishes them on the tee sheet, so the
 *   last of them is the cutoff, on Round 1's day, by the club's own clock. At
 *   10:40 sharp the last group is on the tee and the door is shut; at 10:39 it
 *   is open, though the 8:00 group's cards are already coming in.
 *
 *   No published sheet: there is no time anybody was given, so PR A's rule
 *   stands — the first card closes it.
 *
 * Worked by hand, here, never read off the function: the club's clock is told
 * as a day and minutes past midnight, and the expected answer is written per
 * cell from the times above.
 */
describe("late entries close at Round 1's last published tee time, by the club's clock", () => {
  const SHEET = { round: "Round 1", day: "2026-11-29", time: "10:40 AM" };
  const LAST = 10 * 60 + 40;
  type When = { label: string; day: string; minutes: number; open: boolean };
  const WHEN: When[] = [
    { label: "the day before", day: "2026-11-28", minutes: 23 * 60 + 59, open: true },
    { label: "first light on the day", day: "2026-11-29", minutes: 6 * 60, open: true },
    { label: "a minute before the last tee time", day: "2026-11-29", minutes: LAST - 1, open: true },
    { label: "the last tee time itself", day: "2026-11-29", minutes: LAST, open: false },
    { label: "the afternoon", day: "2026-11-29", minutes: 15 * 60, open: false },
    { label: "the day after", day: "2026-11-30", minutes: 7 * 60, open: false },
  ];
  const facts = (family: Family, stage: Stage, w: When, lastTee: typeof SHEET | null = SHEET) =>
    fieldFactsOf(at(family, stage), { lastTee, now: { day: w.day, minutes: w.minutes } });

  for (const family of ["stroke", "stableford"] as Family[]) {
    for (const stage of ["live", "liveWithResult"] as Stage[]) {
      for (const w of WHEN) {
        it(`${family} · ${stage} · ${w.label}: ${w.open ? "open" : "closed"}`, () => {
          const f = facts(family, stage, w);
          // The first card does not shut it while a published group is still to go off.
          expect(fieldChangeAllowed(f, "add").ok).toBe(w.open);
          expect(fieldChangeAllowed(f, "approve").ok).toBe(w.open);
          // A walk-in taken in the window can be placed in a flight in the same window.
          expect(fieldChangeAllowed(f, "place-in-flight").ok).toBe(w.open);
          // Neither withdrawing nor writing someone into a group ever waits on the clock.
          expect(fieldChangeAllowed(f, "withdraw").ok).toBe(true);
          expect(fieldChangeAllowed(f, "place-in-group").ok).toBe(true);
        });
      }
    }
  }

  it("the refusal names the round and the time, and who can unlock", () => {
    const v = fieldChangeAllowed(facts("stroke", "liveWithResult", WHEN[3]), "add");
    expect(v.ok ? "" : v.says).toBe(
      "Late entries are closed. Round 1’s last tee time (10:40 AM) has passed. An Organizer can open the field with a committee correction.",
    );
    const p = fieldChangeAllowed(facts("stroke", "live", WHEN[5]), "place-in-flight");
    expect(p.ok ? "" : p.says).toBe(
      "Flights are fixed. Round 1’s last tee time (10:40 AM) has passed. An Organizer can open the field with a committee correction.",
    );
  });

  it("no published sheet: the first card closes it, whatever the clock says (PR A)", () => {
    const morning = WHEN[1];
    expect(fieldChangeAllowed(facts("stroke", "live", morning, null), "add").ok).toBe(true);
    expect(fieldChangeAllowed(facts("stroke", "liveWithResult", morning, null), "add").ok).toBe(false);
    // Without a sheet the clock alone closes nothing: no card, still open in the afternoon.
    expect(fieldChangeAllowed(facts("stroke", "live", WHEN[4], null), "add").ok).toBe(true);
  });

  it("a result in a LATER round shuts it whatever Round 1's sheet says (no score for a round already played)", () => {
    const f = { ...facts("stroke", "live", WHEN[1]), playedRound: "Round 2" };
    const v = fieldChangeAllowed(f, "add");
    expect(v.ok ? "" : v.says).toMatch(/^The first card of Round 2 is in, so late entries are closed\./);
  });

  it("a league or a casual round is not held to a tee time; a drawn field stays shut before it", () => {
    for (const family of ["league", "casual"] as Family[]) {
      expect(fieldChangeAllowed(facts(family, "liveWithResult", WHEN[5]), "add").ok, family).toBe(true);
    }
    for (const family of DRAW_IS_THE_FIELD) {
      expect(fieldChangeAllowed(facts(family, "live", WHEN[0]), "add").ok, family).toBe(false);
    }
  });

  it("draft and unlocked never ask the clock (the behaviour before the rule)", () => {
    for (const stage of ["draft", "unlocked", "unlockedWithResult"] as Stage[]) {
      expect(fieldChangeAllowed(facts("stroke", stage, WHEN[5]), "add").ok, stage).toBe(true);
    }
  });

  it("the banner says when late entries close, and drops it once they have", () => {
    expect(fieldBanner(facts("stroke", "liveWithResult", WHEN[1]))).toEqual([
      "You can withdraw a player, put one back or add a late entry.",
      "Late entries close at Round 1’s last tee time, 10:40 AM.",
      "The format, rounds and players’ details stay locked.",
    ]);
    const after = fieldBanner(facts("stroke", "liveWithResult", WHEN[4])) ?? [];
    expect(after[0]).toBe("You can withdraw a player or put one back.");
    expect(after[1]).toMatch(/^Late entries are closed\. Round 1’s last tee time \(10:40 AM\) has passed\./);
    expect(after.join(" ")).not.toMatch(/Late entries close at/);
  });

  it("place-in-group is refused only once the tournament is completed", () => {
    for (const family of FAMILIES) {
      for (const stage of STAGES) {
        const v = fieldChangeAllowed(facts(family, stage, WHEN[5]), "place-in-group");
        expect(v.ok, `${family} ${stage}`).toBe(stage !== "completed");
      }
    }
  });
});
