import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkinsStandingsTable, NassauMatches } from "@/components/PointsLeaderboard";
import type { SkinsBoard } from "@/lib/services/points-standings";
import { readSource } from "./source";
import fs from "node:fs";
import path from "node:path";

/**
 * NOTHING CARRIES OUT OF A CLOSED ROUND (2026-10-08, grid cell T53).
 *
 * A skins round closed by the committee, the last fifteen holes tied. Under
 * FINAL the board read "15 skins are still carrying — the last decided hole
 * was tied. 18 holes decided so far." Skins tied through the last hole are not
 * won; nothing is coming for them to carry to.
 */
const board: SkinsBoard = {
  outcome: {
    holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1 })) as unknown as SkinsBoard["outcome"]["holes"],
    standings: [{ playerId: "a", skins: 2, holesWon: [1, 2] }] as unknown as SkinsBoard["outcome"]["standings"],
    unclaimed: 15,
  },
  nameById: { a: "zz-Ann" },
};
const text = (roundClosed: boolean) =>
  renderToStaticMarkup(createElement(SkinsStandingsTable, { board, roundClosed })).replace(/<[^>]+>/g, " ");

describe("the skins board over a closed round", () => {
  it("says the skins were never won, and nothing about 'so far'", () => {
    const t = text(true);
    expect(t).toContain("15 skins were never won");
    expect(t).not.toMatch(/still carrying|so far/);
  });

  it("says they are carrying while the round is open — the control", () => {
    expect(text(false)).toContain("15 skins are still carrying");
  });

  /**
   * PLAYED, NOT DECIDED (2026-10-09, T70). A skin is decided when a hole is
   * won outright, so "15 skins were never won … 18 holes decided" said two
   * opposite things about one round, and "the last decided hole was tied" is
   * a contradiction in four words. The count is of holes played.
   */
  it("counts holes played, and never calls a tied hole decided", () => {
    expect(text(true)).toContain("18 holes played.");
    expect(text(false)).toContain("the last hole played was tied. 18 holes played so far.");
    for (const t of [text(true), text(false)]) expect(t).not.toMatch(/holes? decided|decided hole/);
  });

  /**
   * SWEPT, NOT LISTED (2026-10-09). This was four hand-named files, and the
   * fifth reader — the league week sheet — was not among them: a closed skins
   * night there read "still carrying … so far" for as long as this list was
   * green. Every file that draws one of these tables is found and asked.
   */
  it("is told the round is closed wherever it is drawn", () => {
    const tags = [
      "<SkinsStandingsTable",
      "<SkinsLeaderboard",
      "<NassauMatches",
      "<NassauLeaderboard",
      "<TeamStandingsTable",
      "<TeamLeaderboard",
    ];
    const drawers = walk("src").filter((f) => tags.some((t) => readSource(f).includes(t)));
    // The control: the sweep finds the screens it was written for, and the
    // one that was missed, or it is measuring nothing.
    for (const known of ["src/app/live/[token]/page.tsx", "src/components/WeekClient.tsx"]) {
      expect(drawers, `the sweep did not find ${known}`).toContain(known);
    }
    for (const f of drawers) {
      const src = readSource(f);
      for (const t of tags) {
        for (const use of src.split(t).slice(1)) {
          const props = use.slice(0, use.indexOf(">"));
          expect(props, `${f}: a ${t.slice(1)} is not told whether its round is closed`).toMatch(/\sroundClosed=\{/);
        }
      }
    }
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") walk(full, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * And a Nassau round closed with no matches drawn read "No matches in this
 * round yet" under FINAL (grid cell T54) — a promise of matches to come.
 */
describe("the Nassau board over a closed round", () => {
  const nassau = (roundClosed: boolean) =>
    renderToStaticMarkup(createElement(NassauMatches, { rows: [], roundClosed }));

  it("says no matches were played", () => {
    expect(nassau(true)).toContain("No matches were played in this round.");
    expect(nassau(true)).not.toContain("yet");
  });

  it("says 'yet' while the round is open — the control", () => {
    expect(nassau(false)).toContain("No matches in this round yet.");
  });
});
