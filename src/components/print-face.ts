import localFont from "next/font/local";

/**
 * THE PRINT KIT'S LATIN FACE: the scoreboard's, UNHINTED (2026-10-31).
 *
 * The cards are set in Oswald, from disk, so what the browser measures is what
 * prints. `/print` used to import `scoreboard-face.ts` for that, and that call
 * preloads: every visit to the Print kit downloaded 28 KB of Oswald before it
 * knew whether it would draw a card — and a visit with nothing ticked, or a
 * round with no groups yet, draws none (`e2e/fonts.spec.ts` caught it on the
 * phone suite).
 *
 * So the kit declares the SAME file under the SAME family with `preload: false`.
 * The @font-face rule is on the page; the browser fetches the file only when a
 * sheet lays out a letter in it. `PrintKitClient` waits for the face before it
 * calls the printer, so a card never goes to paper in the fallback.
 *
 * The family is written out, as in `scoreboard-face.ts`, because the stack on
 * <html> (`fonts.ts`) leads with "oswaldLatin" and the two have to spell it
 * alike. `font-hosts.test.ts` holds both: the same file, the same family, this
 * one never preloaded, and whatever renders the kit imports this, not the
 * scoreboard's hinted call.
 */
export const printOswaldLatin = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2", weight: "200 700", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "oswaldLatin" },
    { prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
