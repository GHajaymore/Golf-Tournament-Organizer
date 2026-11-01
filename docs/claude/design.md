# Design

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: themes, colour tokens, contrast, overflow. Index: `CLAUDE.md`.

## Design

- Two grounds, one set of tokens: `DARK_GROUND` and `LIGHT_GROUND` in `src/lib/themes.ts`.
  Components read `--color-*` custom properties and never hard-code a colour.
- The ramp reverses between grounds, so low steps are always foreground and high steps always
  background, whichever ground you are on.
- **The club's one setting drives the console and the public board.** `themeCss` is their
  stylesheet, so a club that picks its look gets it on every organizer screen and on `/live`.
  `auto` resolves dark unless the device asks for light. There was briefly a `playerThemeCss`
  resolving auto light-first; it made one club look like two products.
- **The player app wears the club's theme too — reversed 2026-09-24.** For five days
  (2026-09-19) it wore a fixed hand-hung scoreboard, the same green field at every club; Ajay's
  call since is one club theme, chosen once in settings, on the console, the public board AND the
  player app. `(player)/layout.tsx` renders `themeCss` and says why. This entry described the
  fixed scoreboard as current until 2026-10-10, and the organizer's guide repeated it to clubs —
  found by reading the first sheet of the printed guide, not by any test.
- **Outdoor legibility is a product requirement, not a nicety.** Scores are read on a phone in
  direct sun, and `SUNLIGHT_RATIO` is 7:1 on the dark ground against 4.5 on the light one.
  `sunlightVerdict` grades whatever ground the theme actually renders — so `auto` is graded as
  dark, and a club failing the bar is told that switching to Light is the remedy.
- Grid and flex children need `min-width: 0` to be allowed to shrink; `minmax(0, 1fr)`
  constrains the track, not the item. Anything wide (tables, scorecards) gets its own
  `overflow-x: auto` wrapper, so the page body never scrolls sideways.
