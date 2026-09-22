import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemePicker } from "@/components/ThemePicker";
import {
  THEME_PAIRS,
  ACCENT_PRESETS,
  SECONDARY_PRESETS,
  DEFAULT_CLUB_THEME,
  SUN_GRADE_LABEL,
  themeSunGrade,
  sunlightVerdict,
  hueDistance,
  MIN_HUE_SEPARATION,
  type ClubTheme,
} from "@/lib/themes";

vi.mock("@/app/actions/organization", () => ({
  saveOrganizationTheme: vi.fn(async () => ({ ok: true })),
}));

/**
 * WHAT A CLUB IS TOLD ABOUT SUNLIGHT, AND WHEN.
 *
 * Ajay, 2026-09-21: "just want to make sure we warn organizer if they select
 * any theme and it is not recommended for the mobile to use it in the sun
 * while playing golf."
 *
 * The app already had the warning and it was in the wrong PLACE — one panel
 * below the swatches, so the choosing happened with nothing marked. Measured
 * the same day: on the dark ground, which is what `auto` resolves to and
 * `auto` is the default, only 30 of 144 accent/secondary combinations clear
 * SUNLIGHT_RATIO, and ALL SIX of the ready-made schemes were among the 114
 * that do not. The one feature aimed at an organizer who did not want to do
 * design work was recommending six schemes that are hard to read on the
 * course, and the app's own default was not offered as a scheme at all.
 *
 * These assert the RULE — every choosable thing carries its grade, and the
 * grade a card shows is the grade the engine computes — rather than the
 * wording of a badge. Rewording should not turn this red; a badge that
 * disappears, or that disagrees with `sunlightVerdict`, must.
 */

const theme = (over: Partial<ClubTheme> = {}): ClubTheme => ({ ...DEFAULT_CLUB_THEME, ...over });

const markup = (appearance: ClubTheme["appearance"]) =>
  renderToStaticMarkup(<ThemePicker theme={theme({ appearance })} readOnly={false} />);

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/**
 * The slice of markup belonging to one scheme's card.
 *
 * Anchored on the scheme NAME and taken as a fixed window, rather than read
 * from the name to the blurb — React escapes the markup, so "The app's own
 * colours" is `The app&#x27;s own colours` and searching for the raw blurb
 * finds nothing. The badge is rendered immediately after the name, so a short
 * window holds it and cannot reach the next card.
 */
function cardOf(html: string, name: string): string {
  const from = html.indexOf(`>${name}</span>`);
  return from < 0 ? "" : html.slice(from, from + 1200);
}

describe("sunlight is graded before the click, not after it", () => {
  it("badges every ready-made scheme, on the dark ground", () => {
    const html = markup("dark");

    for (const pair of THEME_PAIRS) {
      const grade = themeSunGrade(
        theme({
          appearance: "dark",
          accentKey: pair.accentKey,
          accentHex: "",
          secondaryKey: pair.secondaryKey,
          secondaryHex: "",
        }),
      );
      const card = cardOf(html, pair.name);
      expect(card, `${pair.name}: card markup not found`).not.toBe("");
      expect(
        card.includes(SUN_GRADE_LABEL[grade]),
        `${pair.name} should be marked "${SUN_GRADE_LABEL[grade]}"`,
      ).toBe(true);
    }
  });

  /**
   * The control, and the reason the test above is not satisfied by printing
   * one word on everything.
   *
   * A badge hard-coded to "Good in sun" would pass a check that only looked
   * for a badge. On dark both groups are non-empty — the traditional schemes
   * are dim and the new ones are not — so the screen has to be telling them
   * apart.
   */
  it("says different things about different schemes on the same screen", () => {
    const html = markup("dark");
    expect(count(html, SUN_GRADE_LABEL.good)).toBeGreaterThan(0);
    expect(count(html, SUN_GRADE_LABEL.dim)).toBeGreaterThan(0);
  });

  it("re-grades when the club switches to Light, where everything clears the bar", () => {
    // All 144 combinations pass on the light ground, so nothing may be marked
    // dim. This is what would catch a badge frozen to the dark ground.
    const html = markup("light");
    expect(count(html, SUN_GRADE_LABEL.dim)).toBe(0);
    expect(count(html, SUN_GRADE_LABEL.good)).toBeGreaterThan(THEME_PAIRS.length);
  });

  it("badges every individual colour too, not only the schemes", () => {
    const html = markup("dark");
    const badges = count(html, SUN_GRADE_LABEL.good) + count(html, SUN_GRADE_LABEL.dim);
    // Each preset is offered twice, once as a main colour and once as a
    // second colour; the count is what proves no swatch was left unmarked.
    expect(badges).toBeGreaterThanOrEqual(
      ACCENT_PRESETS.length + SECONDARY_PRESETS.length + THEME_PAIRS.length,
    );
  });

  it("names Light as the remedy where the schemes are dim", () => {
    // The badge states the problem; something on the screen has to state the
    // fix, or an organizer is told their choice is poor and left there.
    expect(markup("dark")).toMatch(/switching Appearance to Light/i);
  });
});

describe("the refreshed collection", () => {
  it("offers schemes that are actually readable outdoors on the default ground", () => {
    const good = THEME_PAIRS.filter(
      (p) =>
        themeSunGrade(
          theme({
            appearance: "dark",
            accentKey: p.accentKey,
            accentHex: "",
            secondaryKey: p.secondaryKey,
            secondaryHex: "",
          }),
        ) === "good",
    );
    // Was ZERO before 2026-09-21. A club on the default appearance picking any
    // ready-made scheme was picking a dim one, and nothing said so.
    expect(good.length).toBeGreaterThanOrEqual(4);
  });

  it("offers the app's own default as a scheme", () => {
    // It was not in the list at all, so the one combination known to be right
    // was the one an organizer could not click.
    const match = THEME_PAIRS.find(
      (p) =>
        p.accentKey === DEFAULT_CLUB_THEME.accentKey &&
        p.secondaryKey === DEFAULT_CLUB_THEME.secondaryKey,
    );
    expect(match, "the default accent+secondary should be a pickable scheme").toBeTruthy();
  });

  it("keeps every scheme clear of the hue-separation floor", () => {
    for (const pair of THEME_PAIRS) {
      const a = ACCENT_PRESETS.find((p) => p.key === pair.accentKey);
      const s = SECONDARY_PRESETS.find((p) => p.key === pair.secondaryKey);
      expect(a, `${pair.key} names an accent that exists`).toBeTruthy();
      expect(s, `${pair.key} names a secondary that exists`).toBeTruthy();
      expect(
        hueDistance(a!.hue, s!.hue),
        `${pair.key}: ${pair.accentKey}/${pair.secondaryKey} must read as two colours`,
      ).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION);
    }
  });

  it("grades a scheme the same way the warning panel does", () => {
    // Two readers of one question. They agree because both go through
    // `sunlightVerdict`; this is what goes red if somebody gives the badge
    // arithmetic of its own.
    for (const pair of THEME_PAIRS) {
      const t = theme({
        appearance: "dark",
        accentKey: pair.accentKey,
        accentHex: "",
        secondaryKey: pair.secondaryKey,
        secondaryHex: "",
      });
      expect(themeSunGrade(t) === "good").toBe(sunlightVerdict(t).ok);
    }
  });
});
