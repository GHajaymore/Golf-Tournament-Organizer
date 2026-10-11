import { describe, it, expect } from "vitest";
import { marginRefusal, marginToHoles, resolveMatch } from "../domain/match";
import { readSource } from "./source";

/**
 * A NAMED WINNER IS NEVER RECORDED AS A HALVED MATCH (sweep 1, b1, 2026-10-10).
 *
 * A player tapped "I won", left the margin box empty — it starts empty and the
 * button was never disabled — and the match was stored all square: every hole
 * halved. The audit line beside it said "1 UP". The same through the console's
 * "Apply result" and through an imported file with no Margin column.
 *
 * `marginToHoles` read a blank margin as "all square" before it looked at who
 * had won. Three doors validated the margin's SHAPE ("2&3" is not a result)
 * and none asked whether there was one.
 *
 * Two layers, and both are pinned here. The SINK can no longer answer "halved"
 * for a named winner, whatever it is handed. And the DOORS refuse to guess: a
 * winner needs a margin, said in words a player can act on — Rule 3.2a(3) has
 * a match won by a number of holes, and a club's result sheet always says it.
 */
describe("the sink: a winner's result is never all square", () => {
  for (const margin of ["", "   ", "AS", "as"]) {
    it(`A named, margin ${JSON.stringify(margin)}: A has won`, () => {
      const r = resolveMatch(marginToHoles("A", margin, 18));
      expect(r.winner).toBe("A");
    });
    it(`B named, margin ${JSON.stringify(margin)}: B has won`, () => {
      const r = resolveMatch(marginToHoles("B", margin, 18));
      expect(r.winner).toBe("B");
    });
  }

  it("CONTROL: halved is still halved, and a stated margin is still that margin", () => {
    expect(resolveMatch(marginToHoles("H", "", 18)).winner).toBe("H");
    expect(resolveMatch(marginToHoles("H", "AS", 18)).winner).toBe("H");
    const won = resolveMatch(marginToHoles("A", "3&2", 18));
    expect(won.winner).toBe("A");
    expect(won.resultText).toBe("3&2");
  });
});

describe("the doors: a winner needs a margin, and the refusal says what to type", () => {
  it("refuses a winner with no margin", () => {
    for (const w of ["A", "B"] as const) {
      const msg = marginRefusal(w, "", 18);
      expect(msg, `${w} with a blank margin was let through`).not.toBeNull();
      expect(msg).toContain("2&1");
      expect(msg).toContain("1 UP");
      expect(marginRefusal(w, "   ", 18)).not.toBeNull();
    }
  });

  it("refuses a winner whose margin says nobody won", () => {
    expect(marginRefusal("A", "AS", 18)).toContain("Halved");
  });

  it("refuses text that is not a margin, rather than calling it 1 UP", () => {
    // It was read as a one-hole win: "won on the 19th", "w/o", a stray name.
    for (const text of ["won", "big", "19th", "w/o", "3-2"]) {
      expect(marginRefusal("A", text, 18), text).not.toBeNull();
    }
  });

  it("still refuses a margin no match can finish on", () => {
    expect(marginRefusal("A", "2&3", 18)).toContain("3&2");
    expect(marginRefusal("A", "10&9", 9)).not.toBeNull();
  });

  it("CONTROL: accepts every real result", () => {
    for (const margin of ["1 UP", "1up", "2 up", "2&1", "3 & 2", "10&8", "5&4"]) {
      expect(marginRefusal("A", margin, 18), margin).toBeNull();
      expect(marginRefusal("B", margin, 18), margin).toBeNull();
    }
    // Halved carries no margin, and whatever is left in the box is not read.
    expect(marginRefusal("H", "", 18)).toBeNull();
    expect(marginRefusal("H", "AS", 18)).toBeNull();
    expect(marginRefusal("H", "3&2", 18)).toBeNull();
  });
});

describe("every door that turns a margin into a result asks first", () => {
  // Each of these is a "use server" export or the parser in front of one: a
  // public endpoint, called with whatever the caller likes.
  const DOORS: [file: string, from: string][] = [
    ["src/app/actions/play.ts", "export async function savePlayMatchResult"],
    ["src/app/actions/tournament.ts", "export async function applyMatchResult"],
    ["src/app/actions/tournament.ts", 'if (shape === "match-results")'],
    ["src/lib/domain/score-import.ts", "const winnerRaw ="],
    ["src/lib/domain/match-entry.ts", "export function resolveMatchEntry"],
  ];

  for (const [file, from] of DOORS) {
    it(`${file} — ${from}`, () => {
      const src = readSource(file);
      const start = src.indexOf(from);
      expect(start, `${from} is no longer in ${file}`).toBeGreaterThan(-1);
      const body = src.slice(start);
      const convert = body.indexOf("marginToHoles(");
      const scope = convert === -1 ? body.slice(0, 4000) : body.slice(0, convert);
      expect(scope.includes("marginRefusal("), `${from} turns a margin into holes without asking marginRefusal`).toBe(true);
    });
  }

  it("CONTROL: the list covers every caller of marginToHoles outside the screens", () => {
    for (const file of ["src/app/actions/play.ts", "src/app/actions/tournament.ts", "src/lib/domain/match-entry.ts"]) {
      const calls = readSource(file).split("marginToHoles(").length - 1;
      const listed = DOORS.filter(([f]) => f === file).length;
      expect(calls, `${file} calls marginToHoles ${calls} times and ${listed} are listed`).toBe(listed);
    }
  });
});
