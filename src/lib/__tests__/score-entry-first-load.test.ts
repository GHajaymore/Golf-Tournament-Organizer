import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * The first load of score entry (/entry) and the rounds screen (/stages).
 *
 * Score entry is used on a phone on the course, often on poor signal, so what
 * its first load carries is paid for there. Baseline 2026-11-13: /entry 217 kB,
 * /stages 199 kB, against 105 kB shared. A panel that sits behind a press and
 * writes to the server (a spreadsheet import, clearing a round, a round's
 * handicap overrides, a tie rule's control) is loaded when it is opened, with
 * `next/dynamic` through `LazyPanel`, so it is not part of that first load.
 *
 * One static `import { X } from "./X"` puts the panel back in the first load
 * and nothing else would notice, which is the fault this sweep refuses.
 *
 * Score entry itself (ScoreEntryClient, StrokePlayEntry, HoleByHoleCard and
 * the saved-card code) is deliberately NOT lazy: with no signal a chunk that
 * was never fetched cannot be fetched, and entry has to open and keep scoring.
 */

const LAZY: Array<{ client: string; panels: string[] }> = [
  { client: "src/components/EntryModes.tsx", panels: ["ScoreImport", "ClearScores"] },
  { client: "src/components/TeamScoreImport.tsx", panels: ["ScoreImport"] },
  { client: "src/components/StagesClient.tsx", panels: ["RoundHandicaps", "MatchTiebreakControl"] },
];

/** The static value imports of `panel` in `src`, and whether it is made with next/dynamic. */
function howPanelIsLoaded(src: string, panel: string): { statically: boolean; dynamically: boolean } {
  const statically = new RegExp(String.raw`import\s*\{[^}]*\b${panel}\b[^}]*\}\s*from\s*["']\./${panel}["']`).test(src);
  const dynamically = new RegExp(String.raw`const\s+${panel}\s*=\s*dynamic\(`).test(src);
  return { statically, dynamically };
}

describe("score entry and the rounds screen load their rare panels when opened", () => {
  for (const { client, panels } of LAZY) {
    for (const panel of panels) {
      it(`${client} loads ${panel} with next/dynamic and never imports it statically`, () => {
        const src = readSource(client);
        const how = howPanelIsLoaded(src, panel);
        expect(how.statically).toBe(false);
        expect(how.dynamically).toBe(true);
      });
    }
  }

  it("a failed chunk load shows a notice rather than throwing into the screen", () => {
    const src = readSource("src/components/LazyPanel.tsx");
    expect(src).toMatch(/\.catch\(\(\) => PanelNeedsSignal/);
  });

  it("the sweep can see the fault: a static import is reported", () => {
    const bad = `import { ScoreImport } from "./ScoreImport";\nexport const x = 1;`;
    expect(howPanelIsLoaded(bad, "ScoreImport")).toEqual({ statically: true, dynamically: false });
    const good = `const ScoreImport = dynamic(() => import("./ScoreImport"), { ssr: false });`;
    expect(howPanelIsLoaded(good, "ScoreImport")).toEqual({ statically: false, dynamically: true });
  });
});
