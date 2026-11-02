import { describe, it, expect } from "vitest";
import { marginWords, myTieLine, tieReportSentence } from "../domain/my-tie";
import { readSource } from "./source";

/**
 * A KNOCKOUT RESULT READS AS A GOLFER SAYS IT, ON EVERY SCREEN THAT SAYS IT.
 *
 * The committee types a tie's margin into a free box. On 2026-10-23 a club
 * knockout of 129 was played with margins typed the ways a secretary types
 * them, and the tournament report printed "Ann beat Bob 19th", "beat Cat W/O",
 * "beat Dee Conceded" — while the player's own line said "lost to Ann at the
 * 19th", because it alone knew that 19th is a hole. One reader now
 * (`marginWords`), typed out by hand below.
 */
describe("a knockout result reads as a golfer says it", () => {
  const CASES: Array<[string, string]> = [
    ["", ""],
    ["   ", ""],
    ["3&2", " 3&2"],
    ["3 & 2", " 3&2"],
    ["3 and 2", " 3&2"],
    ["10&8", " 10&8"],
    ["1 up", " 1 up"],
    ["1UP", " 1 up"],
    ["2 Up", " 2 up"],
    ["19th", " at the 19th"],
    ["19", " at the 19th"],
    ["at the 20th", " at the 20th"],
    ["21st", " at the 21st"],
    ["22nd hole", " at the 22nd"],
    ["23rd", " at the 23rd"],
    ["W/O", " by walkover"],
    ["wo", " by walkover"],
    ["Walkover", " by walkover"],
    ["walk-over", " by walkover"],
    ["Conceded", " by concession"],
    ["concession", " by concession"],
    // Not a margin anybody types in golf: left exactly as the committee wrote it.
    ["retired hurt", " retired hurt"],
    ["18th", " 18th"],
  ];
  for (const [typed, reads] of CASES) {
    it(`"${typed}" reads "${reads}"`, () => expect(marginWords(typed)).toBe(reads));
  }

  it("the player's lines say it the same way", () => {
    const out = { state: "out" as const, round: "Round of 128", opponent: "Ann", result: "W/O", draw: "", key: "winners-1-3", waitingOn: "" };
    expect(myTieLine(out as never)).toBe("Out in the round of 128 · lost to Ann by walkover");
    expect(myTieLine({ ...out, round: "Final", result: "19th" } as never)).toBe("Runner-up · lost the final to Ann at the 19th");
    expect(tieReportSentence({ winnerName: "Ann", result: "3 and 2", reportedBy: "Bob", byMe: false })).toBe("Ann won 3&2 — Bob reported it.");
  });

  it("the report reads the margin through it, and nobody words one by hand", () => {
    const report = readSource("src/lib/services/event-report.ts");
    expect(report).toMatch(/beat \$\{l\.name\}\$\{marginWords\(margins\.get\(m\.key\)\)\}/);
    const tie = readSource("src/lib/domain/my-tie.ts");
    // The old hand-rolled reading of "19th" is gone from the player's line.
    expect(tie).not.toMatch(/` at the \$\{t\.result/);
  });
});
