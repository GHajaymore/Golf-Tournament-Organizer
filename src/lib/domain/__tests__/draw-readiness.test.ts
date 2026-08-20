import { describe, it, expect } from "vitest";
import { drawReadiness, sideDrawReadiness } from "../draw-readiness";

/**
 * The refusal at the point of consequence.
 *
 * `orgSetupState` is a checklist and gates nothing, on the basis that
 * organizers do not work in order. The honest other half is that a control
 * which genuinely cannot work says so where it is, and links to the fix — not
 * a dead button and not a tooltip.
 */
describe("whether pairings can be drawn", () => {
  it("lets a normal field through", () => {
    expect(drawReadiness({ fieldSize: 16, locked: false })).toBeNull();
  });

  it("draws for a field of one rather than inventing a rule about it", () => {
    // Field sizes start at ONE in this codebase — see the combination sweep in
    // CLAUDE.md. A one-player tournament is a real thing to set up, and the
    // flight code already handles it; refusing here would be a second opinion
    // about a question `formGroups` already answers.
    expect(drawReadiness({ fieldSize: 1, locked: false })).toBeNull();
  });

  it("explains an empty field instead of a dead button", () => {
    // What this replaces: `disabled={pending || players.length === 0}` and not
    // a word about why.
    const block = drawReadiness({ fieldSize: 0, locked: false });
    expect(block).not.toBeNull();
    expect(block!.problem).toMatch(/empty field/i);
    expect(block!.problem.length).toBeGreaterThan(20);
  });

  it("sends an empty field to the FIELD, not to the club roster", () => {
    // The roster is who belongs to the club; the field is who is playing this
    // tournament, and a draw is made from the field. The roster is one screen
    // short of the thing to do.
    expect(drawReadiness({ fieldSize: 0, locked: false })!.href).toBe("/registration");
  });

  it("explains a locked tournament, and says scores are safe", () => {
    // This was a `title` tooltip: invisible on a touch device, unannounced,
    // and unable to hold a link.
    const block = drawReadiness({ fieldSize: 16, locked: true });
    expect(block).not.toBeNull();
    expect(block!.problem).toMatch(/lock/i);
    expect(block!.problem).toMatch(/scores/i);
  });

  it("names the lock first when the tournament is also empty", () => {
    // One reason at a time, the most fundamental first. Somebody told to add
    // players to a locked tournament does so and gets refused again for a new
    // reason.
    expect(drawReadiness({ fieldSize: 0, locked: true })!.problem).toMatch(/lock/i);
  });

  it("always offers somewhere to go", () => {
    // A refusal with no way out is a dead end with extra words.
    for (const input of [
      { fieldSize: 0, locked: false },
      { fieldSize: 0, locked: true },
      { fieldSize: 8, locked: true },
    ]) {
      const block = drawReadiness(input)!;
      expect(block.href.startsWith("/"), JSON.stringify(input)).toBe(true);
      expect(block.linkLabel.length, JSON.stringify(input)).toBeGreaterThan(0);
    }
  });

  it("treats a negative count as empty rather than as ready", () => {
    // Nothing should produce one, but failing the other way would draw
    // pairings from a field that does not exist.
    expect(drawReadiness({ fieldSize: -1, locked: false })).not.toBeNull();
  });
});

/**
 * The same refusal for team matches, where both ways out are on the screen
 * already — so it names the controls rather than pointing anywhere.
 *
 * Replaces `title={teams.length < 2 ? "Draw at least two sides first" :
 * undefined}`, flagged in the 2026-08-18 record as the last surviving instance
 * of the tooltip-only refusal.
 */
describe("whether team matches can be drawn", () => {
  it("lets two or more sides through", () => {
    expect(sideDrawReadiness({ sideCount: 2 })).toBeNull();
    expect(sideDrawReadiness({ sideCount: 9 })).toBeNull();
  });

  it("refuses one side, and says a match needs two", () => {
    const r = sideDrawReadiness({ sideCount: 1 });
    expect(r?.problem).toContain("only one so far");
    expect(r?.problem).toContain("two sides");
  });

  it("refuses none differently — there is nothing to add another TO", () => {
    // "there is only one so far" is false with zero sides, and an organizer
    // reading it goes looking for the side they have not made.
    const r = sideDrawReadiness({ sideCount: 0 });
    expect(r?.problem).toContain("No sides yet");
    expect(r?.problem).not.toContain("only one");
  });

  it("names the other control by the words on it, not by where it sits", () => {
    // A position is a claim about layout that nothing checks and a
    // re-arrangement makes false — the "deadline above" defect. Both refusals
    // quote the button instead.
    for (const count of [0, 1]) {
      const problem = sideDrawReadiness({ sideCount: count })?.problem ?? "";
      expect(problem).toContain("Draw sides automatically");
      expect(problem).not.toMatch(/\babove\b|\bbelow\b|next to/);
    }
  });

  it("treats a negative count as none rather than as ready", () => {
    expect(sideDrawReadiness({ sideCount: -1 })).not.toBeNull();
  });
});
