import { describe, it, expect } from "vitest";
import { buildBracket, byeLine, tieNotReady, type BracketView } from "../domain/bracket";
import { tieReportRefusal } from "../domain/my-tie";
import type { Player } from "../domain/types";
import { readSource } from "./source";

/**
 * A TIE IS WON AGAINST SOMEBODY.
 *
 * Found 2026-10-23 running a club knockout of 129 in a browser. 129 is a draw
 * of 256 with 127 byes, so the only tie in the first round is seeds 128 v 129,
 * and the top seed meets its winner in the round of 128 — "Seed 1 v TBD" until
 * it is played. The Bracket manager let the secretary press the top seed's name
 * there: he went through to the round of 64 over a tie with nobody in it, while
 * the preliminary tie was still unplayed. And every one of the 127 byes carried
 * a "Result e.g. 3&2" box, inviting a margin for a match that never exists.
 *
 * A match is won on the course or conceded (Rule 3.2), which takes two players.
 * A player's report was held to that from the start ("Both players in that tie
 * aren't known yet"); the organizer's door and the screen were not. So there is
 * one rule, `tieNotReady`, and every door asks it.
 *
 * WHAT IT CANNOT SEE: the server action refusing in a running app — walked in
 * the browser on the 129 knockout, where the top seed's name is no longer a
 * button until 128 v 129 has been played.
 */
const field = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, handicap: i, seed: i + 1 }));

const tie = (v: BracketView, round: number, m: number) => v.rounds[round].matches[m];

describe("a tie is won against somebody", () => {
  const draw = buildBracket("winners", field(129), {});

  it("CONTROL: 129 is a draw of 256 whose one first-round tie is 128 v 129, feeding the top seed", () => {
    expect(draw.rounds).toHaveLength(8);
    const played = draw.rounds[0].matches.filter((m) => m.a.playerId && m.b.playerId);
    expect(played.map((m) => [m.a.seed, m.b.seed])).toEqual([[128, 129]]);
    expect(played[0].matchIndex).toBe(1);
    // The other 127 are byes, and they go through on their own.
    expect(draw.rounds[0].matches.filter((m) => m.winnerId)).toHaveLength(127);
    expect([tie(draw, 1, 0).a.seed, tie(draw, 1, 0).b.name]).toEqual([1, "TBD"]);
  });

  it("a stored result for the top seed against TBD does not send him through", () => {
    const v = buildBracket("winners", field(129), { "winners-1-0": "p1" });
    expect(tie(v, 1, 0).winnerId).toBeNull();
    expect(tie(v, 2, 0).a.playerId).toBeNull();
    // CONTROL: once 128 v 129 is played, the same stored result is a win.
    const played = buildBracket("winners", field(129), { "winners-0-1": "p129", "winners-1-0": "p1" });
    expect(tie(played, 1, 0).winnerId).toBe("p1");
    expect(tie(played, 2, 0).a.playerId).toBe("p1");
  });

  it("nor does a result kept from before the tie that fed it was taken back", () => {
    // Eight players: 1 beat 8, then 1 beat 4 in the semi. The 4 v 5 result is taken back.
    const order = { "winners-0-0": "p1", "winners-0-1": "p4", "winners-1-0": "p1" };
    expect(tie(buildBracket("winners", field(8), order), 2, 0).a.playerId).toBe("p1");
    const { ["winners-0-1"]: _gone, ...takenBack } = order;
    const v = buildBracket("winners", field(8), takenBack);
    expect(tie(v, 1, 0).winnerId).toBeNull();
    expect(tie(v, 2, 0).a.name).toBe("TBD");
  });

  it("says why a bye or a tie waiting on TBD cannot be decided, and nothing for two players", () => {
    expect(tieNotReady(tie(draw, 0, 0))).toBe("Both players in that tie aren't known yet.");
    expect(tieNotReady(tie(draw, 1, 0))).toBe("Both players in that tie aren't known yet.");
    expect(tieNotReady(tie(draw, 0, 1))).toBeNull();
    expect(tieNotReady(tie(draw, 1, 1))).toBeNull();
  });

  it("the screen says the byes of THIS draw, worked out by hand", () => {
    expect(byeLine(129)).toBe("That is a draw of 256: the top 127 seeds have a bye, and the other 2 players meet in the one tie of the first round.");
    expect(byeLine(128)).toBe("That is a full draw of 128, so nobody has a bye.");
    expect(byeLine(100)).toBe("That is a draw of 128: the top 28 seeds have a bye, and the other 72 players meet in 36 ties of the first round.");
    expect(byeLine(7)).toBe("That is a draw of 8: the top 1 seed has a bye, and the other 6 players meet in 3 ties of the first round.");
    expect(byeLine(1)).toBe("");
    // CONTROL: the line agrees with the draw the engine builds, for every field up to 300.
    for (let n = 2; n <= 300; n += 1) {
      const v = buildBracket("winners", field(n), {});
      const byes = v.rounds[0].matches.filter((m) => !m.a.playerId || !m.b.playerId).length;
      const ties = v.rounds[0].matches.length - byes;
      expect(byeLine(n), String(n)).toContain(byes === 0 ? "nobody has a bye" : `top ${byes} seed`);
      if (byes) expect(byeLine(n), String(n)).toContain(ties === 1 ? "the one tie" : `${ties} ties`);
    }
  });

  it("a player's report is held to the same rule", () => {
    expect(tieReportRefusal({ tie: { match: tie(draw, 1, 0) }, reporterIds: new Set(["p1"]), winnerId: "p1" })).toBe(
      tieNotReady(tie(draw, 1, 0)),
    );
  });

  it("the organizer's door asks it before it records anything, and the screen before it offers a name or a margin", () => {
    const actions = readSource("src/app/actions/tournament.ts");
    const body = actions.slice(actions.indexOf("export async function setBracketWinner"), actions.indexOf("async function recordBracketWinner"));
    const asks = body.indexOf("tieNotReady(tie.match)");
    expect(asks, "setBracketWinner no longer asks tieNotReady").toBeGreaterThan(0);
    expect(asks).toBeLessThan(body.indexOf("recordBracketWinner("));
    const screen = readSource("src/components/BracketClient.tsx");
    expect(screen).toMatch(/const clickable = !readOnly && slot\.playerId !== null && !tieNotReady\(m\);/);
    expect(screen).toMatch(/m\.winnerId && !readOnly && !tieNotReady\(m\) && \(\s*<input/);
    // And the player's door says it in the same words, from the same place.
    expect(readSource("src/lib/domain/my-tie.ts")).not.toMatch(/aren't known yet/);
  });
});
