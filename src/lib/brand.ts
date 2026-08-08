/**
 * How a club's name appears next to its logo.
 *
 * Clubs have two names and they are not interchangeable. "Cedar Dunes Golf &
 * Country Club" is what goes on a printed card; "CDG" is what fits in a
 * sidebar next to a logo. Forcing one choice for both places is why the
 * console showed an acronym nobody outside the club recognises, or a name that
 * wrapped onto three lines.
 *
 * So it is a setting — but a setting that cannot produce a bad result. Every
 * option falls back to whatever the club actually filled in, and no option
 * ever prints the same string twice.
 */

export const BRAND_DISPLAY = ["short", "full", "both"] as const;
export type BrandDisplay = (typeof BRAND_DISPLAY)[number];

export const BRAND_DISPLAY_LABEL: Record<BrandDisplay, string> = {
  short: "Short name",
  full: "Full name",
  both: "Both",
};

export const BRAND_DISPLAY_HELP: Record<BrandDisplay, string> = {
  short: "Just the short name beside the logo. Best when the full name is long.",
  full: "The full club name. Best when it is short enough to sit on one line.",
  both: "Short name on top, full name beneath it in smaller type.",
};

export function isBrandDisplay(v: string): v is BrandDisplay {
  return (BRAND_DISPLAY as readonly string[]).includes(v);
}

export interface BrandLines {
  /** The main line. Never empty when the club has filled in either name. */
  primary: string;
  /** A quieter second line, or "" when there is nothing worth adding. */
  secondary: string;
}

/**
 * Resolve the club's names into the one or two lines actually rendered.
 *
 * Three guarantees, which is what makes this safe to expose as a setting:
 *
 *   1. Nothing repeats. Asking for both when the two names are the same — or
 *      when one is blank — gives one line, not the same words twice.
 *   2. Nothing disappears. Every option falls back to the name that exists, so
 *      choosing "short name" at a club that never set one still shows a name
 *      rather than an empty space beside the logo.
 *   3. Whitespace is not a name. A short name of "   " is treated as unset.
 */
export function brandLines(
  name: string,
  shortName: string,
  display: BrandDisplay,
): BrandLines {
  const full = (name ?? "").trim();
  const short = (shortName ?? "").trim();

  if (!full && !short) return { primary: "", secondary: "" };
  if (!short) return { primary: full, secondary: "" };
  if (!full) return { primary: short, secondary: "" };

  if (display === "full") return { primary: full, secondary: "" };
  if (display === "short") return { primary: short, secondary: "" };

  // both — but only when the second line says something the first does not.
  if (full.toLowerCase() === short.toLowerCase()) return { primary: short, secondary: "" };
  return { primary: short, secondary: full };
}

/**
 * The monogram shown when a club has no logo.
 *
 * Initials of the first two words beat a single letter: three clubs in a
 * league all starting with "R" is ordinary, and one letter tells them apart
 * about as well as no letter at all.
 */
export function brandMonogram(name: string, shortName: string): string {
  const source = (shortName || name || "").trim();
  if (!source) return "?";

  const words = source.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (words.length === 0) return "?";

  // An all-caps short name is already a monogram — "CDG" should stay "CDG",
  // not become "C".
  if (words.length === 1) {
    const w = words[0];
    if (w.length <= 3 && w === w.toUpperCase()) return w;
    return w.charAt(0).toUpperCase();
  }

  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}
