import { describe, it, expect } from "vitest";
import { buildBracket, bracketSizeFor, knockoutProgress, type BracketMatch, type BracketView } from "@/lib/domain/bracket";
import type { Player } from "@/lib/domain/types";

/**
 * A TIE NOBODY HAS PLAYED YET IS NOT A BYE.
 *
 * Found 2026-10-12 by looking at a drawn bracket of 32: its quarter-finals,
 * semi-finals and final all read "Bye v Bye" with a full field and nothing
 * played. A place in a later round is empty either because nobody will ever
 * stand in it (the tie feeding it is between two byes) or because somebody
 * will and has not played yet — and the builder asked one question of both.
 *
 * It was not only a word. Whoever was drawn against such a place was sent
 * through unopposed: in a draw of sixteen, a player whose quarter ran a round
 * ahead of the next was advanced through a semi-final nobody had played, and
 * stood in the final until the other quarter caught up.
 *
 * Every test of brackets before this played its results ROUND BY ROUND, which
 * is the one order in which the fault cannot show: by the time a tie is
 * recorded, the ties two rounds behind its neighbour are already played. A
 * club does not play that way. So this plays every tie that can be played in
 * an order drawn at random — many orders, every field size from two to forty —
 * and after EVERY result asks four things that are true of a knockout whatever
 * the order (Rule 3.2: a match is won on the course or conceded):
 *
 *  1. a draw of n players takes exactly n − 1 results to finish, never fewer;
 *  2. nobody is shown as the winner of a tie unless that result was recorded,
 *     or the other side of it is a bye all the way down;
 *  3. no place reads "Bye" unless nobody can ever stand in it;
 *  4. with two or more players, the final never has a bye in it.
 */

