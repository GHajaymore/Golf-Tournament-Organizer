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

> Retired (2026-11-01, from docs/claude/landing-page.md: Ajay ended the phone-only green test — "keep the default color on all platforms for the landing page", then "I need all same" — and the landing pictures became manifest-listed real captures that a look preset may sharpen, per his 30 Oct and 1 Nov rulings. The current rules are in docs/claude/landing-page.md.)

- **Every picture is an unedited capture of the app**, placed by
  `scripts/place-landing-shots.mjs` with its true size and its smaller sharp copies. A screen
  meant to be READ is flat, upright and still (`e2e/landing-screens.spec.ts`); only a layer
  marked `m-decor` and `aria-hidden` may be tilted, dimmed or moving, and nobody is asked to
  read one.
- **The demo club in the pictures is invented** — never a test tournament's own name, never a
  real club or person.
- **Two of its sections are green on a phone, and that is a TEST** (Ajay, 2026-10-13: "indoor
  navi looks okay but outdoors it looks not great … give me couple section with green while
  keeping navy so that I can test it"). The three feature cards (`m-leaf`: green panels on the
  navy ground) and the pricing section (`m-leaf m-leaf-ground`: green edge to edge) are drawn on
  the `LEAF` surface of `landing-palette.ts` below 900px; everything else, and every wider
  screen, is navy. It is there for him to look at in sunlight. Do not extend it, restyle it or
  take it out on anybody's word but his — and when he rules, the losing colour comes out whole.
- **Until go-live it is built and shipped as the designer and reported to Ajay; after go-live
  nothing on it changes without his preview first** (his ruling, 2026-10-11). Another session
  used to own these files; it has said it holds nothing in them.
