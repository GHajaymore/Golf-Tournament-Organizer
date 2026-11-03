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
the hero's live moment reads `screen-facts.json`. Its social strip and footer read `SOCIAL_CHANNELS`
in `src/lib/contact.ts`. Unlike `/` it does not send a signed-in visitor on to the app. It replaces
`/` only on Ajay's word; the design plan is in `TourneyHQ Documents\Landing concepts Nov 2026\Rehaul\`.
Several drafts of it are built side by side on their own branches for him to compare (2026-11-02);
`claude/site-rehaul-c` is design C, the day as a scroll story (`DayStory.tsx`: one phone held in
view whose real screen turns with each moment, a plain sequence below 768px, on `DARK_GROUND`).
`claude/site-rehaul-f` is design F (2026-11-03), D and E mixed: E's light (`day-light.ts`), dawn hero
words and golden-hour finish around D's organizer-led substance (the hero's laptop-and-phone moment,
the day on both devices, console screens through `.n-bg` windows). Its sections for work still in a
pull request are switched in `src/app/new/pipeline.ts`, all off; `site-rehaul-pipeline.test.ts`
refuses a switch turned on before its screens are in the manifest and placed. A section whose
capture has not been placed is not drawn. Its new screens (`f-*` in `screens.ts`) are shot on a
runner by `.github/workflows/landing-captures.yml` (its own throwaway Postgres, no secret), which a
push to `captures/**` starts; download the artifact and commit the placed files.
