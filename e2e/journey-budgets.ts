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
  // J1. Measured on #1140 at 25a0ffa0, all three projects: 12 presses (the 13th on 74a2d6ed was the
  // spec's: "club" is already chosen on /choose from the sign-up), 5 screens over 6 visits (the return
  // is /choose after /roster), 9 boxes, 211 characters, 81–82 s. Seconds: Fable's 120.
  "secretary-first-event": {
    ceiling: { presses: 12, screens: 5, visits: 6, returns: 1, boxes: 9, chars: 211, seconds: 120 },
    target: { presses: 7, screens: 4, visits: 5, returns: 1, boxes: 9, seconds: 70 },
    by: "cuts A′ (roster opens ready and hands back), B (open entries where create ended), C (the kind asked once), D (the code submits itself), E (a single round already chosen)",
  },
  // J2. Measured on #1140 at 0a29c5e4, desktop: 24 presses, 8 screens over 10 visits, 2 returns
  // (/choose after /roster, /dashboard after /registration), 13 boxes, 216 characters, 130 s. Route:
  // / → /choose → /roster → /choose → /dashboard → /event → /stages → /registration → /dashboard → /foursomes.
  // Seconds: the ten-minute promise.
  "secretary-playable-event": {
    ceiling: { presses: 24, screens: 8, visits: 10, returns: 2, boxes: 13, chars: 216, seconds: 600 },
    target: { screens: 8, returns: 0, seconds: 600 },
    by: "console step 3 (the draw on one screen per round), row 6b (the day asked once), row 7, P4 (first score entry launches); under ten minutes at the panel's pace",
  },
  // J3. Measured on #1140 at 25a0ffa0, desktop and phone alike: 3 presses (Create the copy, Entries,
  // Open entries), 2 screens, 1 box (the day), 14–16 s. Fable's desk estimate was 4 presses; the
  // measure already beats it, so the target is cut B's: one press fewer.
  "secretary-copy-last-event": {
    ceiling: { presses: 3, screens: 2, visits: 2, returns: 0, boxes: 1, chars: 0 },
    target: { presses: 2, screens: 2, visits: 2, returns: 0, boxes: 1, chars: 0 },
    by: "cut B (open entries where the copy lands: no Entries press)",
  },
  // J4, signed in. Measured on #1140 at 74a2d6ed, all three projects.
  "player-member": {
    ceiling: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    target: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    by: "nothing: each press is the job (to the card, the score, the board); cut H is for the panel, not counted",
  },
  // J4, signed out on a browser not seen before. Measured on #1140 at 25a0ffa0, all three projects:
  // 6 presses, 5 screens (/ → /choose → /me → /me/card → /me/board: the log-in passes through /choose
  // on its way to Today), 2 boxes, 63 characters. One of the 6 was the spec's — it pressed the Today tab
  // while /choose was still moving on by itself — and is no longer pressed, so CI should print 5 and
  // JOURNEY-UNDER; then the ceiling is 5.
  "player-member-signed-out": {
    ceiling: { presses: 6, screens: 5, visits: 5, returns: 0, boxes: 2, chars: 63 },
    target: { presses: 5, screens: 4, visits: 4, returns: 0, boxes: 2 },
    by: "the signed-in figure plus 2 presses and 2 boxes (address, password); never asked which event when one is on today",
  },
  // J5. Measured on #1140 at 25a0ffa0, phone: 21 presses (Start my card, 17 pad taps, the 8 typed into
  // Other and Enter, Certify, the Board), 3 screens, 1 box and 1 character (the 8), 0 choosers, 77 s on
  // one bar. Fable's 24 is already beaten (doubles are on the pad: one press); the target left is the 8
  // off the pad: 0 characters.
  "player-card-18": {
    ceiling: { presses: 21, screens: 3, visits: 3, returns: 0, boxes: 1, chars: 1 },
    target: { presses: 21, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    by: "every score one tap (an 8 on a par 4 on the pad, or a wider pad): 0 boxes, 0 characters — 0 choosers, 0 waits",
  },
  // J6. Measured on #1140 at 74a2d6ed, all three projects.
  "player-guest": {
    ceiling: { presses: 4, screens: 4, visits: 4, returns: 0, boxes: 0, chars: 0 },
    target: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    by: "cut G (on a day of play, Open my card opens the card)",
  },
};
