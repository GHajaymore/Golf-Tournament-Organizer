import { describe, expect, it, vi } from "vitest";
import { readSource } from "./source";
import { orNeedsSignal } from "../../components/LazyPanel";

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
  { client: "src/components/StagesClient.tsx", panels: ["MatchTiebreakControl", "RoundHandicaps"] },
  { client: "src/components/CourseLibrary.tsx", panels: ["CardImport", "CourseSearch"] },
];

describe("the rounds screen loads the cut's tie panel when a tie is drawn", () => {
  it("StagesClient makes CutTiePanel with next/dynamic and never imports it statically", () => {
    const src = readSource("src/components/StagesClient.tsx");
    const staticImport = [...src.matchAll(/import\s+([^;]*?)\s+from\s*["']([^"']+)["']/g)].some(
      ([, names]) => !/^type\s/.test(names) && /\bCutTiePanel\b/.test(names),
    );
    expect(staticImport).toBe(false);
    expect(/const\s+CutTiePanel\s*=\s*dynamic\(/.test(src)).toBe(true);
  });
});

/** The static value imports of `panel` in `src`, and whether it is made with next/dynamic. */
function howPanelIsLoaded(src: string, panel: string): { statically: boolean; dynamically: boolean } {
  // Every import statement is read for what it brings in and from where; it
  // counts if its specifier ends in the panel's file name, whatever the spelling
  // (./X, @/components/X, ../components/X).
  const statements = [...src.matchAll(/import\s+([^;]*?)\s+from\s*["']([^"']+)["']/g)];
  const statically = statements.some(([, names, spec]) => {
    const file = spec.split("/").pop();
    return file === panel && !/^type\s/.test(names) && new RegExp(String.raw`\b${panel}\b`).test(names);
  });
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

  it("a failed chunk load is retried, then shows a notice rather than throwing", async () => {
    const never = vi.fn(() => Promise.reject(new Error("chunk gone")));
    const shown = await orNeedsSignal(never as never, 2);
    expect(never).toHaveBeenCalledTimes(2);
    expect(typeof shown).toBe("function");
    let tries = 0;
    const Real = () => null;
    const flaky = async () => {
      if (tries++ === 0) throw new Error("blip");
      return Real;
    };
    expect(await orNeedsSignal(flaky as never, 3)).toBe(Real);
  });

  it("the sweep can see the fault: a static import is reported", () => {
    const bad = `import { ScoreImport } from "./ScoreImport";\nexport const x = 1;`;
    expect(howPanelIsLoaded(bad, "ScoreImport")).toEqual({ statically: true, dynamically: false });
    const aliased = `import { ScoreImport } from "@/components/ScoreImport";`;
    expect(howPanelIsLoaded(aliased, "ScoreImport").statically).toBe(true);
    const good = `const ScoreImport = dynamic(() => import("./ScoreImport"), { ssr: false });`;
    expect(howPanelIsLoaded(good, "ScoreImport")).toEqual({ statically: false, dynamically: true });
  });
});
