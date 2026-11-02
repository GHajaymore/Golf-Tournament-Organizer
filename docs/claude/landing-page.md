# The landing page

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: `src/app/page.tsx`, `src/lib/landing/*`, `/faq`, `/privacy`, `/terms`. Index: `CLAUDE.md`.

**The landing page** (`src/app/page.tsx`, rebuilt 2026-10-11 on midnight navy) is the one page
written in its own stylesheet: `src/lib/landing/home-styles.ts`, every class prefixed `m-`,
scoped to `main.m-home`, its colours taken from `landing-palette.ts` and nowhere else. The
shared chrome (`components/landing/chrome.tsx`, `lib/landing/styles.ts`) also dresses `/faq`,
`/privacy` and `/terms`, so a change there is a change to four pages. Three rules it is held to:

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

**`/new` is the site rehaul's PREVIEW (2026-11-01), not the front door.** `src/app/new/` with its own
stylesheet (`new-styles.ts`, classes `n-`), its own two faces served from `public/new/fonts`
(Archivo, Atkinson Hyperlegible Next, OFL), `noindex`, linked from nowhere. It reads the same facts as
`/` (PLANS, `go-live.ts`, `FORMAT_NAMES`) and draws only screens named in `src/lib/landing/screens.ts`;
the hero's live moment reads `screen-facts.json`. Its footer reads `SOCIAL_LINKS` in
`src/lib/social-links.ts`, the one place those addresses are written. Unlike `/` it does not send a signed-in visitor on to the app. It replaces
`/` only on Ajay's word; the design plan is in `TourneyHQ Documents\Landing concepts Nov 2026\Rehaul\`.
Several drafts of it are built side by side on their own branches for him to compare (2026-11-02);
`claude/site-rehaul-c` is design C, the day as a scroll story (`DayStory.tsx`: one phone held in
view whose real screen turns with each moment, a plain sequence below 768px, on `DARK_GROUND`).
`claude/site-rehaul-e` is design E, "one day's light": each section is painted in the light of its
hour (`src/app/new/day-light.ts`, every text colour held to 7:1 on its own ground by
`day-light.test.ts`), today's serif headline and putt at dawn, C's story, B's bento at midday, the
result at golden hour and the sign-up at the evening prize-giving. Its screens are half the console
and half the player's app, in four club themes (Tournament and Desert on dark, Championship and
Coastal on light): `capture-demo.mjs` saves a manifest screen's `theme` on the seeded demo club,
reads it back before the shot and puts the seed's own back after (the `e-*` screens in `screens.ts`).
