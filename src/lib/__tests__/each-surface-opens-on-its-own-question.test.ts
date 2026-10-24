import { describe, it, expect } from "vitest";
import { buildBracket, type BracketView } from "@/lib/domain/bracket";
import { isByeTie } from "@/lib/domain/bracket-layout";
import {
  parsePlayBy,
  cleanPlayBy,
  roundPlayBy,
  isOverdue,
  toPlay,
  tieToPlay,
  tieStillHolds,
  latestResults,
  nextTieWords,
  strokesWords,
  myTieCard,
  fromFinal,
} from "@/lib/domain/knockout-play-by";
import type { Player } from "@/lib/domain/types";

/**
 * EACH SURFACE OPENS ON ITS OWN QUESTION (the panel, 2026-10-23, part b):
 *
 *   the secretary   "To play" — every tie that can be played now, round by
 *                   round in draw order, each with its round's play-by date and
 *                   "Overdue" once the CLUB's day is past it
 *   a player        their own tie: who, the strokes off the full difference,
 *                   the play-by date, where a win takes them
 *   the public      the latest results, who is still in, what is still to play
 *
 * Over a field of 129 and of 22 in twelve random orders of results with one
 * taken back, "To play" and "waiting" between them are every undecided tie
 * that is not a bye — none twice, none missed — and a listed tie always has
 * its two players.
 */

