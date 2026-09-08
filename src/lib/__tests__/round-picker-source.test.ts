import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * A ROUND PICKER RETURNS TO THE SCREEN IT IS ON.
 *
 * `?round=<stageId>` is read by several screens, each falling back to the
 * active round. The control that sets it was written twice and both copies
 * were wrong, in opposite directions:
 *
 *   - Group games rendered its picker `disabled`. It listed all four rounds of
 *     a four-round event and could not be changed, while the page under it
 *     served `?round=` perfectly. The only way to see another round's pots was
 *     to type the URL.
 *   - The pot card's picker worked and navigated to a hard-coded
 *     `/prizes?round=…`. That card renders on Group games as well, so choosing
 *     a round there landed the organizer on Prizes & payouts — the club's
 *     money instead of the fourball's, on a screen they had not asked for.
 *
 * Neither is visible to tsc, to a unit test, or to the smoke pass: the picker
 * renders, the options are right, and the destination is a string.
 *
 * `RoundPicker` reads `usePathname()`, so it has no destination to get wrong.
 * This keeps a literal one from coming back.
 */

const COMPONENTS = "src/components";

/**
 * `router.push("/some-screen?round=…")` — a navigation that names where it is
 * going AND carries a round.
 *
 * Deliberately narrow. Plenty of navigation is correctly hard-coded: a link to
 * the leaderboard goes to the leaderboard. What must not be hard-coded is the
 * screen a ROUND switch returns to, because that is the one case where the
 * right answer is "wherever the user already was".
 */
const LITERAL_ROUND_NAV = /router\.push\(\s*[`"']\/[A-Za-z0-9/-]*\?round=/;

function componentFiles(): string[] {
  return readdirSync(COMPONENTS).filter((f) => f.endsWith(".tsx"));
}

describe("changing the round keeps you on the screen you are on", () => {
  it("no component sends a round change to a named screen", () => {
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      const src = readSource(COMPONENTS, file);
      src.split("\n").forEach((line, i) => {
        if (LITERAL_ROUND_NAV.test(line)) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
    }
    expect(
      offenders,
      `a round picker names its destination, so it will be wrong wherever else the component is rendered:\n  ${offenders.join(
        "\n  ",
      )}\nUse <RoundPicker>, which reads usePathname().`,
    ).toEqual([]);
  });

  it("the picker derives its destination rather than holding one", () => {
    const src = readSource(COMPONENTS, "RoundPicker.tsx");
    // Read through readSource, so the paragraph above the component naming
    // `usePathname` cannot satisfy this on its own after the call is deleted.
    expect(src).toMatch(/usePathname\(\)/);
    expect(src).toMatch(/\$\{pathname\}\?round=/);
    // And it holds no screen name at all.
    expect(src).not.toMatch(/["'`]\/(prizes|group-games|week|teams)/);
  });

  it("offers nothing to choose when there is only one round", () => {
    // A select with a single option is a control that looks live and does
    // nothing — the same fault as the disabled one, in a quieter form.
    const src = readSource(COMPONENTS, "RoundPicker.tsx");
    expect(src).toMatch(/rounds\.length\s*<=\s*1/);
  });

  it("would catch a named destination if one came back", () => {
    // The sweep proving it can fail, without a real screen to mutate.
    expect(LITERAL_ROUND_NAV.test('onChange={(e) => router.push(`/prizes?round=${e.target.value}`)}')).toBe(true);
    expect(LITERAL_ROUND_NAV.test('router.push("/group-games?round=" + id)')).toBe(true);
    // And that it leaves the correct shape alone.
    expect(LITERAL_ROUND_NAV.test("router.push(`${pathname}?round=${e.target.value}`)")).toBe(false);
    // Navigation that is rightly hard-coded and has nothing to do with rounds.
    expect(LITERAL_ROUND_NAV.test('router.push("/leaderboard")')).toBe(false);
  });
});
