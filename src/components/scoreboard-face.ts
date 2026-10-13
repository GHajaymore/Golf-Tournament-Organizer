import localFont from "next/font/local";

/**
 * THE SCOREBOARD'S LATIN FACE, HINTED ONLY WHERE A SCOREBOARD HANGS (2026-10-13).
 *
 * Oswald draws one thing in this app: the hand-hung scoreboard on the player's
 * Today (`Scoreboard.tsx`, `.sb-board` and `.sb-action` in globals.css). While
 * this call lived in `src/app/fonts.ts` the root layout imported it, so
 * next/font preloaded its 28 KB on every screen there is — the organizer's
 * console, the public board, a player's card — for one screen to draw.
 *
 * next/font hints a face on the routes whose own files import the call. So the
 * call is here, and THE SCREEN THAT RENDERS A SCOREBOARD IMPORTS THIS FILE, for
 * its effect alone:
 *
 *     import "@/components/scoreboard-face";
 *
 * It is not imported by `Scoreboard.tsx` itself because that component is
 * rendered in unit tests, and `next/font/local` is a function that only exists
 * inside a Next build. `font-hosts.test.ts` holds the rule instead: whatever
 * imports the scoreboard imports its face, and no layout does.
 *
 * Everything else about Oswald is still in `fonts.ts` — the other four ranges
 * (never preloaded), the stack, the fallback. The stack names this face's
 * family first, which is why the family is written out below rather than left
 * to be named after the constant: the two files have to spell it alike.
 */
export const oswaldLatin = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2", weight: "200 700", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "oswaldLatin" },
    { prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
  display: "swap",
  adjustFontFallback: false,
});
