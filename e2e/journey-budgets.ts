/**
 * THE JOURNEYS' CEILINGS AND TARGETS — the ratchet (work plan row 0b, step 3; Fable's budgets of 14 Nov,
 * `journey-budgets.md`). How to read a breach and what to do: `docs/claude/journeys.md`.
 *
 * CEILING  the measured figure, read off CI's `JOURNEY {…}` lines. Every journey has one. A journey
 *          OVER it fails CI ("this change added to the journey"); a journey UNDER it fails CI too ("lower
 *          the ceiling in the same pull request") — the counts are deterministic, so the ceiling is
 *          exactly the journey, and a step taken out cannot be quietly put back by a later change.
 *          A ceiling is raised only with a named ruling (who, when) written beside it.
 * TARGET   where the panel wants the journey to be, and what gets it there. Never asserted: it is
 *          printed beside the figure so the gap is in every run. A seconds target may be a promise
 *          above the ceiling (J2's ten minutes).
 *
 * Counted per journey (e2e/journey.ts): `screens` distinct paths, `visits` paths stood on in order,
 * `returns` visits minus screens (coming back to a screen already left), `presses`, `boxes` (text boxes
 * typed into, a date picked, a file chosen), `chars` (characters typed — text the journey's own spec
 * owns, one length whatever the project is called), and `seconds` at the panel's pace with the test's
 * own waits off the clock. Seconds have a ceiling only over and never under (they move with the
 * machine), and only where the panel set one.
 */

export type Counted = "screens" | "visits" | "returns" | "presses" | "boxes" | "chars" | "seconds";
export type Limits = Partial<Record<Counted, number>>;
export type JourneyBudget = {
  /** The measured figure. Required: a journey with no ceiling is held to nothing. */
  ceiling: Limits;
  /** Where the panel wants it (Fable, 14 Nov). Printed, never asserted. */
  target: Limits;
  /** What reaches the target. */
  by: string;
};

