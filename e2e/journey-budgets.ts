/**
 * THE JOURNEYS' CEILINGS AND TARGETS — the ratchet (work plan row 0b, step 3; Fable's budgets of 14 Nov,
 * `journey-budgets.md`).
 *
 * CEILING  today's measured figure, read off CI's `JOURNEY {…}` lines. A journey that grows past it
 *          FAILS CI. A change that cuts a step lowers the ceiling in the same pull request; nothing
 *          ever raises one.
 * TARGET   where the panel wants the journey to be, and what gets it there. Never asserted: it is
 *          printed beside the figure so the gap is in every run.
 *
 * `null` as a ceiling: the journey has no CI figure yet. Its first CI run prints the figures and they
 * are written here. Until then the spec prints "not set yet" and asserts nothing.
 *
 * Counted per journey (e2e/journey.ts): `screens` distinct paths, `visits` paths stood on in order,
 * `returns` visits minus screens (coming back to a screen already left), `presses`, `boxes` (text boxes
 * typed into, a date picked, a file chosen), `chars` (characters typed, the same in every project:
 * fixture text has one length whatever the project is called), and `seconds` at the panel's pace.
 * Seconds have a ceiling only where Fable set one: they move with the machine, the counts do not.
 */

export type Counted = "screens" | "visits" | "returns" | "presses" | "boxes" | "chars" | "seconds";
export type Limits = Partial<Record<Counted, number>>;
export type JourneyBudget = {
  /** Today's measured figure. `null` until CI has printed one. */
  ceiling: Limits | null;
  /** Where the panel wants it (Fable, 14 Nov). Printed, never asserted. */
  target: Limits;
  /** What reaches the target. */
  by: string;
};

export const JOURNEY_BUDGETS: Record<string, JourneyBudget> = {
  // J1. Measured on #1140 at 74a2d6ed, all three projects: 13 presses, 5 screens over 6 visits (the
  // return is /choose after /roster), 9 boxes, 211 characters once the fixture's text has one length.
  // 13 presses includes "club" on /choose; the spec now presses it only when the screen has not already
  // chosen it, so CI may print 12 — then the ceiling is 12.
  "secretary-first-event": {
    ceiling: { presses: 13, screens: 5, visits: 6, returns: 1, boxes: 9, chars: 211, seconds: 120 },
    target: { presses: 7, screens: 4, visits: 5, returns: 1, boxes: 9, seconds: 70 },
    by: "cuts A′ (roster opens ready and hands back), B (open entries where create ended), C (the kind asked once), D (the code submits itself), E (a single round already chosen)",
  },
  // J2. TODO(row 0b): set from this PR's first CI run.
  "secretary-playable-event": {
    ceiling: null,
    target: { screens: 8, returns: 0, seconds: 600 },
    by: "console step 3 (the draw on one screen per round), row 6b (the day asked once), row 7, P4 (first score entry launches); under ten minutes at the panel's pace",
  },
  // J3. TODO(row 0b): set from this PR's first CI run.
  "secretary-copy-last-event": {
    ceiling: null,
    target: { presses: 4, screens: 2, boxes: 1 },
    by: "cut B (open entries where the copy lands)",
  },
  // J4, signed in. Measured on #1140 at 74a2d6ed, all three projects.
  "player-member": {
    ceiling: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    target: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    by: "nothing: each press is the job (to the card, the score, the board); cut H is for the panel, not counted",
  },
  // J4, signed out on a browser not seen before. TODO(row 0b): set from this PR's first CI run.
  "player-member-signed-out": {
    ceiling: null,
    target: { presses: 5, screens: 4, returns: 0, boxes: 2 },
    by: "the signed-in figure plus 2 presses and 2 boxes (address, password); never asked which event when one is on today",
  },
  // J5. TODO(row 0b): set from this PR's first CI run.
  "player-card-18": {
    ceiling: null,
    target: { presses: 24, chars: 0 },
    by: "1 press a hole for birdie, par and bogey; 2 for anything else; 2 to sign — 0 choosers, 0 waits",
  },
  // J6. Measured on #1140 at 74a2d6ed, all three projects.
  "player-guest": {
    ceiling: { presses: 4, screens: 4, visits: 4, returns: 0, boxes: 0, chars: 0 },
    target: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    by: "cut G (on a day of play, Open my card opens the card)",
  },
};
