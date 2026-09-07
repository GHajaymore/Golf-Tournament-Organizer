import { describe, it, expect } from "vitest";
import {
  DEFAULT_CLUB_THEME,
  DEFAULT_THEME,
  THEME_PRESETS,
  SECONDARY_PRESETS,
  sunlightVerdict,
  themeScale,
  contrastRatio,
  themeFor,
  DARK_GROUND,
  SUNLIGHT_RATIO,
  MIN_HUE_SEPARATION,
} from "@/lib/themes";
import { readSource } from "./source";

/**
 * The theme this app ships with passes the bar this app sets.
 *
 * That was not true. `SUNLIGHT_RATIO` is 7:1 — the app's own answer to a score
 * being read on a phone at arm's length in direct sun — and it warns any club
 * whose colours fall under it. The shipped default failed its own warning:
 * Sunset at 6.97:1 with Fairway at 3.91:1, so `sunlightVerdict` returned
 * `ok: false` out of the box.
 *
 * And it was unwinnable rather than unlucky. Asked about all eleven presets,
 * the grader returned `ok: false` for EVERY one, because Fairway is the
 * secondary in each and 3.91 fails alone. There was no pairing a club could
 * choose that satisfied the warning the product was showing them.
 *
 * A product that ships a default failing its own accessibility rule is telling
 * every new club their colours are wrong before they have chosen any.
 */
describe("the default theme", () => {
  it("passes the app's own sunlight bar", () => {
    const verdict = sunlightVerdict(DEFAULT_CLUB_THEME);
    expect(
      verdict.ok,
      `default is ${DEFAULT_CLUB_THEME.accentKey}/${DEFAULT_CLUB_THEME.secondaryKey}: ${verdict.warning ?? ""}`,
    ).toBe(true);
  });

  it("clears the bar on the accent AND the secondary, not just one", () => {
    /**
     * The discriminating half. `--color-accent-2` is the semantic colour — it
     * rings a birdie and an eagle, marks the live dot, and colours money owed
     * to you — so a default that fixed only the accent would leave every one
     * of those signals under the bar, which is exactly the state this replaced.
     */
    const accent = themeScale(themeFor(DEFAULT_CLUB_THEME.accentKey), DARK_GROUND);
    const secondary = SECONDARY_PRESETS.find((p) => p.key === DEFAULT_CLUB_THEME.secondaryKey);
    expect(secondary, `no such secondary preset: ${DEFAULT_CLUB_THEME.secondaryKey}`).toBeTruthy();
    const secondaryScale = themeScale(secondary!, DARK_GROUND);

    for (const [label, hex] of [
      ["accent", accent[500]],
      ["secondary", secondaryScale[500]],
    ] as const) {
      const ratio = contrastRatio(hex, DARK_GROUND.bg);
      expect(ratio, `${label} ${hex} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(SUNLIGHT_RATIO);
    }
  });

  it("keeps the two colours far enough apart to read as two colours", () => {
    const accent = themeFor(DEFAULT_CLUB_THEME.accentKey);
    const secondary = SECONDARY_PRESETS.find((p) => p.key === DEFAULT_CLUB_THEME.secondaryKey)!;
    const gap = Math.min(
      Math.abs(accent.hue - secondary.hue),
      360 - Math.abs(accent.hue - secondary.hue),
    );
    expect(gap, `${accent.key} and ${secondary.key} are ${gap} degrees apart`).toBeGreaterThanOrEqual(
      MIN_HUE_SEPARATION,
    );
  });

  it("names a preset that actually exists", () => {
    expect(THEME_PRESETS.map((p) => p.key)).toContain(DEFAULT_THEME);
    expect(SECONDARY_PRESETS.map((p) => p.key)).toContain(DEFAULT_CLUB_THEME.secondaryKey);
  });
});

describe("the database default and the code default are the same default", () => {
  /**
   * THIS CHANGE CREATED A SECOND READER, so it is pinned immediately.
   *
   * `Organization.themeKey` and `themeSecondaryKey` carry SQL defaults, which
   * is what a new club actually gets — Postgres writes the column default on
   * insert, so `DEFAULT_CLUB_THEME` never reaches a real row. Changing only
   * the TypeScript would have looked completely correct, passed every test
   * above, and changed nothing whatsoever for a new club.
   *
   * The reverse is just as bad: changing only the schema leaves the styleguide,
   * `themeForEvent`'s no-organization branch, and the app shell's no-event
   * fallback rendering a different pair from every real club.
   *
   * So the two are asserted equal, read out of `schema.prisma` itself.
   */
  const SCHEMA = readSource("prisma/schema.prisma");

  const schemaDefault = (field: string): string => {
    const m = SCHEMA.match(new RegExp(`${field}\\s+String\\s+@default\\("([^"]+)"\\)`));
    if (!m) throw new Error(`no @default found for ${field} in schema.prisma`);
    return m[1];
  };

  it("agrees on the accent", () => {
    expect(schemaDefault("themeKey"), "schema.prisma vs DEFAULT_THEME").toBe(DEFAULT_THEME);
  });

  it("agrees on the secondary", () => {
    expect(schemaDefault("themeSecondaryKey"), "schema.prisma vs DEFAULT_CLUB_THEME").toBe(
      DEFAULT_CLUB_THEME.secondaryKey,
    );
  });

  it("reads real values out of the schema, not an empty match", () => {
    // Guards the regex itself: a schema rename would make both assertions
    // above throw rather than pass vacuously, but this states the expectation.
    expect(schemaDefault("themeKey").length).toBeGreaterThan(2);
    expect(schemaDefault("themeSecondaryKey").length).toBeGreaterThan(2);
  });
});

describe("the default is resolved in one place", () => {
  it("has no second copy of the default secondary", () => {
    /**
     * The reason this is asserted rather than trusted: changing
     * DEFAULT_CLUB_THEME alone changed NOTHING for a real club. The runtime
     * path is `themeForEvent`, which read `?? FAIRWAY.key` directly — a second
     * default that silently outranked the one everybody else reads. The save
     * action had a third, as a parameter default.
     *
     * Read through `readSource` so the comments explaining that history do not
     * satisfy the search themselves.
     */
    for (const file of ["src/lib/services/organization.ts", "src/app/actions/organization.ts"]) {
      expect(readSource(file), `${file} hard-codes a default secondary`).not.toMatch(/\?\?\s*FAIRWAY\.key|=\s*FAIRWAY\.key/);
    }
  });
});
