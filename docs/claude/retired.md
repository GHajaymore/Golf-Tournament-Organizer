# Retired paragraphs

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: history only. Index: `CLAUDE.md`.

> Retired (Superseded by the 2026-10-23 testing panel (#937): `qa:changed` no longer maps core to three rounds (core is ONE round plus the nightly; only money/handicap arithmetic keeps three), and the covered-figure bullet is restated in CLAUDE.md as a command to re-measure. The habits themselves live on in CLAUDE.md.)

- **`npm run qa:changed` first, on every finished change.** It reads the files touched and says
  how much testing that needs: nothing ships (tests), its own tests (words, the front door),
  one full round (function in one area), or three (core). Quote it in the pull request.
- **A change is not done until the tests know about it.** A new action needs a spec that DOES
  it as the person who would; a new format needs a scenario; a new language needs a line in the
  date table. `docs/testing.md` has the table of what to add for what, and
  `qa-framework.test.ts` holds the framework's own lists to the files on disk.
- **"Is everything covered?" is answered with the measured figure, never with the size of the
  suite.** End-to-end does NOT cover every action yet: 36 of 263 were performed by a browser
  test when last measured (2026-10-10). Every round re-measures it and names what nothing does.
