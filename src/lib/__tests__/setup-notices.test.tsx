import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupNotices } from "@/components/SetupNotices";
import { readSource } from "./source";

/**
 * WHAT IS LEFT TO SORT OUT, ONE LINE EACH (2026-10-16).
 *
 * Rounds & formats stacked five notice cards above the rounds; on a ten-round
 * league at 375px the first round began 950px down. One card now — every
 * problem still NAMED on the screen, its reason a tap away. These pin the two
 * halves: nothing that was shown is hidden, and the reasons are folded.
 */
describe("the notices above the rounds", () => {
  const items = [
    { key: "cards", tone: "block" as const, title: "A course card is missing.", body: "Round 1 needs its course card." },
    { key: "dates", tone: "note" as const, title: "10 rounds have no date", body: "Date them all at once." },
  ];

  it("names every problem, and says how many stop a launch", () => {
    const html = renderToStaticMarkup(<SetupNotices items={items} />);
    expect(html).toContain("A course card is missing.");
    expect(html).toContain("10 rounds have no date");
    expect(html).toContain("1 needed before launch");
  });

  it("folds the reasons until a tap", () => {
    const html = renderToStaticMarkup(<SetupNotices items={items} />);
    expect(html).not.toContain("Round 1 needs its course card.");
    expect(html).toContain('aria-expanded="false"');
  });

  it("puts what stops a launch first, whatever order it is handed", () => {
    const html = renderToStaticMarkup(<SetupNotices items={[...items].reverse()} />);
    expect(html.indexOf("A course card is missing.")).toBeLessThan(html.indexOf("10 rounds have no date"));
    // CONTROL: the advice is there to be put second.
    expect(html.indexOf("10 rounds have no date")).toBeGreaterThan(-1);
  });

  it("draws nothing when there is nothing to sort out", () => {
    expect(renderToStaticMarkup(<SetupNotices items={[]} />)).toBe("");
  });

  it("the Rounds screen sends its notices through it, not as cards of their own", () => {
    const page = readSource("src", "app", "(app)", "stages", "page.tsx");
    expect(page).toMatch(/<SetupNotices/);
    // The two that were cards of their own above the rounds are items now.
    expect(page).not.toMatch(/<SeasonDates undated=\{seasonUndated\} suggestedStart=\{state\.today\} \/>/);
    expect(page).not.toMatch(/handicapWarning=\{/);
  });
});