const field = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Seed ${i + 1}`, handicap: i, seed: i + 1 }));

/** A repeatable source of order: the same seed is the same sequence. */
function chooser(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

/** The seed numbers that can reach this tie, read off the draw's own shape: how many real players stand under each of its two places. */
function playersUnder(view: BracketView, round: number, index: number): [number, number] {
  const under = (r: number, i: number): number => {
    if (r === 0) {
      const m = view.rounds[0].matches[i];
      return (m.a.playerId ? 1 : 0) + (m.b.playerId ? 1 : 0);
    }
    return under(r - 1, i * 2) + under(r - 1, i * 2 + 1);
  };
  if (round === 0) {
    const m = view.rounds[0].matches[index];
    return [m.a.playerId ? 1 : 0, m.b.playerId ? 1 : 0];
  }
  return [under(round - 1, index * 2), under(round - 1, index * 2 + 1)];
}

function check(view: BracketView, recorded: Record<string, string>, where: string) {
  for (const round of view.rounds) {
    for (const m of round.matches) {
      const [underA, underB] = playersUnder(view, m.roundIndex, m.matchIndex);
      const at = `${where}, ${round.label} tie ${m.matchIndex + 1}`;
      // 3. "Bye" only where nobody can ever stand.
      if (m.a.name === "Bye") expect(underA, `${at}: place A reads Bye with ${underA} players able to reach it`).toBe(0);
      if (m.b.name === "Bye") expect(underB, `${at}: place B reads Bye with ${underB} players able to reach it`).toBe(0);
      // and the other way: a place nobody can reach is not left as "TBD" for ever
      if (underA === 0 && !m.a.playerId) expect(m.a.name, `${at}: nobody can reach place A, and it reads ${m.a.name}`).toBe("Bye");
      if (underB === 0 && !m.b.playerId) expect(m.b.name, `${at}: nobody can reach place B, and it reads ${m.b.name}`).toBe("Bye");
      // 2. A winner was recorded, or the other side is a bye all the way down.
      if (m.winnerId && recorded[m.key] !== m.winnerId) {
        const opposed = m.winnerId === m.a.playerId ? underB : underA;
        expect(opposed, `${at}: ${m.winnerId} went through unplayed against a side ${opposed} players can still reach`).toBe(0);
      }
    }
  }
}

const playable = (view: BracketView): BracketMatch[] =>
  view.rounds.flatMap((r) => r.matches).filter((m) => !m.winnerId && m.a.playerId && m.b.playerId);

describe("a knockout played in the order a club plays it", () => {
  it("takes n − 1 results and sends nobody through unplayed, whatever the order — every field from 2 to 40, twelve orders each", () => {
    for (let n = 2; n <= 40; n += 1) {
      for (let order = 1; order <= 12; order += 1) {
        const players = field(n);
        const pick = chooser(n * 1000 + order);
        const recorded: Record<string, string> = {};
        const where = `field of ${n}, order ${order}`;
        let view = buildBracket("winners", players, recorded);
        check(view, recorded, `${where}, nothing played`);
        let results = 0;
        for (let guard = 0; guard < n + 2; guard += 1) {
          const open = playable(view);
          if (open.length === 0) break;
          const tie = open[pick(open.length)];
          recorded[tie.key] = pick(2) === 0 ? tie.a.playerId! : tie.b.playerId!;
          results += 1;
          view = buildBracket("winners", players, recorded);
          check(view, recorded, `${where}, after ${results} results`);
          // 1. Never finished early.
          if (results < n - 1) expect(view.champion, `${where}: a champion after ${results} of ${n - 1} results`).toBeNull();
        }
        expect(view.champion, `${where}: no champion when every tie was played`).not.toBeNull();
        expect(results, `${where}: results it took to finish`).toBe(n - 1);
        // and the app's own count of the draw agrees with the Rules' arithmetic
        expect(knockoutProgress(view), where).toEqual({ decided: n - 1, total: n - 1 });
      }
    }
  });

  it("with nothing played, a full draw has no bye anywhere and a short one has them only in the first round's gaps", () => {
    for (const n of [2, 4, 8, 16, 32, 64]) {
      const view = buildBracket("winners", field(n), {});
      const names = view.rounds.flatMap((r) => r.matches.flatMap((m) => [m.a.name, m.b.name]));
      expect(names.filter((x) => x === "Bye"), `a full draw of ${n}`).toEqual([]);
    }
    for (let n = 2; n <= 40; n += 1) {
      const view = buildBracket("winners", field(n), {});
      // 4. The final never has a bye in it.
      const final = view.rounds[view.rounds.length - 1].matches[0];
      expect([final.a.name, final.b.name], `the final of a field of ${n}`).not.toContain("Bye");
      // The gaps in the first round are exactly the places the field does not fill.
      const firstByes = view.rounds[0].matches.flatMap((m) => [m.a.name, m.b.name]).filter((x) => x === "Bye").length;
      expect(firstByes, `first-round byes in a field of ${n}`).toBe(bracketSizeFor(n) - n);
    }
  });

  it("the three cases as they were found", () => {
    // An ordinary knockout of eight, nothing played: the final is to be decided, not a bye against a bye.
    const eight = buildBracket("winners", field(8), {});
    expect([eight.rounds[2].matches[0].a.name, eight.rounds[2].matches[0].b.name]).toEqual(["TBD", "TBD"]);

    // The top half of the eight played to its semi-final, the bottom half not started: the finalist waits for an opponent.
    const half: Record<string, string> = { "winners-0-0": "p1", "winners-0-1": "p4", "winners-1-0": "p1" };
    const waiting = buildBracket("winners", field(8), half);
    expect([waiting.rounds[2].matches[0].a.name, waiting.rounds[2].matches[0].b.name]).toEqual(["Seed 1", "TBD"]);
    expect(waiting.champion).toBeNull();

    // Sixteen, one quarter of the draw played through its quarter-final: its winner is IN a semi-final, not through it.
    const quarter: Record<string, string> = { "winners-0-0": "p1", "winners-0-1": "p8", "winners-1-0": "p1" };
    const sixteen = buildBracket("winners", field(16), quarter);
    const semi = sixteen.rounds[2].matches[0];
    expect([semi.a.name, semi.b.name, semi.winnerId]).toEqual(["Seed 1", "TBD", null]);
    expect([sixteen.rounds[3].matches[0].a.name, sixteen.rounds[3].matches[0].b.name]).toEqual(["TBD", "TBD"]);
  });

  it("CONTROL: a real bye still sends its opponent through, and a bye against a bye is still a bye in the next round", () => {
    // Five players in a bracket of eight: seeds 1, 2 and 3 have no opponent in the first round.
    const five = buildBracket("winners", field(5), {});
    expect(five.rounds[0].matches.map((m) => m.winnerId)).toEqual(["p1", null, "p3", "p2"]);
    expect([five.rounds[1].matches[1].a.name, five.rounds[1].matches[1].b.name], "two who had byes meet in the semi-final").toEqual(["Seed 3", "Seed 2"]);

    // Three players in a bracket of four: the top seed's bye puts them in the final, where they wait.
    const three = buildBracket("winners", field(3), {});
    expect(three.rounds[0].matches[0].winnerId).toBe("p1");
    expect(three.rounds[1].matches[0].a.name).toBe("Seed 1");
    expect(three.champion).toBeNull();

    // Nine in a bracket of sixteen: seven first-round byes, and no tie between two byes exists to carry one forward.
    const nine = buildBracket("winners", field(9), {});
    expect(nine.rounds.slice(1).flatMap((r) => r.matches.flatMap((m) => [m.a.name, m.b.name])).filter((x) => x === "Bye")).toEqual([]);

    // A plate that is still filling: its gaps are people not yet known, not byes.
    const plate = buildBracket("consolation", field(2), {}, false);
    expect(plate.rounds.flatMap((r) => r.matches.flatMap((m) => [m.a.name, m.b.name]))).not.toContain("Bye");
  });
});
