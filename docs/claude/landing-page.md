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