export const JOURNEY_BUDGETS: Record<string, JourneyBudget> = {
  // J1. Measured on #1140 at 25a0ffa0 and 0a29c5e4, all three projects: 12 presses (the 13th on 74a2d6ed
  // was the spec's: "club" is already chosen on /choose from the sign-up), 5 screens over 6 visits (the
  // return is /choose after /roster), 9 boxes, 211 characters, 81–82 s. Seconds: Fable's 120.
  "secretary-first-event": {
    // Cut B (#1145): the create ends on Entries, so no Home and no "Entries" press: 11 presses, 4 screens,
    // 5 visits (/ → /choose → /roster → /choose → /registration).
    // Cut A (event-first, Ajay 15 Nov): no members step before the first event, so no "Add your members",
    // no "Add member" twice, no "Create your first tournament" back on /choose (the form is open where the
    // code lands), and the member's three boxes (name, address, index: 14 + 45 + 4 characters) are gone:
    // 7 presses, 3 screens over 3 visits (/ → /choose → /registration), 0 returns, 6 boxes, 148 characters.
    // Desk-counted from the spec; CI's JOURNEY line confirms it.
    ceiling: { presses: 7, screens: 3, visits: 3, returns: 0, boxes: 6, chars: 148, seconds: 120 },
    target: { presses: 5, screens: 3, visits: 3, returns: 0, boxes: 5, seconds: 70 },
    by: "cuts D (the code submits itself: no Confirm, no code box) and E (a single round already chosen); A and B are in",
  },
  // J2. Measured on #1140 at 0a29c5e4, desktop: 24 presses, 8 screens over 10 visits, 2 returns
  // (/choose after /roster, /dashboard after /registration), 13 boxes, 216 characters, 130 s against a
  // pace floor of about 120 s. Route: / → /choose → /roster → /choose → /dashboard → /event → /stages →
  // /registration → /dashboard → /foursomes. Seconds: 180, as J1's 120 sits over its 81 (Principal
  // Engineer, 14 Nov); the ten-minute promise is the target, and the spec asserts it on its own.
  // Cut A (event-first, Ajay 15 Nov): the members step goes (4 presses, 3 boxes, 62 characters: 14 + 44 + 4,
  // and /roster with its return to /choose), and the eight members' file is chosen on Entries, where the
  // create lands (cut B), so the later sidebar press back to Entries and its return go too: 19 presses,
  // 7 screens over 7 visits (/ → /choose → /registration → /event → /stages → /dashboard → /foursomes),
  // 0 returns, 10 boxes, 154 characters. Desk-counted from the spec; CI's JOURNEY line confirms it.
  "secretary-playable-event": {
    ceiling: { presses: 19, screens: 7, visits: 7, returns: 0, boxes: 10, chars: 154, seconds: 180 },
    target: { screens: 7, returns: 0, seconds: 600 },
    by: "console step 3 (the draw on one screen per round), row 6b (the day asked once), row 7, P4 (first score entry launches); cut A (no members step) is in; under ten minutes at the panel's pace",
  },
  // J3. Measured on #1140 at 25a0ffa0 and 0a29c5e4, desktop and phone alike: 3 presses (Create the copy,
  // Entries, Open entries), 2 screens, 1 box (the day), 14–16 s. Fable's desk estimate was 4 presses;
  // the measure already beats it, so the target is cut B's: one press fewer.
  "secretary-copy-last-event": {
    ceiling: { presses: 3, screens: 2, visits: 2, returns: 0, boxes: 1, chars: 0 },
    target: { presses: 2, screens: 2, visits: 2, returns: 0, boxes: 1, chars: 0 },
    by: "cut B (open entries where the copy lands: no Entries press)",
  },
  // J4, signed in. Measured on #1140 at 74a2d6ed, 25a0ffa0 and 0a29c5e4, all three projects.
  "player-member": {
    ceiling: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    target: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    by: "nothing: each press is the job (to the card, the score, the board); cut H is for the panel, not counted",
  },
  // J4, signed out on a browser not seen before. Measured on #1140 at 0a29c5e4, all three projects: 5
  // presses, 5 screens (/ → /choose → /me → /me/card → /me/board: the log-in passes through /choose on
  // its way to Today, by itself), 2 boxes. Characters: the spec's own address and password, 43 + 21.
  "player-member-signed-out": {
    ceiling: { presses: 5, screens: 5, visits: 5, returns: 0, boxes: 2, chars: 64 },
    target: { presses: 5, screens: 4, visits: 4, returns: 0, boxes: 2 },
    by: "the signed-in figure plus 2 presses and 2 boxes (address, password); the log-in goes straight to Today, not by /choose; never asked which event when one is on today",
  },
  // J5. Measured on #1140 at 25a0ffa0 and 0a29c5e4, phone: 21 presses (Start my card, 17 pad taps, the 8
  // typed into Other and Enter, Certify, the Board), 3 screens, 1 box and 1 character (the 8), 0
  // choosers, 77 s on one bar. Fable's 24 is already beaten (doubles are on the pad: one press); the
  // target left is the 8 off the pad: 0 characters.
  "player-card-18": {
    ceiling: { presses: 21, screens: 3, visits: 3, returns: 0, boxes: 1, chars: 1 },
    target: { presses: 21, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    by: "every score one tap (an 8 on a par 4 on the pad, or a wider pad): 0 boxes, 0 characters — 0 choosers, 0 waits",
  },
  // J6. Measured on #1140 at 74a2d6ed, 25a0ffa0 and 0a29c5e4, all three projects.
  "player-guest": {
    ceiling: { presses: 4, screens: 4, visits: 4, returns: 0, boxes: 0, chars: 0 },
    target: { presses: 3, screens: 3, visits: 3, returns: 0, boxes: 0, chars: 0 },
    by: "cut G (on a day of play, Open my card opens the card)",
  },
  // J7 (J39/J40 PR 3B). A guest enters themselves by the poster's QR: the sign-up link, Enter as a guest, a name, Ask to
  // play, the waiting screen. The design's figure is "4 presses and about 12 characters" counting the phone's own scan and
  // open; the counter records those as a note (as J6 does for the player link), so the walk is 2 presses, 1 box and the
  // 10 characters of a name, over 2 screens (/register/<token> → /me, the waiting card). DESK-COUNTED from the spec, not
  // yet read off CI's JOURNEY line: the first CI run confirms it, and a mismatch is lowered or raised there, with the
  // figure, in the same pull request. No seconds ceiling until measured.
  "guest-enters-by-poster": {
    ceiling: { presses: 2, screens: 2, visits: 2, returns: 0, boxes: 1, chars: 10 },
    target: { presses: 2, screens: 2, visits: 2, returns: 0, boxes: 1, chars: 10 },
    by: "nothing: each press is the job (Enter as a guest, Ask to play); no email, no handicap and no inviter are required",
  },
};
