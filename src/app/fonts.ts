import type { CSSProperties } from "react";
import localFont from "next/font/local";

/**
 * THE TWO DISPLAY FACES, FROM DISK (2026-10-08).
 *
 * Fraunces (headings) and Oswald (the hand-hung scoreboard) came from
 * `next/font/google`, which downloads them AT BUILD TIME. The site never
 * fetched a font from Google at runtime — but every build did, and when that
 * request failed the build died with "An error occurred in `next/font`",
 * blamed on `layout.tsx`. Four CI jobs on 2026-10-07 alone, on commits that
 * could not have caused it; `build-checked.mjs` retries it once and it still
 * got through. CLAUDE.md set the threshold — "if it becomes frequent,
 * self-hosting the two faces is the fix worth costing" — and it was crossed.
 *
 * So the files come from `@fontsource-variable/*` (OFL-1.1, the same Google
 * Fonts sources, pinned exact in package.json) and nothing in a build reaches
 * the network for a font. `font-hosts.test.ts` keeps `next/font/google` out.
 *
 * WHAT IS KEPT EXACTLY, measured against the Google build rather than assumed:
 *
 *   - the same character ranges. Google served Fraunces as latin, latin-ext
 *     and vietnamese, and Oswald as those plus cyrillic and cyrillic-ext, each
 *     a separate file with its own `unicode-range`, so a page downloads the
 *     latin file and a name like "Dvořák" pulls latin-ext only when it is on
 *     screen. One face per range below, with the same ranges, keeps that: a
 *     player's name never drops to a second typeface halfway through.
 *   - only the LATIN file is preloaded, as before.
 *   - the metric-matched fallbacks, "Fraunces Fallback" and "Oswald
 *     Fallback", with the exact values Google's build shipped. They are
 *     declared in globals.css rather than computed here: next/font/local
 *     measured Fraunces at size-adjust 126.68% against Google's 115.45%, and
 *     that drew a Cyrillic name in a heading visibly larger.
 *
 * WHY THE STACK IS ASSEMBLED BY HAND. next/font gives each call its own
 * family. They go first in range order — latin, then the ranges a name may
 * reach into — and the one fallback goes last. A fallback anywhere earlier is
 * a system face that HAS "ř", and it would win every accented letter ahead of
 * the latin-ext face.
 *
 * Every option below is a literal because next/font requires it: the loader
 * is compiled, and a shared constant for the ranges is a build error.
 */

/* ── Fraunces: headings. The full weight axis, upright and italic. ── */

const frauncesLatin = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2", weight: "100 900", style: "italic" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
  adjustFontFallback: false,
});

const frauncesLatinExt = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-ext-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-ext-wght-italic.woff2", weight: "100 900", style: "italic" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const frauncesVietnamese = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-vietnamese-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-vietnamese-wght-italic.woff2", weight: "100 900", style: "italic" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" }],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

/* ── Oswald: the scoreboard. Its weight axis runs 200–700. ── */

const oswaldLatin = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2", weight: "200 700", style: "normal" }],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
  adjustFontFallback: false,
});

const oswaldLatinExt = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/oswald/files/oswald-latin-ext-wght-normal.woff2", weight: "200 700", style: "normal" }],
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const oswaldVietnamese = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/oswald/files/oswald-vietnamese-wght-normal.woff2", weight: "200 700", style: "normal" }],
  declarations: [{ prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" }],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const oswaldCyrillic = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/oswald/files/oswald-cyrillic-wght-normal.woff2", weight: "200 700", style: "normal" }],
  declarations: [{ prop: "unicode-range", value: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" }],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const oswaldCyrillicExt = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/oswald/files/oswald-cyrillic-ext-wght-normal.woff2", weight: "200 700", style: "normal" }],
  declarations: [{ prop: "unicode-range", value: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

type Face = { style: { fontFamily: string } };

/**
 * One family's faces as one stack: every range's face, latin first, then the
 * metric-matched fallback declared in globals.css. See the note above.
 */
export function fontStack(faces: Face[], fallback: string): string {
  return [...faces.map((f) => f.style.fontFamily), `"${fallback}"`].join(", ");
}

/**
 * The two custom properties the stylesheets already read — `--font-display`
 * (globals.css, `--font-heading`) and `--font-board` (design-system.css,
 * `--font-scoreboard`) — set on <html>.
 */
export const displayFontVars = {
  "--font-display": fontStack([frauncesLatin, frauncesLatinExt, frauncesVietnamese], "Fraunces Fallback"),
  "--font-board": fontStack(
    [oswaldLatin, oswaldLatinExt, oswaldVietnamese, oswaldCyrillic, oswaldCyrillicExt],
    "Oswald Fallback",
  ),
} as CSSProperties;