const field = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Seed ${i + 1}`, handicap: i, seed: i + 1 }));

function chooser(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

function* playedAtRandom(players: Player[], seed: number): Generator<BracketView> {
  const pick = chooser(seed);
  const winners: Record<string, string> = {};
  let view = buildBracket("winners", players, winners);
  yield view;
  let cleared = false;
  for (;;) {
    const ready = view.rounds.flatMap((r) => r.matches).filter(tieToPlay);
    if (!ready.length) return;
    const m = ready[pick(ready.length)];
    winners[m.key] = pick(2) ? m.a.playerId! : m.b.playerId!;
    view = buildBracket("winners", players, winners);
    yield view;
    if (!cleared && Object.keys(winners).length === 5) {
      cleared = true;
      delete winners[Object.keys(winners)[pick(5)]];
      view = buildBracket("winners", players, winners);
      yield view;
    }
  }
}

describe("play-by dates", () => {
  it("are read and written one way, counted back from the final", () => {
    expect(parsePlayBy("")).toEqual({});
    expect(parsePlayBy("not json")).toEqual({});
    expect(parsePlayBy('{"0":"2026-11-28","1":"2026-11-14","x":"y","2":"2026-02-30"}')).toEqual({ 0: "2026-11-28", 1: "2026-11-14" });
    const ok = cleanPlayBy({ "0": "2026-11-28", "1": "2026-11-14", "2": "" });
    expect(ok).toEqual({ ok: true, json: '{"0":"2026-11-28","1":"2026-11-14"}', dates: { 0: "2026-11-28", 1: "2026-11-14" } });
    expect(cleanPlayBy({ "0": "" })).toEqual({ ok: true, json: "", dates: {} });
    expect(cleanPlayBy({ "0": "28/11/2026" }).ok).toBe(false);
    // A round due after the round it feeds.
    expect(cleanPlayBy({ "0": "2026-11-28", "1": "2026-12-01" }).ok).toBe(false);
    expect(cleanPlayBy("2026-11-28").ok).toBe(false);
  });

  it("name the same rounds in a draw of any size: the final is the final", () => {
    const dates = { 0: "2026-11-28", 1: "2026-11-14", 2: "2026-10-31" };
    for (const n of [4, 8, 22, 129]) {
      const view = buildBracket("winners", field(n), {});
      const by = roundPlayBy(view, dates, "2026-11-01", "en-GB");
      const last = view.rounds.length - 1;
      expect(by[last]?.iso, `${n}: the final`).toBe("2026-11-28");
      expect(by[last - 1]?.iso, `${n}: the semi-finals`).toBe("2026-11-14");
      expect(fromFinal(view, last)).toBe(0);
      if (last >= 2) expect(by[last - 2]?.overdue, `${n}: the quarter-finals were due on the 31st`).toBe(true);
      expect(by[last].overdue).toBe(false);
      expect(by[last].words).toBe("Sat 28 Nov");
    }
  });

  it("are Overdue from the morning after, by the CLUB's day", () => {
    expect(isOverdue("2026-11-14", "2026-11-14")).toBe(false);
    expect(isOverdue("2026-11-14", "2026-11-15")).toBe(true);
    expect(isOverdue("", "2026-11-15")).toBe(false);
  });
});

describe("To play: what the secretary opens on", () => {
  for (const n of [5, 22, 129]) {
    it(`${n} players: every undecided tie is listed or waiting, once — in twelve orders, a result taken back`, () => {
      for (let order = 1; order <= 12; order += 1) {
        for (const view of playedAtRandom(field(n), order * 131 + n)) {
          const { rounds, waiting } = toPlay([{ label: "", view }], {}, "2026-11-01", "en-GB");
          const listed = rounds.flatMap((g) => g.ties);
          const undecided = view.rounds.flatMap((r) => r.matches).filter((m) => !m.winnerId && !isByeTie(m));
          expect(new Set(listed.map((m) => m.key)).size).toBe(listed.length);
          expect(listed.length + waiting).toBe(undecided.length);
          expect(listed.every((m) => m.a.playerId && m.b.playerId && !m.winnerId)).toBe(true);
          // Round by round, earliest first, and in draw order within a round.
          expect(rounds.map((g) => g.roundIndex)).toEqual([...rounds.map((g) => g.roundIndex)].sort((a, b) => a - b));
          for (const g of rounds) expect(g.ties.map((m) => m.matchIndex)).toEqual([...g.ties.map((m) => m.matchIndex)].sort((a, b) => a - b));
        }
      }
    });
  }

  it("carries each round's play-by date, and Overdue", () => {
    const view = buildBracket("winners", field(129), {});
    const { rounds } = toPlay([{ label: "", view }], { 7: "2026-10-20", 6: "2026-11-30" }, "2026-10-24", "en-GB");
    expect(rounds.map((g) => `${g.round}:${g.ties.length}:${g.playBy?.words ?? "-"}:${g.playBy?.overdue ?? "-"}`)).toEqual([
      "Preliminary round:1:Tue 20 Oct:true",
      "Round 1:63:Mon 30 Nov:false",
    ]);
  });

  it("saves a result only on the tie as it stands: the same two players, in either order", () => {
    const view = buildBracket("winners", field(8), {});
    const [first, second] = view.rounds[0].matches;
    expect(tieStillHolds(first, [first.a.playerId, first.b.playerId])).toBe(true);
    expect(tieStillHolds(first, [first.b.playerId, first.a.playerId])).toBe(true);
    expect(tieStillHolds(first, [first.a.playerId, second.a.playerId])).toBe(false);
    expect(tieStillHolds(first, [first.a.playerId])).toBe(false);
    expect(tieStillHolds(view.rounds[1].matches[0], [first.a.playerId, second.a.playerId])).toBe(false);
  });
});

describe("a player's own tie", () => {
  it("says where a win takes them", () => {
    const view = buildBracket("winners", field(8), { "winners-0-1": "p4" });
    const [qf0] = view.rounds[0].matches;
    expect(nextTieWords(view, qf0)).toBe("Win, and you play Seed 4 in the semi-finals.");
    const qf2 = view.rounds[0].matches[2];
    expect(nextTieWords(view, qf2)).toBe("Win, and you play the winner of Seed 2 v Seed 7.");
    expect(nextTieWords(view, view.rounds[2].matches[0])).toBe("Win, and you are the champion.");
    // A bye's player is who is next.
    const five = buildBracket("winners", field(5), {});
    expect(nextTieWords(five, five.rounds[0].matches[1])).toBe("Win, and you play Seed 1 in the semi-finals.");
  });

  it("gives the strokes off the full difference, from their own side", () => {
    expect(strokesWords(18, 11, true, "Ann")).toBe("You receive 7 strokes from Ann (18 v 11).");
    expect(strokesWords(11, 12, true, "Ann")).toBe("You give Ann 1 stroke (11 v 12).");
    expect(strokesWords(9, 9, true, "Ann")).toBe("Level: no strokes either way (both off 9).");
    expect(strokesWords(18, 11, false, "Ann")).toBe("Off scratch: no strokes either way.");
  });

  it("is one card from the draw: round, opponent, strokes, date, next", () => {
    const view = buildBracket("winners", field(8), {});
    const card = myTieCard({
      draws: [{ label: "", view }],
      playerId: "p1",
      results: {},
      dates: { 2: "2026-11-01" },
      today: "2026-11-02",
      locale: "en-GB",
      net: true,
      playing: (id) => (id === "p1" ? 4 : 10),
    });
    expect(card).toEqual({
      heading: "Your tie",
      line: "Quarter-final v Seed 8",
      strokes: "You give Seed 8 6 strokes (4 v 10).",
      playBy: { iso: "2026-11-01", words: "Sun 1 Nov", overdue: true },
      next: "Win, and you play the winner of Seed 4 v Seed 5.",
    });
    expect(myTieCard({ draws: [{ label: "", view }], playerId: "nobody", results: {}, dates: {}, today: "", locale: "en-GB", net: true, playing: () => 0 })).toBeNull();
  });
});

describe("the public board's news", () => {
  it("leads with the furthest round anybody has reached, and never lists a bye", () => {
    const view = buildBracket("winners", field(5), { "winners-0-1": "p5", "winners-1-0": "p1" });
    expect(latestResults([{ label: "", view }]).map((r) => `${r.round}:${r.match.key}`)).toEqual([
      "Semi-finals:winners-1-0",
      "Preliminary round:winners-0-1",
    ]);
    expect(latestResults([{ label: "", view: buildBracket("winners", field(5), {}) }])).toEqual([]);
  });
});
