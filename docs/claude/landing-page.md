# The landing page

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: `src/app/page.tsx`, `src/lib/landing/*`, `/faq`, `/privacy`, `/terms`. Index: `CLAUDE.md`.

**The landing page** (`src/app/page.tsx`, rebuilt 2026-10-11 on midnight navy) is the one page
written in its own stylesheet: `src/lib/landing/home-styles.ts`, every class prefixed `m-`,
scoped to `main.m-home`, its colours taken from `landing-palette.ts` and nowhere else. The
shared chrome (`components/landing/chrome.tsx`, `lib/landing/styles.ts`) also dresses `/faq`,
`/privacy` and `/terms`, so a change there is a change to four pages. Three rules it is held to:

- **Every picture is a real capture of the app; a look preset may enhance its look, never its
  content** (Ajay, 30 Oct: "if AI can enhance the real screen I am okay with that", and 1 Nov:
  "real screens enhanced to match the page"). Every screen is listed ONCE, in
  `src/lib/landing/screens.ts`: who is signed in, which tournament, which country, which path,
  the words that must be on it, its crop and its look preset (`crisp`, or the hero's `hero`:
  Lanczos, an unsharp mask, a slight contrast lift — never a word, a figure or a layout). The page
  draws only screens it names (`plainShot` throws on any other).
- **To refresh the screens: `npm run landing:capture`** (or `-- --only=id,id`). It needs this
  checkout's dev server on `localhost:3100` (`CAPTURE_BASE_URL` to change it) and the LOCAL
  development database, and refuses any other host. It seeds the invented demo club, dresses it,
  shoots each screen, tears it down and proves every table's row count is unchanged; then
  `place-landing-shots.mjs` refuses — before writing anything — a capture of the wrong size, a
  crop outside it, or a screen without its `expect` words. Screens it cannot shoot yet are marked
  `kept` in the manifest with the reason, and it says so on every run.
- **The hero's live moment** (`components/landing/hero-stage.tsx`, 2026-11-01): the member's card,
  a press of "4 Par" on the 10th, and the board and the organizer's leaderboard after it — one run
  of the real app (`LIVE_MOMENT` in the manifest). Every figure said beside it (24 players, holes
  in 284 then 285, T7 to T5, the rows the light falls on) is read off those captures into
  `screen-facts.json` by the capture, never typed. The scene behind the devices
  (`hero-scene`) is AI-made atmosphere with no screen and no words, placed with
  `place-landing-shots.mjs --scene=<image>`. Glass, rim light and the row light are CSS layers
  over the pictures, never in them.
- **A screen meant to be READ is flat, upright and still** once it has arrived
  (`e2e/landing-screens.spec.ts`); only a layer marked `m-decor` and `aria-hidden` (the hero's
  laptop, the wall of screens) may be turned, dimmed or moving, and nobody is asked to read one.
- **The demo club in the pictures is invented** — never a test tournament's own name, never a
  real club or person.
- **One set of colours at every width.** Two sections were green on a phone only, as Ajay's
  outdoor test, from 2026-10-13; he ended it on 2026-11-01 ("keep the default color on all
  platforms … the same color", then "I need all same") and it was taken out whole — the `LEAF`
  surface, `leafTokens`, the `m-leaf` classes and the phone-width block. `e2e/landing-colours.spec.ts`
  holds every section to the same colours at 393, 768 and 1440, and `landing-contrast.test.ts`
  refuses a phone-width block that re-declares a colour.
- **Until go-live it is built and shipped as the designer and reported to Ajay; after go-live
  nothing on it changes without his preview first** (his ruling, 2026-10-11). Another session
  used to own these files; it has said it holds nothing in them.
